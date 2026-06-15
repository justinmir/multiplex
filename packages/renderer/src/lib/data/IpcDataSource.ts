import type { DataSource } from "./types.js";
import type { Project, Session } from "@app/core";
import { call } from "../ipc/client.js";

/** Fetches data from the main process via IPC (backed by JsonRepository → db.json). */
export class IpcDataSource implements DataSource {
  async listProjects(): Promise<Project[]> {
    // req type is `void` for this channel; TypeScript allows undefined as a stand-in
    return call("projects:list", undefined as never);
  }

  async getProject(id: string): Promise<Project | null> {
    return call("projects:get", { id });
  }

  async listStandaloneSessions(): Promise<Session[]> {
    // Pass projectId: null to filter only sessions not attached to any project
    return call("sessions:list", { projectId: null });
  }

  async getSession(id: string): Promise<Session | null> {
    return call("sessions:get", { id });
  }
}
