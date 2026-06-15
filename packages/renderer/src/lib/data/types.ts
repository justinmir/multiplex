import type { Project, Session } from "@app/core";

export interface DataSource {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  listStandaloneSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
}
