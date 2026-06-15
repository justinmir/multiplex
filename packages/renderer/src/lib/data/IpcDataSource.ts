import type { DataSource } from "./types.js";
import type { Note, Project, Reference, RefScope, Session, SessionStatus } from "@app/core";
import { call } from "../ipc/client.js";

/** Fetches data from the main process via IPC (backed by JsonRepository → db.json). */
export class IpcDataSource implements DataSource {
  // ---- reads ----

  async listProjects(): Promise<Project[]> {
    return call("projects:list", undefined as never);
  }

  async getProject(id: string): Promise<Project | null> {
    return call("projects:get", { id });
  }

  async listStandaloneSessions(): Promise<Session[]> {
    return call("sessions:list", { projectId: null });
  }

  async getSession(id: string): Promise<Session | null> {
    return call("sessions:get", { id });
  }

  // ---- writes (M1.5) ----

  async upsertNote(projectId: string, note: Note): Promise<Note> {
    return call("notes:upsert", { projectId, note });
  }

  async deleteNote(projectId: string, noteId: string): Promise<void> {
    return call("notes:delete", { projectId, noteId });
  }

  async upsertReference(scope: RefScope, reference: Reference): Promise<Reference> {
    return call("refs:upsert", { scope, reference });
  }

  async deleteReference(scope: RefScope, refId: string): Promise<void> {
    return call("refs:delete", { scope, refId });
  }

  async archiveSession(sessionId: string): Promise<void> {
    return call("sessions:archive", { sessionId });
  }

  // ---- writes (M3.1 — session CRUD) ----

  async createSession(session: Session, projectId?: string): Promise<Session> {
    return call("sessions:create", { session, projectId });
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    return call("sessions:update-status", { sessionId, status });
  }

  // ---- writes (M2.5 — project management + sync) ----

  async upsertProject(project: Project): Promise<Project> {
    return call("projects:upsert", { project });
  }

  async syncProject(projectId: string): Promise<Project | null> {
    return call("projects:sync", { projectId });
  }

  async getGithubStatus(): Promise<{ connected: boolean }> {
    return call("github:get-status", undefined as never);
  }
}
