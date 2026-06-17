import type { Note, Project, Reference, RefScope, Session, SessionStatus } from "@app/core";

export interface DataSource {
  // reads
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  listStandaloneSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;

  // writes (M1.5)
  upsertNote(projectId: string, note: Note): Promise<Note>;
  deleteNote(projectId: string, noteId: string): Promise<void>;
  upsertReference(scope: RefScope, reference: Reference): Promise<Reference>;
  deleteReference(scope: RefScope, refId: string): Promise<void>;
  archiveSession(sessionId: string, archived?: boolean): Promise<void>;

  // writes (M3.3 — session-scoped references)
  upsertSessionReference(sessionId: string, reference: Reference): Promise<Reference>;
  deleteSessionReference(sessionId: string, refId: string): Promise<void>;

  // writes (M3.1 — session CRUD)
  createSession(session: Session, projectId?: string): Promise<Session>;
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  // writes (M2.5 — project management + sync)
  upsertProject(project: Project): Promise<Project>;
  syncProject(projectId: string): Promise<Project | null>;
  getGithubStatus(): Promise<{ connected: boolean; oauthAvailable: boolean }>;

  // M4.2 — GitHub connect flow
  connectGitHub(): Promise<{ success: boolean }>;

  // M4.3 — PR merge + external links
  mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }>;
  openUrl(url: string): Promise<void>;

  // M-A5 — Session runtime (live agent harness)
  startSession(input: { sessionId?: string; prompt: string; projectId?: string | null; model?: string }): Promise<{ sessionId: string }>;
  sendToSession(sessionId: string, message: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  /** Queue management for a session's pending messages. */
  interruptQueuedMessage(sessionId: string, index: number): Promise<void>;
  removeQueuedMessage(sessionId: string, index: number): Promise<void>;
  /** Replace the last user prompt and re-run it. */
  editSessionPrompt(sessionId: string, prompt: string): Promise<void>;
  /** Rename a session. */
  renameSession(sessionId: string, title: string): Promise<void>;
  /** Pin/unpin a session (sorts to the top of the sidebar). */
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;

  // M-A8 — Harness health + model list
  harnessHealth(harnessId: string): Promise<{ ok: boolean; version?: string; detail?: string }>;
  harnessModels(harnessId: string): Promise<Array<{ id: string; label?: string; provider?: string }>>;
}
