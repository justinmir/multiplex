import type { CheckRun, FileChange, Note, Project, PullRequest, Reference, Session, SessionStatus } from "./domain.js";
import type { RefScope } from "./repository.js";

export const EVENT_CHANNEL = "multiplex:event" as const;

/** Request/response channels. Add one entry per feature. */
export interface IpcContract {
  "app:ping": { req: { value: string }; res: { value: string; ts: number } };

  // M1.3 — repository read channels
  "projects:list": { req: void; res: Project[] };
  "projects:get": { req: { id: string }; res: Project | null };
  "sessions:list": { req: { projectId?: string | null }; res: Session[] };
  "sessions:get": { req: { id: string }; res: Session | null };

  // M1.5 — write channels (persisted via JsonRepository)
  "notes:upsert": { req: { projectId: string; note: Note }; res: Note };
  "notes:delete": { req: { projectId: string; noteId: string }; res: void };
  "refs:upsert": { req: { scope: RefScope; reference: Reference }; res: Reference };
  "refs:delete": { req: { scope: RefScope; refId: string }; res: void };
  "sessions:archive": { req: { sessionId: string }; res: void };

  // M3.1 — Session CRUD (create + status update)
  "sessions:create": { req: { session: Session; projectId?: string }; res: Session };
  "sessions:update-status": { req: { sessionId: string; status: SessionStatus }; res: void };

  // M2.2 — GitHub OAuth + connection status (the token never leaves main)
  "github:connect": { req: void; res: { success: boolean } };
  "github:get-status": { req: void; res: { connected: boolean; oauthAvailable: boolean } };
  // Validate + store a personal access token; returns the authenticated login.
  "github:set-token": { req: { token: string }; res: { connected: boolean; login?: string; error?: string } };

  // M2.3 — GitHub API client (Octokit)
  "prs:list": { req: { owner: string; repo: string }; res: PullRequest[] };
  "checks:get": { req: { owner: string; repo: string; branch: string }; res: CheckRun[] };

  // M2.4 — Project sync with GitHub
  "projects:sync": { req: { projectId: string }; res: Project | null };

  // M2.5 — Project CRUD (github:get-status already exists in M2.2)
  "projects:upsert": { req: { project: Project }; res: Project };

  // M-A4 — Session runtime (replaces stub with real agent harness)
  "session:start": {
    req: { sessionId?: string; prompt: string; projectId?: string | null; model?: string };
    res: { sessionId: string };
  };
  "session:send": { req: { sessionId: string; message: string }; res: void };
  "session:stop": { req: { sessionId: string }; res: void };

  // M-A8 — Harness health + model list
  "harness:health": { req: { harnessId: string }; res: { ok: boolean; version?: string; detail?: string } };
  "harness:models": { req: { harnessId: string }; res: Array<{ id: string; label?: string; provider?: string }> };

  // M4.3 — PR merge + external links
  "prs:merge": { req: { owner: string; repo: string; prNumber: number }; res: { success: boolean } };
  "app:open-url": { req: { url: string }; res: void };

  // M6.3 — Global search over real projects, sessions, and PRs
  "search:query": { req: { q: string }; res: Array<{ kind: "project" | "session" | "pr"; id: string; title: string; subtitle?: string; projectId?: string; status?: SessionStatus }> };

  // M6.4 — Settings surface (consolidate)
  "settings:get": { req: void; res: AppSettingsData };
  "settings:set": { req: Partial<AppSettingsData>; res: AppSettingsData };

  // M-C2 — Repo catalog (registry of available repos the agent may declare)
  "repos:list": { req: void; res: Array<{ name: string; root: string }> };
  "repos:add": { req: { root: string; name?: string }; res: { ok: boolean; name?: string; error?: string } };
  "repos:remove": { req: { name: string }; res: void };

  // M-C4 — Real diffs across a session's materialized worktrees
  "session:changes": { req: { sessionId: string }; res: Array<{ repo: string; files: FileChange[] }> };

  // M-B3 — Live PR detail (files / comments / checks) for a session's PRs
  "pr:get": { req: { repo: string; number: number }; res: PullRequest | null };

  // M-B4 — PR actions
  "pr:reply": { req: { repo: string; number: number; commentId: string; body: string }; res: void };
  "pr:rerun": { req: { repo: string; number: number }; res: void };
  "session:address-comments": { req: { sessionId: string; comments: string[] }; res: void };

  // M-B5 — Open draft PRs for every touched repo with changes
  "session:open-pr": { req: { sessionId: string }; res: { opened: PullRequest[]; message?: string } };

  // M5.3 — Project intelligence: (re)synthesize summary + next steps
  "project:resynthesize": { req: { projectId: string }; res: { summary: string; nextSteps: string[]; synthesizedAtMs: number } | null };
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
}
export type IpcChannel = keyof IpcContract;
export type IpcReq<C extends IpcChannel> = IpcContract[C]["req"];
export type IpcRes<C extends IpcChannel> = IpcContract[C]["res"];

/** Server→client push events. Topic is a runtime string; payloads typed by prefix. */
export interface AppEvent<T = unknown> { topic: string; payload: T; ts: number; }
