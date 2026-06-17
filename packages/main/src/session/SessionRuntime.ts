import type { Repository, Session, SessionMsg, Workspace, AppSettingsData, HarnessConfig, HostTool, ForgeService, PullRequest, GitService, ActivityItem, Note, Reference } from "@app/core";
import type { Harness, HarnessEvent, HarnessRun } from "@app/core";
import { createHarness } from "@app/core";
import { registerBuiltInHarnesses } from "../harness/index.js";
import { deriveSessionStatusFromEvent } from "./statusMap.js";
import { deriveSessionStatus as applyDerivedFn } from "./deriveStatus.js";
import { generateSessionTitle, generateBranchName } from "./sessionTitle.js";
import type { WorkspaceManager } from "./WorkspaceManager.js";
import { pushBranch } from "../git/push.js";
import { assembleProjectContext } from "../intelligence/assembleContext.js";
import { getIntelligenceService } from "../intelligence/service.js";

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
  /** Per-session buffer of the in-flight turn's steps (thinking, tool calls, the
   *  final agent message). Flushed to session.messages in order when the turn
   *  completes so the agentic transcript is persisted as one ordered batch. */
  private pendingTurn = new Map<string, SessionMsg[]>();
  /** Per-session accumulator for the current thinking block (reasoning deltas)
   *  not yet committed to `pendingTurn`. */
  private pendingThinking = new Map<string, string>();
  /** Sessions with a turn currently in progress. Sends that arrive while a
   *  session is here are queued; the queue drains when the turn ends. */
  private activeTurns = new Set<string>();
  /** Per-session in-flight branch-name resolution (deduped + cached). */
  private branchGen = new Map<string, Promise<string>>();

  private workspaces?: WorkspaceManager;
  private forge?: ForgeService;
  private git?: GitService;

  constructor(
    repo: Repository,
    getSettings: () => AppSettingsData,
    emit: (topic: string, payload: unknown) => void,
    workspaceManager?: WorkspaceManager,
    deps?: { forge?: ForgeService; git?: GitService },
    config?: Partial<ConcurrencyConfig>,
  ) {
    this.repo = repo;
    this.settingsFn = getSettings;
    this.emitFn = emit;
    this.workspaces = workspaceManager;
    this.forge = deps?.forge;
    this.git = deps?.git;
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
    const repoDiffs = await this.workspaces.diffAll(session.workspaces);
    // Also surface loose files written to the session root (e.g. a standalone
    // script when no repo is in scope) so they show up in Changes.
    const loose = this.workspaces.looseRootChanges(sessionId, session.workspaces);
    return loose ? [...repoDiffs, loose] : repoDiffs;
  }

  /**
   * Open one draft PR per touched repo that has changes (M-B5 fan-out). Pushes
   * each materialized worktree's session branch, opens a draft PR, and appends
   * them all to the session's linkedPRs.
   */
  async openPullRequests(sessionId: string): Promise<{ opened: PullRequest[]; message?: string }> {
    if (!this.workspaces || !this.forge || !this.git) {
      return { opened: [], message: "PR support is unavailable (no forge/git configured)." };
    }
    const session = await this.repo.getSession(sessionId);
    if (!session) return { opened: [], message: "Session not found." };

    const changed = await this.workspaces.changedWorkspaces(session.workspaces);
    if (changed.length === 0) {
      return { opened: [], message: "Nothing to open a PR for yet — no repository has changes." };
    }

    const opened: PullRequest[] = [];
    const errors: string[] = [];
    for (const ws of changed) {
      if (!ws.worktree) continue;
      try {
        await pushBranch(ws.worktree, ws.branch);
        const base = await this.git.defaultBranch(ws.worktree);
        const pr = await this.forge.openDraftPR({
          repo: ws.repo,
          title: session.title,
          head: ws.branch,
          base,
          body: session.prompt ? `Opened by Multiplex session.\n\n> ${session.prompt}` : undefined,
          draft: true,
        });
        opened.push(pr);
      } catch (err) {
        errors.push(`${ws.repo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (opened.length > 0) {
      const projectId = await this.repo.getSessionProjectId(sessionId);
      const fresh = await this.repo.getSession(sessionId);
      await this.repo.upsertSession(
        { ...(fresh ?? session), linkedPRs: [...((fresh ?? session).linkedPRs ?? []), ...opened] },
        projectId,
      );
      // Activity per opened PR (project-scoped sessions only).
      if (projectId) {
        for (const pr of opened) {
          const item: ActivityItem = {
            id: `act_pr_${pr.repo}_${pr.number}_${Date.now()}`,
            kind: "pr",
            text: `Opened draft PR ${pr.repo}#${pr.number} — ${pr.title}`,
            ts: new Date().toISOString(),
          };
          await this.repo.appendActivity(projectId, item);
        }
      }
      this.emitFn("data:changed", { kind: "session" });
    }

    const message = errors.length > 0
      ? `Opened ${opened.length} PR(s); ${errors.length} failed: ${errors.join("; ")}`
      : undefined;
    return { opened, message };
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

    // Replace the truncated title with an LLM-generated summary (opencode's
    // default agent). Fire-and-forget so session start never blocks on it; the
    // fallback title shows instantly and is swapped in when ready.
    if ((settings.harnessId ?? "opencode") === "opencode") {
      void this.refineTitle(sessionId, input.prompt, title, model);
    }

    try {
      this.activeTurns.add(sessionId);
      const ctx = await this.prepareWorkspace(sessionId, input.projectId ?? null, harness);
      await this.beginRun(harness, { sessionId, prompt: input.prompt, model, ...ctx });
    } catch (err) {
      // Harness failed to start — mark session as failed
      this.activeTurns.delete(sessionId);
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
  ): Promise<{ cwd: string; availableRepos: string[]; tools: HostTool[]; notes?: { title: string; body: string }[]; references?: { title: string; url?: string; body?: string }[] }> {
    const wm = this.workspaces;
    if (!wm) {
      return { cwd: process.env.HOME ?? "/tmp", availableRepos: [], tools: [] };
    }

    const cwd = wm.ensureRoot(sessionId);
    const registered = wm.catalog();
    // M-D2 — a project session inherits its project's notes + references so the
    // agent has the same context the intelligence layer uses.
    const project = projectId ? await this.repo.getProject(projectId) : null;
    const inScope = project?.repos ?? [];
    const ctx = project ? assembleProjectContext(project) : undefined;
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

    // Project sessions can manage their project's notes + references.
    const projectTools = projectId ? this.buildProjectTools(projectId) : [];

    return { cwd, availableRepos, tools: [openRepo, ...projectTools], notes: ctx?.notes, references: ctx?.references };
  }

  /**
   * Host tools that let the agent read/write its project's notes and references
   * (e.g. "store the context from this thread in a new note"). Project-scoped;
   * each mutation persists and notifies the renderer.
   */
  private buildProjectTools(projectId: string): HostTool[] {
    const changed = () => this.emitFn("data:changed", { kind: "project" });
    const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return [
      {
        name: "create_note",
        description: "Create a note in the current project (long-lived context the agent reads on every run). Argument: { title: string, body: string (markdown), tags?: string[] }.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["title", "body"] },
        handler: async (raw) => {
          const a = (raw ?? {}) as { title?: string; body?: string; tags?: string[] };
          if (!a.title?.trim()) return { content: "create_note requires a 'title'", isError: true };
          const note: Note = { id: rid("note"), title: a.title.trim(), body: a.body ?? "", author: "agent", updatedAt: new Date().toISOString(), tags: Array.isArray(a.tags) ? a.tags : [] };
          await this.repo.upsertNote(projectId, note);
          changed();
          return { content: `Created note "${note.title}" (id ${note.id}).` };
        },
      },
      {
        name: "update_note",
        description: "Update an existing project note. Argument: { note_id: string, title?: string, body?: string, tags?: string[] }.",
        inputSchema: { type: "object", properties: { note_id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["note_id"] },
        handler: async (raw) => {
          const a = (raw ?? {}) as { note_id?: string; title?: string; body?: string; tags?: string[] };
          const existing = (await this.repo.getNotes(projectId)).find((n) => n.id === a.note_id);
          if (!existing) return { content: `No note with id ${a.note_id}`, isError: true };
          const updated: Note = { ...existing, title: a.title ?? existing.title, body: a.body ?? existing.body, tags: Array.isArray(a.tags) ? a.tags : existing.tags, updatedAt: new Date().toISOString() };
          await this.repo.upsertNote(projectId, updated);
          changed();
          return { content: `Updated note "${updated.title}".` };
        },
      },
      {
        name: "delete_note",
        description: "Delete a project note. Argument: { note_id: string }.",
        inputSchema: { type: "object", properties: { note_id: { type: "string" } }, required: ["note_id"] },
        handler: async (raw) => {
          const id = (raw as { note_id?: string } | undefined)?.note_id;
          if (!id) return { content: "delete_note requires 'note_id'", isError: true };
          await this.repo.deleteNote(projectId, id);
          changed();
          return { content: `Deleted note ${id}.` };
        },
      },
      {
        name: "list_notes",
        description: "List the current project's notes. Returns id, title, and tags for each. No arguments.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          const notes = await this.repo.getNotes(projectId);
          if (notes.length === 0) return { content: "No notes yet." };
          return { content: notes.map((n) => `- ${n.id}: ${n.title}${n.tags.length ? ` [${n.tags.join(", ")}]` : ""}`).join("\n") };
        },
      },
      {
        name: "add_reference",
        description: "Add a reference (link/doc/issue/etc.) to the current project. Argument: { title: string, url?: string, kind?: \"link\"|\"doc\"|\"issue\"|\"todo\"|\"meeting\"|\"pr\", summary?: string }.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, url: { type: "string" }, kind: { type: "string" }, summary: { type: "string" } }, required: ["title"] },
        handler: async (raw) => {
          const a = (raw ?? {}) as { title?: string; url?: string; kind?: string; summary?: string };
          if (!a.title?.trim()) return { content: "add_reference requires a 'title'", isError: true };
          const kinds = ["pr", "doc", "link", "meeting", "todo", "issue"];
          const ref: Reference = { id: rid("ref"), kind: (kinds.includes(a.kind ?? "") ? a.kind : "link") as Reference["kind"], title: a.title.trim(), url: a.url, summary: a.summary, addedAt: new Date().toISOString(), addedBy: "agent" };
          await this.repo.upsertReference({ projectId }, ref);
          changed();
          return { content: `Added reference "${ref.title}" (id ${ref.id}).` };
        },
      },
      {
        name: "remove_reference",
        description: "Remove a reference from the current project. Argument: { reference_id: string }.",
        inputSchema: { type: "object", properties: { reference_id: { type: "string" } }, required: ["reference_id"] },
        handler: async (raw) => {
          const id = (raw as { reference_id?: string } | undefined)?.reference_id;
          if (!id) return { content: "remove_reference requires 'reference_id'", isError: true };
          await this.repo.deleteReference({ projectId }, id);
          changed();
          return { content: `Removed reference ${id}.` };
        },
      },
    ];
  }

  /** Materialize a worktree for `repoId` and record it on the session. */
  private async materializeRepo(sessionId: string, repoId: string): Promise<{ content: string; isError?: boolean }> {
    const wm = this.workspaces;
    if (!wm) return { content: "Workspaces unavailable", isError: true };
    const existing = (await this.repo.getSession(sessionId))?.workspaces ?? [];
    const branch = await this.ensureBranchName(sessionId);
    const { workspace, error } = await wm.openRepo(sessionId, repoId, existing, branch);
    if (error || !workspace) return { content: error ?? `Failed to open ${repoId}`, isError: true };
    // Persist + forward through the normal event path (dedupes by repo+branch).
    this.onHarnessEvent(sessionId, { type: "workspace", workspace });
    return { content: workspace.worktree ?? "" };
  }

  /**
   * Resolve the branch name for a session's worktrees, deciding it once. Prefers
   * an already-stored name (persists across restarts), then any existing
   * worktree's branch, then a short human-readable name generated from the prompt
   * (opencode only; deterministic `multiplex/<id>` fallback otherwise).
   */
  private ensureBranchName(sessionId: string): Promise<string> {
    let pending = this.branchGen.get(sessionId);
    if (pending) return pending;
    pending = (async (): Promise<string> => {
      const wm = this.workspaces;
      const fallback = wm ? wm.branchFor(sessionId) : `multiplex/${sessionId}`;
      const session = await this.repo.getSession(sessionId);
      if (!session) return fallback;
      if (session.branch) return session.branch;
      const existing = session.workspaces?.find((w) => w.branch)?.branch;
      if (existing) { await this.storeBranch(sessionId, existing); return existing; }

      let branch = fallback;
      if ((this.settingsFn().harnessId ?? "opencode") === "opencode") {
        const slug = await generateBranchName(session.prompt ?? session.title, session.model);
        if (slug) branch = `${slug}-${this.branchSuffix(sessionId)}`;
      }
      await this.storeBranch(sessionId, branch);
      return branch;
    })();
    this.branchGen.set(sessionId, pending);
    return pending;
  }

  /** Short, filesystem/git-safe suffix from the session id to keep slugs unique. */
  private branchSuffix(sessionId: string): string {
    return sessionId.replace(/[^a-z0-9]/gi, "").slice(-6).toLowerCase() || "wt";
  }

  /** Persist the chosen branch onto the session (once), via the serial queue. */
  private storeBranch(sessionId: string, branch: string): void {
    this.enqueuePersist(sessionId, async () => {
      const s = await this.repo.getSession(sessionId);
      if (s && !s.branch) {
        const projectId = await this.repo.getSessionProjectId(sessionId);
        await this.repo.upsertSession({ ...s, branch }, projectId);
        this.emitFn("data:changed", { kind: "session" });
      }
    });
  }

  /** Start a harness run for a session id and register it. */
  /**
   * Generate a concise title for a new session from its prompt and persist it,
   * replacing the truncated-prompt fallback. Routed through the per-session
   * persist queue so it can't clobber concurrent harness-event writes, and only
   * overwrites the original fallback (never a title that changed meanwhile).
   */
  private async refineTitle(sessionId: string, prompt: string, fallbackTitle: string, model: string): Promise<void> {
    const title = await generateSessionTitle(prompt, model);
    if (!title || title === fallbackTitle) return;
    this.enqueuePersist(sessionId, async () => {
      const existing = await this.repo.getSession(sessionId);
      if (!existing || existing.title !== fallbackTitle) return;
      const projectId = await this.repo.getSessionProjectId(sessionId);
      await this.repo.upsertSession({ ...existing, title }, projectId);
      this.emitFn("data:changed", { kind: "session" });
    });
  }

  private async beginRun(
    harness: Harness,
    input: { sessionId: string; prompt: string; model?: string; cwd: string; availableRepos?: string[]; tools?: HostTool[]; notes?: { title: string; body: string }[]; references?: { title: string; url?: string; body?: string }[] },
  ): Promise<void> {
    this.resetTurnBuffer(input.sessionId);
    const run = await harness.start(
      {
        sessionId: input.sessionId,
        prompt: input.prompt,
        model: input.model,
        cwd: input.cwd,
        workspaces: [],
        availableRepos: input.availableRepos,
        tools: input.tools,
        notes: input.notes,
        references: input.references,
      },
      (event) => this.onHarnessEvent(input.sessionId, event),
    );
    this.runs.set(input.sessionId, run);
    this.lastActivity.set(input.sessionId, Date.now());
  }

  /** Send a message to a session. Sessions are single-threaded: if a turn is
   *  already in progress, the message is queued (persisted) and drained when the
   *  turn ends. Otherwise the turn starts immediately. If the in-memory run is
   *  gone (turn ended, harness crashed, app restarted), a new run is revived. */
  async sendMessage(sessionId: string, text: string): Promise<void> {
    const existing = await this.repo.getSession(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const projectId = await this.repo.getSessionProjectId(existing.id);

    if (this.activeTurns.has(sessionId)) {
      // Busy — queue the message (persisted, so it survives restart) instead of
      // sending it into a running turn.
      const queued = [...(existing.queuedMessages ?? []), text];
      await this.repo.upsertSession({ ...existing, queuedMessages: queued }, projectId);
      this.emitFn("data:changed", { kind: "session" });
      return;
    }

    // Persist the user message + running status, then run the turn.
    const userMsg: SessionMsg = { role: "user", content: text, ts: new Date().toISOString() };
    await this.repo.upsertSession(
      { ...existing, messages: [...existing.messages, userMsg], status: "running" },
      projectId,
    );
    this.emitFn("data:changed", { kind: "session" });
    await this.deliverToHarness(sessionId, text, projectId, existing.model);
  }

  /** Send a prompt to the session's harness, reviving a run if none is live.
   *  Marks the turn active; does NOT persist the user message (callers do). */
  private async deliverToHarness(sessionId: string, text: string, projectId: string | null, model?: string): Promise<void> {
    this.activeTurns.add(sessionId);
    try {
      const run = this.runs.get(sessionId);
      if (run) {
        this.resetTurnBuffer(sessionId);
        await run.send(text);
        this.lastActivity.set(sessionId, Date.now());
        return;
      }
      const settings = this.settingsFn();
      const harness = getHarness(settings);
      if (!harness) throw new Error(`No harness registered for id "${settings.harnessId ?? "mock"}"`);
      const ctx = await this.prepareWorkspace(sessionId, projectId, harness);
      await this.beginRun(harness, { sessionId, prompt: text, model: model ?? settings.defaultModel, ...ctx });
    } catch (err) {
      this.activeTurns.delete(sessionId); // never leave the session stuck "busy"
      throw err;
    }
  }

  /** Send the next queued message for a session, if any, once its turn has ended.
   *  Drives the queue for background sessions and after restart. */
  private async dispatchQueued(sessionId: string): Promise<void> {
    if (this.activeTurns.has(sessionId)) return; // a turn is (already) running
    const existing = await this.repo.getSession(sessionId);
    if (!existing) return;
    const queue = existing.queuedMessages ?? [];
    if (queue.length === 0) return;
    const [next, ...rest] = queue;
    const projectId = await this.repo.getSessionProjectId(sessionId);
    const userMsg: SessionMsg = { role: "user", content: next, ts: new Date().toISOString() };
    await this.repo.upsertSession(
      { ...existing, queuedMessages: rest, messages: [...existing.messages, userMsg], status: "running" },
      projectId,
    );
    this.emitFn("data:changed", { kind: "session" });
    await this.deliverToHarness(sessionId, next, projectId, existing.model);
  }

  /** Run a queued message now, interrupting the current turn (it's moved to the
   *  front of the queue, then the running turn is stopped so it dispatches next). */
  async interruptQueued(sessionId: string, index: number): Promise<void> {
    const existing = await this.repo.getSession(sessionId);
    if (!existing) return;
    const queue = existing.queuedMessages ?? [];
    if (index < 0 || index >= queue.length) return;
    const reordered = [queue[index], ...queue.filter((_, i) => i !== index)];
    const projectId = await this.repo.getSessionProjectId(sessionId);
    await this.repo.upsertSession({ ...existing, queuedMessages: reordered }, projectId);
    this.emitFn("data:changed", { kind: "session" });
    if (this.activeTurns.has(sessionId)) {
      await this.stopSession(sessionId); // → done → dispatchQueued sends the front
    } else {
      this.enqueuePersist(sessionId, () => this.dispatchQueued(sessionId));
    }
  }

  /** Remove a queued message without running it. */
  async removeQueued(sessionId: string, index: number): Promise<void> {
    const existing = await this.repo.getSession(sessionId);
    if (!existing) return;
    const queue = existing.queuedMessages ?? [];
    if (index < 0 || index >= queue.length) return;
    const projectId = await this.repo.getSessionProjectId(sessionId);
    await this.repo.upsertSession({ ...existing, queuedMessages: queue.filter((_, i) => i !== index) }, projectId);
    this.emitFn("data:changed", { kind: "session" });
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
        await this.repo.upsertSession(updated, await this.repo.getSessionProjectId(sessionId));
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
          // Mark as idle so it can be resumed later (preserve project association).
          await this.repo.upsertSession({ ...existing, status: "idle" }, await this.repo.getSessionProjectId(sessionId));
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
          // Session was running but has no active harness — mark as idle for
          // recovery, preserving its project association (listSessions returns
          // project-scoped sessions too, so a blanket null here orphaned them).
          const updated: Session = { ...session, status: "idle" };
          await this.repo.upsertSession(updated, await this.repo.getSessionProjectId(session.id));
          recovered.push(session.id);
        }
      }

      if (recovered.length > 0) {
        this.emitFn("data:changed", { kind: "session" });
      }

      // Drain any messages queued before the restart: kick off the first queued
      // message for each idle session (the rest follow as turns complete).
      for (const session of sessions) {
        if ((session.queuedMessages?.length ?? 0) > 0 && !this.activeTurns.has(session.id)) {
          this.enqueuePersist(session.id, () => this.dispatchQueued(session.id));
        }
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
      this.activeTurns.delete(sessionId);
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

    // The turn ended — mark it inactive and drain the next queued message (if any)
    // after the done event has been persisted. Works for background sessions too.
    if (event.type === "done") {
      this.activeTurns.delete(sessionId);
      this.enqueuePersist(sessionId, () => this.dispatchQueued(sessionId));
    }
  }

  /** Serialize repo mutations per session via a promise chain. */
  private enqueuePersist(sessionId: string, mutate: () => Promise<void>): void {
    const prev = this.persistChains.get(sessionId) ?? Promise.resolve();
    const next = prev.then(mutate, mutate).catch((err) => {
      console.error(`[SessionRuntime] persist failed for ${sessionId}:`, err);
    });
    this.persistChains.set(sessionId, next);
  }

  /** Drop any buffered in-flight-turn steps for a session (start/end of a turn). */
  private resetTurnBuffer(sessionId: string): void {
    this.pendingTurn.delete(sessionId);
    this.pendingThinking.delete(sessionId);
  }

  /** Commit the accumulated reasoning block (if any) as a thinking message. */
  private flushThinking(sessionId: string): void {
    const text = (this.pendingThinking.get(sessionId) ?? "").trim();
    this.pendingThinking.delete(sessionId);
    if (!text) return;
    const buf = this.pendingTurn.get(sessionId) ?? [];
    buf.push({ role: "thinking", content: text, ts: new Date().toISOString() });
    this.pendingTurn.set(sessionId, buf);
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
        break;

      // Thinking + tool calls are buffered for the in-flight turn and flushed to
      // the persisted transcript in order when the turn completes (see "done").
      case "reasoning_delta": {
        this.pendingThinking.set(sessionId, (this.pendingThinking.get(sessionId) ?? "") + event.delta);
        break;
      }

      case "tool_use": {
        this.flushThinking(sessionId);
        const buf = this.pendingTurn.get(sessionId) ?? [];
        buf.push({
          role: "tool",
          content: "",
          ts: new Date().toISOString(),
          tool: { name: event.name, input: event.input, callId: event.id, status: "running" },
        });
        this.pendingTurn.set(sessionId, buf);
        break;
      }

      case "tool_result": {
        const msg = this.pendingTurn.get(sessionId)?.find((m) => m.tool?.callId === event.id);
        if (msg?.tool) {
          msg.content = event.content;
          msg.tool.status = event.isError ? "error" : "ok";
        }
        break;
      }

      case "message": {
        // Buffer the final agent text; flushed (after thinking/tools) on "done".
        this.flushThinking(sessionId);
        const buf = this.pendingTurn.get(sessionId) ?? [];
        buf.push({ role: event.role, content: event.content, ts: new Date().toISOString() });
        this.pendingTurn.set(sessionId, buf);
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
        // Flush the in-flight turn's buffered steps (thinking → tools → agent
        // reply) into the persisted transcript as one ordered batch.
        this.flushThinking(sessionId);
        const buf = this.pendingTurn.get(sessionId) ?? [];
        // A user-initiated stop ends with a clear notice rather than an error.
        if (event.reason === "stopped") {
          buf.push({ role: "agent", content: "⏹ You stopped the request.", ts: new Date().toISOString() });
        }
        if (buf.length > 0) {
          updated.messages = [...updated.messages, ...buf];
          persist = true;
        }
        this.resetTurnBuffer(sessionId);
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
        // Keep any steps that happened before the failure, then the error.
        this.flushThinking(sessionId);
        const buf = this.pendingTurn.get(sessionId) ?? [];
        buf.push({ role: "agent", content: `[Error] ${event.message}`, ts: new Date().toISOString() });
        updated.messages = [...updated.messages, ...buf];
        this.resetTurnBuffer(sessionId);
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

    // M5.4 — a completed turn is meaningful project activity; nudge synthesis.
    if (event.type === "done" && event.reason === "completed" && projectId) {
      getIntelligenceService()?.notifyActivity(projectId);
    }
  }
}
