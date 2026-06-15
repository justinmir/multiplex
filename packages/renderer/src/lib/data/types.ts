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
  archiveSession(sessionId: string): Promise<void>;

  // writes (M3.1 — session CRUD)
  createSession(session: Session, projectId?: string): Promise<Session>;
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  // writes (M2.5 — project management + sync)
  upsertProject(project: Project): Promise<Project>;
  syncProject(projectId: string): Promise<Project | null>;
  getGithubStatus(): Promise<{ connected: boolean }>;
}
