import type { Note, Project, Reference, RefScope, Session } from "@app/core";

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
}
