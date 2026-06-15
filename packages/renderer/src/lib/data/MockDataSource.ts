import type { DataSource } from "./types.js";
import type { Note, Project, Reference, RefScope, Session, SessionStatus } from "@app/core";
import { projects as mockProjects, standaloneSessions as mockSessions } from "../../app/data/mockData.js";

export class MockDataSource implements DataSource {
  async listProjects(): Promise<Project[]> {
    return [...mockProjects];
  }

  async getProject(id: string): Promise<Project | null> {
    return mockProjects.find((p) => p.id === id) ?? null;
  }

  async listStandaloneSessions(): Promise<Session[]> {
    return [...mockSessions];
  }

  async getSession(id: string): Promise<Session | null> {
    return mockSessions.find((s) => s.id === id) ?? null;
  }

  // ---- writes (M1.5 — no-ops for mock data source) ----

  async upsertNote(_projectId: string, note: Note): Promise<Note> {
    return note;
  }

  async deleteNote(_projectId: string, _noteId: string): Promise<void> {
    // no-op in mock
  }

  async upsertReference(_scope: RefScope, reference: Reference): Promise<Reference> {
    return reference;
  }

  async deleteReference(_scope: RefScope, _refId: string): Promise<void> {
    // no-op in mock
  }

  async archiveSession(_sessionId: string): Promise<void> {
    // no-op in mock
  }

  // ---- writes (M3.1 — no-ops for mock data source) ----

  async createSession(session: Session, _projectId?: string): Promise<Session> {
    return session;
  }

  async updateSessionStatus(_sessionId: string, _status: SessionStatus): Promise<void> {
    // no-op in mock
  }

  // ---- writes (M2.5 — no-ops for mock data source) ----

  async upsertProject(project: Project): Promise<Project> {
    return project;
  }

  async syncProject(_projectId: string): Promise<Project | null> {
    return null;
  }

  async getGithubStatus(): Promise<{ connected: boolean }> {
    return { connected: false };
  }
}
