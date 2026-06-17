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

  // ---- writes (M3.3 — session-scoped references) ----

  async upsertSessionReference(sessionId: string, reference: Reference): Promise<Reference> {
    return call("refs:upsert", { scope: { sessionId }, reference });
  }

  async deleteSessionReference(sessionId: string, refId: string): Promise<void> {
    return call("refs:delete", { scope: { sessionId }, refId });
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

  async getGithubStatus(): Promise<{ connected: boolean; oauthAvailable: boolean }> {
    return call("github:get-status", undefined as never);
  }

  // ---- M4.2 — GitHub connect flow ----

  async connectGitHub(): Promise<{ success: boolean }> {
    return call("github:connect", undefined as never);
  }

  // ---- M4.3 — PR merge + external links ----

  async mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }> {
    return call("prs:merge", { owner, repo, prNumber });
  }

  async openUrl(url: string): Promise<void> {
    return call("app:open-url", { url });
  }

  // ---- M-A5 — Session runtime (live agent harness) ----

  async startSession(input: { sessionId?: string; prompt: string; projectId?: string | null; model?: string }): Promise<{ sessionId: string }> {
    return call("session:start", input);
  }

  async sendToSession(sessionId: string, message: string): Promise<void> {
    return call("session:send", { sessionId, message });
  }

  async stopSession(sessionId: string): Promise<void> {
    return call("session:stop", { sessionId });
  }

  async interruptQueuedMessage(sessionId: string, index: number): Promise<void> {
    return call("session:queue:interrupt", { sessionId, index });
  }

  async removeQueuedMessage(sessionId: string, index: number): Promise<void> {
    return call("session:queue:remove", { sessionId, index });
  }

  async editSessionPrompt(sessionId: string, prompt: string): Promise<void> {
    return call("session:edit-prompt", { sessionId, prompt });
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    return call("sessions:rename", { sessionId, title });
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<void> {
    return call("sessions:set-pinned", { sessionId, pinned });
  }

  // ---- M-A8 — Harness health + model list ----

  async harnessHealth(harnessId: string): Promise<{ ok: boolean; version?: string; detail?: string }> {
    return call("harness:health", { harnessId });
  }

  async harnessModels(harnessId: string): Promise<Array<{ id: string; label?: string; provider?: string }>> {
    return call("harness:models", { harnessId });
  }
}
