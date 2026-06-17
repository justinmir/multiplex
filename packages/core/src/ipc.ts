import type { CheckRun, FileChange, Note, Project, PullRequest, Reference, Session, SessionStatus, TokenUsageEvent } from "./domain.js";
import type { RefScope } from "./repository.js";

export const EVENT_CHANNEL = "multiplex:event" as const;

/** Request/response channels. Add one entry per feature. */
export interface IpcContract {
  "app:ping": { req: { value: string }; res: { value: string; ts: number } };

  // repository read channels
  "projects:list": { req: void; res: Project[] };
  "projects:get": { req: { id: string }; res: Project | null };
  "sessions:list": { req: { projectId?: string | null }; res: Session[] };
  "sessions:get": { req: { id: string }; res: Session | null };

  // write channels (persisted via JsonRepository)
  "notes:upsert": { req: { projectId: string; note: Note }; res: Note };
  "notes:delete": { req: { projectId: string; noteId: string }; res: void };
  "refs:upsert": { req: { scope: RefScope; reference: Reference }; res: Reference };
  "refs:delete": { req: { scope: RefScope; refId: string }; res: void };
  "sessions:archive": { req: { sessionId: string; archived?: boolean }; res: void };

  // Session CRUD (create + status update)
  "sessions:create": { req: { session: Session; projectId?: string }; res: Session };
  "sessions:update-status": { req: { sessionId: string; status: SessionStatus }; res: void };
  "sessions:rename": { req: { sessionId: string; title: string }; res: void };
  "sessions:set-pinned": { req: { sessionId: string; pinned: boolean }; res: void };

  // GitHub OAuth + connection status (the token never leaves main)
  "github:connect": { req: void; res: { success: boolean } };
  "github:get-status": { req: void; res: { connected: boolean; oauthAvailable: boolean } };
  // Validate + store a personal access token; returns the authenticated login.
  "github:set-token": { req: { token: string }; res: { connected: boolean; login?: string; error?: string } };

  // GitHub API client (Octokit)
  "prs:list": { req: { owner: string; repo: string }; res: PullRequest[] };
  "checks:get": { req: { owner: string; repo: string; branch: string }; res: CheckRun[] };

  // Project sync with GitHub
  "projects:sync": { req: { projectId: string }; res: Project | null };

  // Project CRUD (github:get-status already exists)
  "projects:upsert": { req: { project: Project }; res: Project };

  // Session runtime (replaces stub with real agent harness)
  "session:start": {
    req: { sessionId?: string; prompt: string; projectId?: string | null; model?: string };
    res: { sessionId: string };
  };
  "session:send": { req: { sessionId: string; message: string }; res: void };
  "session:stop": { req: { sessionId: string }; res: void };
  // Replace the last user prompt and re-run it (in-place prompt editor).
  "session:edit-prompt": { req: { sessionId: string; prompt: string }; res: void };
  // Queue management: run a queued message now (interrupting the current turn),
  // or remove it from the queue.
  "session:queue:interrupt": { req: { sessionId: string; index: number }; res: void };
  "session:queue:remove": { req: { sessionId: string; index: number }; res: void };

  // Harness health + model list
  "harness:health": { req: { harnessId: string }; res: { ok: boolean; version?: string; detail?: string } };
  "harness:models": { req: { harnessId: string }; res: Array<{ id: string; label?: string; provider?: string }> };

  // PR merge + external links
  "prs:merge": { req: { owner: string; repo: string; prNumber: number }; res: { success: boolean } };
  "app:open-url": { req: { url: string }; res: void };
  "app:version": { req: void; res: { version: string; isPackaged: boolean } };

  // Global search over real projects, sessions, and PRs
  "search:query": { req: { q: string }; res: Array<{ kind: "project" | "session" | "pr"; id: string; title: string; subtitle?: string; projectId?: string; status?: SessionStatus }> };

  // Settings surface (consolidate)
  "settings:get": { req: void; res: AppSettingsData };
  "settings:set": { req: Partial<AppSettingsData>; res: AppSettingsData };

  // Repo catalog (registry of available repos the agent may declare)
  "repos:list": { req: void; res: Array<{ name: string; root: string }> };
  "repos:add": { req: { root: string; name?: string }; res: { ok: boolean; name?: string; error?: string } };
  "repos:remove": { req: { name: string }; res: void };

  // Real diffs across a session's materialized worktrees
  "session:changes": { req: { sessionId: string }; res: Array<{ repo: string; files: FileChange[] }> };

  // Live PR detail (files / comments / checks) for a session's PRs.
  // Served from the background poller's cache (no live request on read).
  "pr:get": { req: { repo: string; number: number }; res: PullRequest | null };
  // Manual "sync now": force-refresh a session's open PRs and return them.
  "session:refresh-prs": { req: { sessionId: string }; res: PullRequest[] };

  // PR actions
  "pr:reply": { req: { repo: string; number: number; commentId: string; body: string }; res: void };
  "pr:rerun": { req: { repo: string; number: number }; res: void };
  "session:address-comments": { req: { sessionId: string; comments: string[] }; res: void };

  // Open draft PRs for every touched repo with changes
  "session:open-pr": { req: { sessionId: string }; res: { opened: PullRequest[]; message?: string } };

  // Project intelligence: (re)synthesize summary + next steps
  "project:resynthesize": { req: { projectId: string }; res: { summary: string; nextSteps: string[]; synthesizedAtMs: number } | null };
  // (Re)index every reference of a project via the harness (web/MCP tools).
  "refs:index": { req: { projectId: string }; res: void };
  // Suggested session prompts for the project-less "new session" view.
  "suggestions:global": { req: void; res: string[] };
  // Token-usage analytics: events at/after `sinceMs` (oldest first).
  "analytics:tokens": { req: { sinceMs?: number }; res: TokenUsageEvent[] };
}

export interface AppSettingsData {
  harnessId?: "mock" | "opencode";
  defaultModel?: string;
  /** Persistence backend (takes effect on restart). Default "json". */
  repoBackend?: "json" | "sqlite";
  /** GitHub token. Stored in main; redacted from settings:get/set responses
   *  (write-only from the renderer's perspective — it never reads it back). */
  githubToken?: string;
  repoRoots: Array<{ name: string; root: string }>;
  intelligenceEnabled: boolean;
  autoSynthesizeOnActivity: boolean;
  /** Auto-resynthesize each active project this often (minutes). Default 60. */
  synthesisIntervalMinutes?: number;
  /** Background refresh cadence for open PRs' status (minutes). Default 5. */
  prPollIntervalMinutes?: number;
}
export type IpcChannel = keyof IpcContract;
export type IpcReq<C extends IpcChannel> = IpcContract[C]["req"];
export type IpcRes<C extends IpcChannel> = IpcContract[C]["res"];

/** Server→client push events. Topic is a runtime string; payloads typed by prefix. */
export interface AppEvent<T = unknown> { topic: string; payload: T; ts: number; }
