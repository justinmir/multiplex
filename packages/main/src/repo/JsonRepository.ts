import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

import type { ActivityItem, Note, Project, Reference, RefScope, Session } from "@app/core";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { DB_PATH, ensureDir } from "./paths.js";
import { seedProjects, seedStandaloneSessions } from "./seed.js";

/** Serialized snapshot of the entire repository. */
interface DbSnapshot {
  version: number;
  projects: Project[];
  // standalone sessions (projectId === null)
  standaloneSessions: Session[];
}

export class JsonRepository extends InMemoryRepository {
  private dbPath: string;

  constructor(dbPath?: string) {
    super();
    this.dbPath = dbPath ?? DB_PATH;
    ensureDir();
    this.loadFromDisk();
  }

  // ---- load / seed ----

  private loadFromDisk(): void {
    if (!existsSync(this.dbPath)) {
      this.seed();
      return;
    }
    try {
      const raw = readFileSync(this.dbPath, "utf-8");
      const snap: DbSnapshot = JSON.parse(raw);
      // Reset maps before loading to avoid stale data on re-init
      this.projects.clear();
      this.sessions.clear();
      this.sessionProjectId.clear();
      this.notes.clear();
      this.references.clear();
      this.activity.clear();

      for (const p of snap.projects) {
        this.projects.set(p.id, p);
        // Also load nested sessions scoped to project
        if (p.sessions?.length) {
          for (const s of p.sessions) {
            this.sessions.set(s.id, s);
            this.sessionProjectId.set(s.id, p.id);
          }
        }
      }

      // Standalone sessions
      for (const s of snap.standaloneSessions ?? []) {
        this.sessions.set(s.id, s);
        this.sessionProjectId.set(s.id, null);
      }
    } catch (err) {
      // Corrupt JSON — backup and re-seed
      console.error(`[JsonRepository] corrupt db at ${this.dbPath}, seeding fresh.`, err);
      const bak = `${this.dbPath}.bak.${Date.now()}`;
      try { renameSync(this.dbPath, bak); } catch { /* ignore */ }
      this.projects.clear();
      this.sessions.clear();
      this.sessionProjectId.clear();
      this.notes.clear();
      this.references.clear();
      this.activity.clear();
      this.seed();
    }
  }

  private seed(): void {
    for (const p of seedProjects) {
      this.projects.set(p.id, p);
      if (p.sessions?.length) {
        for (const s of p.sessions) {
          this.sessions.set(s.id, s);
          this.sessionProjectId.set(s.id, p.id);
        }
      }
    }

    // Seed IDs use string format (e.g. "p_ingest", "ss_changelog") so they won't
    // collide with counter-based IDs (e.g. "proj_1", "sess_2").

    for (const s of seedStandaloneSessions) {
      this.sessions.set(s.id, s);
      this.sessionProjectId.set(s.id, null);
    }

    this.saveToDisk();
  }

  // ---- save (atomic: write temp → rename) ----

  private serialize(): DbSnapshot {
    const projects = Array.from(this.projects.values());

    const standaloneSessions: Session[] = [];
    for (const [sid, projId] of this.sessionProjectId) {
      if (projId === null) {
        const s = this.sessions.get(sid);
        if (s) standaloneSessions.push(s);
      }
    }

    return { version: 1, projects, standaloneSessions };
  }

  private saveToDisk(): void {
    try {
      ensureDir();
      const snap = this.serialize();
      const tmpPath = join(dirname(this.dbPath), `.db-${Date.now()}.tmp`);
      writeFileSync(tmpPath, JSON.stringify(snap, null, 2), "utf-8");
      renameSync(tmpPath, this.dbPath);
    } catch (err) {
      console.error("[JsonRepository] saveToDisk failed:", err);
    }
  }

  // ---- override every mutating method to persist ----

  async upsertProject(p: Project): Promise<Project> {
    const result = await super.upsertProject(p);
    this.saveToDisk();
    return result;
  }

  async upsertSession(s: Session, projectId: string | null): Promise<Session> {
    const result = await super.upsertSession(s, projectId);
    this.saveToDisk();
    return result;
  }

  async upsertNote(projectId: string, n: Note): Promise<Note> {
    const result = await super.upsertNote(projectId, n);
    this.saveToDisk();
    return result;
  }

  async deleteNote(projectId: string, noteId: string): Promise<void> {
    await super.deleteNote(projectId, noteId);
    this.saveToDisk();
  }

  async upsertReference(scope: RefScope, r: Reference): Promise<Reference> {
    const result = await super.upsertReference(scope, r);
    this.saveToDisk();
    return result;
  }

  async deleteReference(scope: RefScope, refId: string): Promise<void> {
    await super.deleteReference(scope, refId);
    this.saveToDisk();
  }

  async appendActivity(projectId: string, a: ActivityItem): Promise<void> {
    await super.appendActivity(projectId, a);
    this.saveToDisk();
  }

  async archiveSession(id: string): Promise<void> {
    await super.archiveSession(id);
    this.saveToDisk();
  }
}
