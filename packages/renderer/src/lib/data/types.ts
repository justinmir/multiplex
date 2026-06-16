import type { Note, Project, Reference, RefScope, Session, SessionMsg, SessionStatus } from "@app/core";

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
  archiveSession(sessionId: string): Promise<void>;

  // writes (M3.3 — session-scoped references)
  upsertSessionReference(sessionId: string, reference: Reference): Promise<Reference>;
  deleteSessionReference(sessionId: string, refId: string): Promise<void>;

  // writes (M3.1 — session CRUD)
  createSession(session: Session, projectId?: string): Promise<Session>;
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  // writes (M2.5 — project management + sync)
  upsertProject(project: Project): Promise<Project>;
  syncProject(projectId: string): Promise<Project | null>;
  getGithubStatus(): Promise<{ connected: boolean }>;

  // writes (M3.4 — agent workflow foundation)
  addMessage(sessionId: string, message: SessionMsg): Promise<void>;
  startAgent(sessionId: string): Promise<void>;
  stopAgent(sessionId: string): Promise<void>;

  // M4.2 — GitHub connect flow
  connectGitHub(): Promise<{ success: boolean }>;

  // M4.3 — PR merge + external links
  mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }>;
  openUrl(url: string): Promise<void>;
}
