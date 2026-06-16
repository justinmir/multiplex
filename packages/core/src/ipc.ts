import type { CheckRun, Note, Project, PullRequest, Reference, Session, SessionMsg, SessionStatus } from "./domain.js";
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

  // M2.2 — GitHub OAuth + token management
  "github:get-token": { req: void; res: string | null };
  "github:connect": { req: void; res: { success: boolean } };
  "github:get-status": { req: void; res: { connected: boolean } };

  // M2.3 — GitHub API client (Octokit)
  "prs:list": { req: { owner: string; repo: string }; res: PullRequest[] };
  "checks:get": { req: { owner: string; repo: string; branch: string }; res: CheckRun[] };

  // M2.4 — Project sync with GitHub
  "projects:sync": { req: { projectId: string }; res: Project | null };

  // M2.5 — Project CRUD (github:get-status already exists in M2.2)
  "projects:upsert": { req: { project: Project }; res: Project };

  // M3.4 — Agent workflow foundation (message streaming + agent execution stub)
  "sessions:add-message": { req: { sessionId: string; message: SessionMsg }; res: void };
  "agents:start": { req: { sessionId: string }; res: void };
  "agents:stop": { req: { sessionId: string }; res: void };

  // M4.3 — PR merge + external links
  "prs:merge": { req: { owner: string; repo: string; prNumber: number }; res: { success: boolean } };
  "app:open-url": { req: { url: string }; res: void };

  // M6.3 — Global search (future-proofing for server-side search)
  "search:query": { req: { q: string }; res: Array<{ kind: "project" | "session" | "pr"; id: string; title: string; subtitle?: string }> };
}
export type IpcChannel = keyof IpcContract;
export type IpcReq<C extends IpcChannel> = IpcContract[C]["req"];
export type IpcRes<C extends IpcChannel> = IpcContract[C]["res"];

/** Server→client push events. Topic is a runtime string; payloads typed by prefix. */
export interface AppEvent<T = unknown> { topic: string; payload: T; ts: number; }
