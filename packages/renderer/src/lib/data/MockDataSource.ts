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

  // ---- writes ----

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

  async archiveSession(_sessionId: string, _archived = true): Promise<void> {
    // no-op in mock
  }

  // ---- writes ----

  async upsertSessionReference(_sessionId: string, reference: Reference): Promise<Reference> {
    return reference;
  }

  async deleteSessionReference(_sessionId: string, _refId: string): Promise<void> {
    // no-op in mock
  }

  // ---- writes ----

  async createSession(session: Session, _projectId?: string): Promise<Session> {
    return session;
  }

  async updateSessionStatus(_sessionId: string, _status: SessionStatus): Promise<void> {
    // no-op in mock
  }

  // ---- writes ----

  async upsertProject(project: Project): Promise<Project> {
    return project;
  }

  async syncProject(_projectId: string): Promise<Project | null> {
    return null;
  }

  async getGithubStatus(): Promise<{ connected: boolean; oauthAvailable: boolean }> {
    return { connected: false, oauthAvailable: false };
  }

  // ---- GitHub connect flow (stub) ----

  async connectGitHub(): Promise<{ success: boolean }> {
    return { success: false };
  }

  // ---- PR merge + external links (stubs) ----

  async mergePR(_owner: string, _repo: string, _prNumber: number): Promise<{ success: boolean }> {
    return { success: false };
  }

  async openUrl(_url: string): Promise<void> {
    // no-op in mock — renderer can't open external URLs without IPC
  }

  // ---- Session runtime (stubs for mock) ----

  async startSession(input: { sessionId?: string; prompt: string; projectId?: string | null; model?: string }): Promise<{ sessionId: string }> {
    return { sessionId: input.sessionId ?? `mock_${Date.now().toString(36)}` };
  }

  async sendToSession(_sessionId: string, _message: string): Promise<void> {}

  async stopSession(_sessionId: string): Promise<void> {}
  async interruptQueuedMessage(_sessionId: string, _index: number): Promise<void> {}
  async removeQueuedMessage(_sessionId: string, _index: number): Promise<void> {}
  async editSessionPrompt(_sessionId: string, _prompt: string): Promise<void> {}
  async renameSession(_sessionId: string, _title: string): Promise<void> {}
  async setSessionPinned(_sessionId: string, _pinned: boolean): Promise<void> {}

  // ---- Harness health + model list (stubs for mock) ----

  async harnessHealth(_harnessId: string): Promise<{ ok: boolean; version?: string; detail?: string }> {
    return { ok: true, version: "mock-1.0.0" };
  }

  async harnessModels(_harnessId: string): Promise<Array<{ id: string; label?: string; provider?: string }>> {
    return [
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", provider: "anthropic" },
      { id: "openai/gpt-4.1", label: "GPT-4.1", provider: "openai" },
    ];
  }
}
