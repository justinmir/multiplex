import type { ActivityItem, Note, Project, Reference, Session } from "./domain.js";

/** Scoped access to references — either by project or by session. */
export type RefScope = { projectId: string; sessionId?: never } | { sessionId: string; projectId?: never };

export interface Repository {
  // ---- projects ----
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  upsertProject(p: Project): Promise<Project>;

  // ---- sessions (standalone = projectId null) ----
  listSessions(opts?: { projectId?: string | null }): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  upsertSession(s: Session, projectId: string | null): Promise<Session>;
  /** The project a session belongs to, or null if standalone / unknown. */
  getSessionProjectId(id: string): Promise<string | null>;

  // ---- notes scoped to a project ----
  getNotes(projectId: string): Promise<Note[]>;
  upsertNote(projectId: string, n: Note): Promise<Note>;
  deleteNote(projectId: string, noteId: string): Promise<void>;

  // ---- references scoped to a project or session ----
  getReferences(scope: RefScope): Promise<Reference[]>;
  upsertReference(scope: RefScope, r: Reference): Promise<Reference>;
  deleteReference(scope: RefScope, refId: string): Promise<void>;

  // ---- activity log (append-only per project) ----
  appendActivity(projectId: string, a: ActivityItem): Promise<void>;
  getActivity(projectId: string): Promise<ActivityItem[]>;

  // ---- archive ----
  archiveSession(id: string): Promise<void>;
}
