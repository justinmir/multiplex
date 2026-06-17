import type { Note, Project, Reference, RefScope, Session, SessionStatus } from "@app/core";

export interface DataSource {
  // reads
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  listStandaloneSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;

  // writes
  upsertNote(projectId: string, note: Note): Promise<Note>;
  deleteNote(projectId: string, noteId: string): Promise<void>;
  upsertReference(scope: RefScope, reference: Reference): Promise<Reference>;
  deleteReference(scope: RefScope, refId: string): Promise<void>;
  archiveSession(sessionId: string, archived?: boolean): Promise<void>;

  // writes
  upsertSessionReference(sessionId: string, reference: Reference): Promise<Reference>;
  deleteSessionReference(sessionId: string, refId: string): Promise<void>;

  // writes
  createSession(session: Session, projectId?: string): Promise<Session>;
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  // writes
  upsertProject(project: Project): Promise<Project>;
  syncProject(projectId: string): Promise<Project | null>;
  getGithubStatus(): Promise<{ connected: boolean; oauthAvailable: boolean }>;

  // GitHub connect flow
  connectGitHub(): Promise<{ success: boolean }>;

  // PR merge + external links
  mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }>;
  openUrl(url: string): Promise<void>;

  // Session runtime (live agent harness)
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

  // Harness health + model list
  harnessHealth(harnessId: string): Promise<{ ok: boolean; version?: string; detail?: string }>;
  harnessModels(harnessId: string): Promise<Array<{ id: string; label?: string; provider?: string }>>;
}
