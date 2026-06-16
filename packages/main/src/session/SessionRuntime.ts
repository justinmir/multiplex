import type { Repository, Session, SessionMsg, AppSettingsData, HarnessConfig } from "@app/core";
import type { Harness, HarnessEvent, HarnessRun } from "@app/core";
import { createHarness } from "@app/core";
import { registerBuiltInHarnesses } from "../harness/index.js";
import { deriveSessionStatusFromEvent } from "./statusMap.js";
import { deriveSessionStatus as applyDerivedFn } from "./deriveStatus.js";

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

  constructor(
    repo: Repository,
    getSettings: () => AppSettingsData,
    emit: (topic: string, payload: unknown) => void,
    config?: Partial<ConcurrencyConfig>,
  ) {
    this.repo = repo;
    this.settingsFn = getSettings;
    this.emitFn = emit;
    this.concurrencyConfig = { ...DEFAULT_CONCURRENCY, ...config };

    // Ensure built-in harnesses are registered
    registerBuiltInHarnesses();
    // Start crash detection loop
    this.startCrashDetection();
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

    // Start the harness run
    const cwd = input.cwd ?? process.env.HOME ?? "/tmp";
    const runInput = {
      sessionId,
      prompt: input.prompt,
      model: input.model,
      cwd,
      workspaces: [],
    };

    try {
      const run = await harness.start(runInput, (event) => this.onHarnessEvent(sessionId, event));
      this.runs.set(sessionId, run);
      this.lastActivity.set(sessionId, Date.now());
    } catch (err) {
      // Harness failed to start — mark session as failed
      const existing = await this.repo.getSession(sessionId);
      if (existing) {
        await this.repo.upsertSession({ ...existing, status: "failed" }, input.projectId ?? null);
      }
      throw err;
    }

    return { sessionId };
  }

  /** Send a follow-up message to an existing running session. */
  async sendMessage(sessionId: string, text: string): Promise<void> {
    const run = this.runs.get(sessionId);
    if (!run) {
      throw new Error(`No active run for session "${sessionId}" — start the agent first`);
    }

    // Persist the user message immediately
    const existing = await this.repo.getSession(sessionId);
    if (existing) {
      const userMsg: SessionMsg = { role: "user", content: text, ts: new Date().toISOString() };
      const updated: Session = { ...existing, messages: [...existing.messages, userMsg] };
      await this.repo.upsertSession(updated, null);
      this.emitFn("data:changed", { kind: "session" });
    }

    // Forward to harness and update activity timestamp
    await run.send(text);
    this.lastActivity.set(sessionId, Date.now());
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
      const run = this.runs.get(sessionId);
      if (run) {
        // Try to stop the crashed session gracefully first
        try { await run.stop(); } catch { /* ignore */ }
        run.dispose();
      }

      // Mark as failed and notify renderer
      const existing = await this.repo.getSession(sessionId);
      if (existing && existing.status === "running") {
        const errorMsg: SessionMsg = { role: "agent", content: "[Error] Session timed out — no activity detected", ts: new Date().toISOString() };
        const updated: Session = { ...existing, status: "failed", messages: [...existing.messages, errorMsg] };
        await this.repo.upsertSession(updated, null);
        this.emitFn("data:changed", { kind: "session" });
        this.emitFn(`session:${sessionId}:event`, { type: "done", reason: "failed" } as HarnessEvent);
      }

      this.runs.delete(sessionId);
      this.lastActivity.delete(sessionId);
    } catch { /* ignore crash handler errors */ }
  }

  // ---- Internal: handle events from a harness run ----

  private async onHarnessEvent(sessionId: string, event: HarnessEvent): Promise<void> {
    // Update activity timestamp for crash detection
    this.lastActivity.set(sessionId, Date.now());

    // Emit raw harness event to renderer for live streaming
    this.emitFn(`session:${sessionId}:event`, event);

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

      case "message_delta": {
        // Append delta to the last agent message, or create one
        const lastMsg = updated.messages[updated.messages.length - 1];
        if (lastMsg && lastMsg.role === "agent" && !lastMsg.content.includes("[STREAMING]")) {
          updated.messages = [
            ...updated.messages.slice(0, -1),
            { ...lastMsg, content: lastMsg.content + event.delta },
          ];
          persist = true;
        } else if (!lastMsg || lastMsg.role !== "agent") {
          updated.messages = [
            ...updated.messages,
            { role: "agent", content: "[STREAMING]" + event.delta, ts: new Date().toISOString() },
          ];
          persist = true;
        }
        break;
      }

      case "message": {
        // Final message — replace the streaming placeholder with actual content
        if (event.final) {
          const lastMsg = updated.messages[updated.messages.length - 1];
          if (lastMsg && lastMsg.role === "agent" && lastMsg.content.startsWith("[STREAMING]")) {
            updated.messages = [
              ...updated.messages.slice(0, -1),
              { role: event.role, content: event.content, ts: new Date().toISOString() },
            ];
            persist = true;
          } else if (!lastMsg || lastMsg.role !== "agent") {
            updated.messages = [
              ...updated.messages,
              { role: event.role, content: event.content, ts: new Date().toISOString() },
            ];
            persist = true;
          }
        } else {
          // Non-final message (e.g. tool output) — append as-is
          updated.messages = [
            ...updated.messages,
            { role: event.role, content: event.content, ts: new Date().toISOString() },
          ];
          persist = true;
        }
        break;
      }

      case "tool_use": {
        // Emit to renderer for live display (don't persist to main messages)
        this.emitFn(`session:${sessionId}:event`, event);
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
          this.runs.delete(sessionId);
          this.lastActivity.delete(sessionId);
          persist = true;
        }
        break;
      }

      case "awaiting_input": {
        updated.status = "awaiting_input";
        this.emitFn(`session:${sessionId}:status`, { sessionId, status: "awaiting_input" });
        persist = true;
        break;
      }

      case "error": {
        const errorMsg: SessionMsg = { role: "agent", content: `[Error] ${event.message}`, ts: new Date().toISOString() };
        updated.messages = [...updated.messages, errorMsg];
        if (!event.recoverable) {
          updated.status = "failed";
          this.runs.delete(sessionId);
          this.lastActivity.delete(sessionId);
        }
        persist = true;
        break;
      }

      case "workspace": {
        const existingWs = updated.workspaces.find(
          (w) => w.repo === event.workspace.repo && w.branch === event.workspace.branch
        );
        if (!existingWs) {
          updated.workspaces = [...updated.workspaces, event.workspace];
          persist = true;
        }
        break;
      }

      // pr events are forwarded but not persisted to session for now
    }

    if (persist) {
      // Apply derived status from PR signals after our update
      const refinedStatus = applyDerivedFn(updated);
      if (refinedStatus !== updated.status) {
        updated = { ...updated, status: refinedStatus };
      }
      await this.repo.upsertSession(updated, null);
      this.emitFn(`session:${sessionId}:status`, { sessionId, status: updated.status });
      this.emitFn("data:changed", { kind: "session" });
    }
  }

  private async applyDerived(session: Session): Promise<Session> {
    const derived = applyDerivedFn(session);
    if (derived !== session.status) {
      return { ...session, status: derived };
    }
    return session;
  }
}
