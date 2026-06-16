import type { Repository, Session, SessionMsg, Workspace, AppSettingsData, HarnessConfig, HostTool } from "@app/core";
import type { Harness, HarnessEvent, HarnessRun } from "@app/core";
import { createHarness } from "@app/core";
import { registerBuiltInHarnesses } from "../harness/index.js";
import { deriveSessionStatusFromEvent } from "./statusMap.js";
import { deriveSessionStatus as applyDerivedFn } from "./deriveStatus.js";
import type { WorkspaceManager } from "./WorkspaceManager.js";

/** Configuration for session concurrency limits. */
export interface ConcurrencyConfig {
  maxConcurrentSessions: number;
  crashDetectionIntervalMs: number;
  crashTimeoutMs: number;
}

const DEFAULT_CONCURRENCY: ConcurrencyConfig = {
  maxConcurrentSessions: 10,
  crashDetectionIntervalMs: 30_000,
  crashTimeoutMs: 60_000,
};

/** Create the harness instance for the current settings. */
function getHarness(settings: AppSettingsData): Harness | null {
  const config: HarnessConfig = {
    id: settings.harnessId ?? "mock",
    options: {},
  };
  return createHarness(config);
}

export class SessionRuntime {
  private runs = new Map<string, HarnessRun>();
  /** Track last activity timestamp per session for crash detection. */
  private lastActivity = new Map<string, number>();
  private repo: Repository;
  private settingsFn: () => AppSettingsData;
  private emitFn: (topic: string, payload: unknown) => void;
  private concurrencyConfig: ConcurrencyConfig;
  /** Crash detection timer. */
  private crashTimer: ReturnType<typeof setInterval> | null = null;
  /** Per-session promise chain that serializes repo read-modify-write so
   *  concurrently-arriving harness events can't clobber each other's writes. */
  private persistChains = new Map<string, Promise<void>>();

  private workspaces?: WorkspaceManager;

  constructor(
    repo: Repository,
    getSettings: () => AppSettingsData,
    emit: (topic: string, payload: unknown) => void,
    workspaceManager?: WorkspaceManager,
    config?: Partial<ConcurrencyConfig>,
  ) {
    this.repo = repo;
    this.settingsFn = getSettings;
    this.emitFn = emit;
    this.workspaces = workspaceManager;
    this.concurrencyConfig = { ...DEFAULT_CONCURRENCY, ...config };

    // Ensure built-in harnesses are registered
    registerBuiltInHarnesses();
    // Start crash detection loop
    this.startCrashDetection();
  }

  /** Expose the workspace manager for IPC handlers (e.g. session:changes). */
  getWorkspaceManager(): WorkspaceManager | undefined {
    return this.workspaces;
  }

  /** Real diffs across the session's materialized worktrees, grouped by repo. */
  async getSessionChanges(sessionId: string): Promise<Array<{ repo: string; files: import("@app/core").FileChange[] }>> {
    if (!this.workspaces) return [];
    const session = await this.repo.getSession(sessionId);
    if (!session) return [];
    return this.workspaces.diffAll(session.workspaces);
  }

  /** Check how many sessions can still be started. */
  getActiveRunCount(): number {
    return this.runs.size;
  }

  /** Check if a session is currently running. */
  isActive(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  /** Start a new agent session. Creates the session in the repo, then starts the harness. */
  async startSession(input: {
    sessionId?: string;
    prompt: string;
    projectId?: string | null;
    model?: string;
    cwd?: string;
  }): Promise<{ sessionId: string }> {
    // Enforce concurrency limit
    if (this.runs.size >= this.concurrencyConfig.maxConcurrentSessions) {
      throw new Error(`Concurrency limit reached (${this.concurrencyConfig.maxConcurrentSessions} active sessions)`);
    }

    const settings = this.settingsFn();
    const harness = getHarness(settings);
    if (!harness) {
      throw new Error(`No harness registered for id "${settings.harnessId ?? "mock"}"`);
    }

    const sessionId = input.sessionId ?? `ss_${Date.now().toString(36)}`;
    const title = input.prompt.length > 60 ? input.prompt.slice(0, 60).trim() + "…" : input.prompt;
    const model = input.model ?? settings.defaultModel ?? "claude-sonnet-4-20250514";

    // Create the session in the repository
    const nowMs = Date.now();
    const newSession: Session = {
      id: sessionId,
      title,
      prompt: input.prompt,
      status: "running",
      model,
      workspaces: [],
      startedAt: new Date().toISOString(),
      createdAtMs: nowMs,
      durationMin: 0,
      tokens: 0,
      cost: 0,
      messages: [
        { role: "user", content: input.prompt, ts: new Date().toISOString() },
      ],
    };

    await this.repo.upsertSession(newSession, input.projectId ?? null);
    this.emitFn("data:changed", { kind: "session" });

    try {
      const ctx = await this.prepareWorkspace(sessionId, input.projectId ?? null, harness);
      await this.beginRun(harness, { sessionId, prompt: input.prompt, model, ...ctx });
    } catch (err) {
      // Harness failed to start — mark session as failed
      const existing = await this.repo.getSession(sessionId);
      if (existing) {
        await this.repo.upsertSession({ ...existing, status: "failed" }, input.projectId ?? null);
        this.emitFn("data:changed", { kind: "session" });
      }
      throw err;
    }

    return { sessionId };
  }

  /**
   * Prepare a session's workspace: ensure the root dir, build the repo catalog
   * and the `open_repo` host tool, and (for harnesses that can't declare repos
   * lazily) pre-materialize the session's in-scope repos.
   */
  private async prepareWorkspace(
    sessionId: string,
    projectId: string | null,
    harness: Harness,
  ): Promise<{ cwd: string; availableRepos: string[]; tools: HostTool[] }> {
    const wm = this.workspaces;
    if (!wm) {
      return { cwd: process.env.HOME ?? "/tmp", availableRepos: [], tools: [] };
    }

    const cwd = wm.ensureRoot(sessionId);
    const registered = wm.catalog();
    const inScope = projectId ? ((await this.repo.getProject(projectId))?.repos ?? []) : [];
    const availableRepos = Array.from(new Set([...inScope, ...registered]));

    const openRepo: HostTool = {
      name: "open_repo",
      description:
        "Create a git worktree for a repository so you can read and edit its files. " +
        "Call this once before working in a repo; it returns the absolute path to work in. " +
        "Argument: { repo: string } where repo is one of the available repo identifiers.",
      inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
      handler: async (raw) => {
        const repoId = (raw as { repo?: string } | undefined)?.repo;
        if (!repoId) return { content: "open_repo requires a 'repo' argument", isError: true };
        return this.materializeRepo(sessionId, repoId);
      },
    };

    // Harnesses without host-tool support get their in-scope repos up front.
    if (!harness.supportsHostTools) {
      for (const repoId of inScope) {
        if (wm.resolves(repoId)) await this.materializeRepo(sessionId, repoId);
      }
    }

    return { cwd, availableRepos, tools: [openRepo] };
  }

  /** Materialize a worktree for `repoId` and record it on the session. */
  private async materializeRepo(sessionId: string, repoId: string): Promise<{ content: string; isError?: boolean }> {
    const wm = this.workspaces;
    if (!wm) return { content: "Workspaces unavailable", isError: true };
    const existing = (await this.repo.getSession(sessionId))?.workspaces ?? [];
    const { workspace, error } = await wm.openRepo(sessionId, repoId, existing);
    if (error || !workspace) return { content: error ?? `Failed to open ${repoId}`, isError: true };
    // Persist + forward through the normal event path (dedupes by repo+branch).
    this.onHarnessEvent(sessionId, { type: "workspace", workspace });
    return { content: workspace.worktree ?? "" };
  }

  /** Start a harness run for a session id and register it. */
  private async beginRun(
    harness: Harness,
    input: { sessionId: string; prompt: string; model?: string; cwd: string; availableRepos?: string[]; tools?: HostTool[] },
  ): Promise<void> {
    const run = await harness.start(
      {
        sessionId: input.sessionId,
        prompt: input.prompt,
        model: input.model,
        cwd: input.cwd,
        workspaces: [],
        availableRepos: input.availableRepos,
        tools: input.tools,
      },
      (event) => this.onHarnessEvent(input.sessionId, event),
    );
    this.runs.set(input.sessionId, run);
    this.lastActivity.set(input.sessionId, Date.now());
  }

  /** Send a follow-up message to a session. If the in-memory run is gone (turn
   *  ended, harness crashed, or the app restarted), transparently revive a new
   *  run for the existing session instead of failing — sessions feel durable. */
  async sendMessage(sessionId: string, text: string): Promise<void> {
    // Persist the user message first so it shows immediately and survives revival.
    const existing = await this.repo.getSession(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const userMsg: SessionMsg = { role: "user", content: text, ts: new Date().toISOString() };
    const projectId = await this.repo.getSessionProjectId(existing.id);
    await this.repo.upsertSession(
      { ...existing, messages: [...existing.messages, userMsg], status: "running" },
      projectId,
    );
    this.emitFn("data:changed", { kind: "session" });

    const run = this.runs.get(sessionId);
    if (run) {
      await run.send(text);
      this.lastActivity.set(sessionId, Date.now());
      return;
    }

    // No live run — revive one. The new run uses this message as its prompt and
    // re-attaches the session's workspace (worktrees are reused if they exist).
    const settings = this.settingsFn();
    const harness = getHarness(settings);
    if (!harness) throw new Error(`No harness registered for id "${settings.harnessId ?? "mock"}"`);
    const model = existing.model || settings.defaultModel;
    const ctx = await this.prepareWorkspace(sessionId, projectId, harness);
    await this.beginRun(harness, { sessionId, prompt: text, model, ...ctx });
  }

  /** Stop the agent for a session. */
  async stopSession(sessionId: string): Promise<void> {
    const run = this.runs.get(sessionId);
    if (run) {
      await run.stop();
    } else {
      // No active run — just mark as idle in the repo
      const existing = await this.repo.getSession(sessionId);
      if (existing && existing.status !== "idle" && existing.status !== "completed") {
        const updated: Session = { ...existing, status: "idle" };
        await this.repo.upsertSession(updated, null);
        this.emitFn("data:changed", { kind: "session" });
      }
    }
  }

  /** Gracefully shut down all active sessions and persist state. */
  async shutdown(): Promise<void> {
    // Stop crash detection timer
    if (this.crashTimer) {
      clearInterval(this.crashTimer);
      this.crashTimer = null;
    }

    // Save final state for all running sessions before stopping them
    const activeIds = Array.from(this.runs.keys());
    for (const sessionId of activeIds) {
      try {
        const existing = await this.repo.getSession(sessionId);
        if (existing && existing.status === "running") {
          // Mark as idle so it can be resumed later
          await this.repo.upsertSession({ ...existing, status: "idle" }, null);
        }
      } catch { /* ignore save errors during shutdown */ }
    }

    // Dispose all harness runs gracefully
    for (const run of this.runs.values()) {
      try { run.dispose(); } catch { /* ignore */ }
    }
    this.runs.clear();
    this.lastActivity.clear();
  }

  /** Clean up all active runs immediately (called on app quit). */
  disposeAll(): void {
    if (this.crashTimer) {
      clearInterval(this.crashTimer);
      this.crashTimer = null;
    }
    for (const run of this.runs.values()) {
      try { run.dispose(); } catch { /* ignore */ }
    }
    this.runs.clear();
    this.lastActivity.clear();
  }

  /** Recover sessions that were left in "running" state after a crash. */
  async recoverStaleSessions(): Promise<string[]> {
    const recovered: string[] = [];
    try {
      // Get all standalone sessions (we'll need to check project sessions too)
      const sessions = await this.repo.listSessions();
      for (const session of sessions) {
        if (session.status === "running") {
          // Session was running but has no active harness — mark as idle for recovery
          const updated: Session = { ...session, status: "idle" };
          await this.repo.upsertSession(updated, null);
          recovered.push(session.id);
        }
      }

      if (recovered.length > 0) {
        this.emitFn("data:changed", { kind: "session" });
      }
    } catch { /* ignore recovery errors */ }

    return recovered;
  }

  // ---- Internal: crash detection loop ----

  private startCrashDetection(): void {
    this.crashTimer = setInterval(async () => {
      const now = Date.now();
      for (const [sessionId] of this.runs) {
        const lastActive = this.lastActivity.get(sessionId);
        if (!lastActive) continue;

        // If no activity for more than crash timeout, consider it crashed
        if (now - lastActive > this.concurrencyConfig.crashTimeoutMs) {
          await this.handleCrashedSession(sessionId);
        }
      }
    }, this.concurrencyConfig.crashDetectionIntervalMs);
  }

  private async handleCrashedSession(sessionId: string): Promise<void> {
    try {
      // Only an actively-running session can crash. A completed/idle/awaiting
      // session intentionally keeps its run alive for follow-up turns — don't
      // tear it down just because it's been quiet.
      const existing = await this.repo.getSession(sessionId);
      if (!existing || existing.status !== "running") {
        this.lastActivity.set(sessionId, Date.now());
        return;
      }

      const run = this.runs.get(sessionId);
      if (run) {
        // Try to stop the crashed session gracefully first
        try { await run.stop(); } catch { /* ignore */ }
        run.dispose();
      }

      // Mark as failed and notify renderer
      if (existing.status === "running") {
        const errorMsg: SessionMsg = { role: "agent", content: "[Error] Session timed out — no activity detected", ts: new Date().toISOString() };
        const updated: Session = { ...existing, status: "failed", messages: [...existing.messages, errorMsg] };
        const projectId = await this.repo.getSessionProjectId(sessionId);
        await this.repo.upsertSession(updated, projectId);
        this.emitFn("data:changed", { kind: "session" });
        this.emitFn(`session:${sessionId}:event`, { type: "done", reason: "failed" } as HarnessEvent);
      }

      this.runs.delete(sessionId);
      this.lastActivity.delete(sessionId);
    } catch { /* ignore crash handler errors */ }
  }

  // ---- Internal: handle events from a harness run ----

  /**
   * Handle a harness event. The live-stream emit and run-lifecycle bookkeeping
   * happen synchronously; the repo read-modify-write is pushed onto a per-session
   * serial queue so concurrently-arriving events (message, usage, done) can't
   * each read a stale session and clobber one another's writes.
   */
  private onHarnessEvent(sessionId: string, event: HarnessEvent): void {
    this.lastActivity.set(sessionId, Date.now());

    // Emit raw harness event to renderer for live streaming (order-preserving).
    this.emitFn(`session:${sessionId}:event`, event);

    // Run-lifecycle is in-memory state, not repo state — handle it immediately.
    if (event.type === "done" && event.reason !== "completed") {
      this.runs.delete(sessionId);
      this.lastActivity.delete(sessionId);
    } else if (event.type === "error" && !event.recoverable) {
      this.runs.delete(sessionId);
      this.lastActivity.delete(sessionId);
    }

    this.enqueuePersist(sessionId, () => this.persistEvent(sessionId, event));
  }

  /** Serialize repo mutations per session via a promise chain. */
  private enqueuePersist(sessionId: string, mutate: () => Promise<void>): void {
    const prev = this.persistChains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(mutate, mutate).catch((err) => {
      console.error(`[SessionRuntime] persist failed for ${sessionId}:`, err);
    });
    this.persistChains.set(sessionId, next);
  }

  /** Apply one harness event to the persisted session (runs inside the queue). */
  private async persistEvent(sessionId: string, event: HarnessEvent): Promise<void> {
    const existing = await this.repo.getSession(sessionId);
    if (!existing) return;

    let updated: Session = { ...existing };
    let persist = false;

    switch (event.type) {
      case "status": {
        const newStatus = deriveSessionStatusFromEvent(event);
        if (newStatus && newStatus !== updated.status) {
          updated.status = newStatus;
          persist = true;
        }
        break;
      }

      // Live streaming is rendered by the renderer overlay from the raw event;
      // per-delta persistence is intentionally skipped (one DB write per token).
      case "message_delta":
      case "tool_use":
        break;

      case "message": {
        updated.messages = [
          ...updated.messages,
          { role: event.role, content: event.content, ts: new Date().toISOString() },
        ];
        persist = true;
        break;
      }

      case "usage": {
        if (event.tokens !== undefined) updated.tokens += event.tokens;
        if (event.costUsd !== undefined) updated.cost = Math.round((updated.cost + event.costUsd) * 100) / 100;
        if (event.durationMs !== undefined) updated.durationMin = Math.max(updated.durationMin, Math.ceil(event.durationMs / 60_000));
        persist = true;
        break;
      }

      case "done": {
        const newStatus = deriveSessionStatusFromEvent(event);
        if (newStatus) {
          updated.status = newStatus;
          persist = true;
        }
        break;
      }

      case "awaiting_input": {
        updated.status = "awaiting_input";
        persist = true;
        break;
      }

      case "error": {
        updated.messages = [
          ...updated.messages,
          { role: "agent", content: `[Error] ${event.message}`, ts: new Date().toISOString() },
        ];
        if (!event.recoverable) updated.status = "failed";
        persist = true;
        break;
      }

      case "workspace": {
        const existingWs = updated.workspaces.find(
          (w) => w.repo === event.workspace.repo && w.branch === event.workspace.branch,
        );
        if (!existingWs) {
          updated.workspaces = [...updated.workspaces, event.workspace];
          persist = true;
        }
        break;
      }

      // pr events are forwarded but not persisted to session for now
    }

    if (!persist) return;

    // Refine status from PR signals, then persist preserving project association.
    const refinedStatus = applyDerivedFn(updated);
    if (refinedStatus !== updated.status) updated = { ...updated, status: refinedStatus };
    const projectId = await this.repo.getSessionProjectId(sessionId);
    await this.repo.upsertSession(updated, projectId);
    this.emitFn(`session:${sessionId}:status`, { sessionId, status: updated.status });
    this.emitFn("data:changed", { kind: "session" });
  }
}
