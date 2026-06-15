import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

import type { ActivityItem, Note, Project, Reference, RefScope, Session } from "@app/core";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { DB_PATH, ensureDir } from "./paths.js";
import { seedProjects, seedStandaloneSessions } from "./seed.js";

/** A note serialized with its project scope so the composite key can be reconstructed. */
interface NoteEntry {
  projectId: string;
  note: Note;
}

/** A reference serialized with its scope so the composite key can be reconstructed. */
interface ReferenceEntry {
  scope: RefScope;
  reference: Reference;
}

/** Serialized snapshot of the entire repository. */
interface DbSnapshot {
  version: number;
  projects: Project[];
  // standalone sessions (projectId === null)
  standaloneSessions: Session[];
  notes: NoteEntry[];
  references: ReferenceEntry[];
  activity: Record<string, ActivityItem[]>;
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

      // Notes — reconstruct composite keys from serialized projectId
      for (const entry of snap.notes ?? []) {
        const key = `${entry.projectId}::${entry.note.id}`;
        this.notes.set(key, entry.note);
      }

      // References — reconstruct composite keys from serialized scope
      for (const entry of snap.references ?? []) {
        if ("projectId" in entry.scope) {
          const key = `proj:${entry.scope.projectId}::${entry.reference.id}`;
          this.references.set(key, entry.reference);
        } else if ("sessionId" in entry.scope) {
          const key = `sess:${entry.scope.sessionId}::${entry.reference.id}`;
          this.references.set(key, entry.reference);
        }
      }

      // Activity — restore flat entries per project ID
      for (const [projectId, items] of Object.entries(snap.activity ?? {})) {
        if (items.length) {
          this.activity.set(projectId, items);
        }
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

          // Seed session-scoped references embedded in each session
          if (s.references?.length) {
            for (const ref of s.references) {
              const scope: RefScope = { sessionId: s.id };
              this.upsertReferenceSync(scope, ref);
            }
          }
        }
      }

      // Seed project-scoped notes embedded in the Project object
      if (p.notes?.length) {
        for (const n of p.notes) {
          const withId = n.id ? { ...n } : { ...n, id: this.nextId("note") };
          this.notes.set(`${p.id}::${withId.id}`, withId);
        }
      }

      // Seed project-scoped references embedded in the Project object
      if (p.references?.length) {
        for (const r of p.references) {
          const scope: RefScope = { projectId: p.id };
          this.upsertReferenceSync(scope, r);
        }
      }

      // Seed project-scoped activity log embedded in the Project object
      if (p.activity?.length) {
        this.activity.set(p.id, p.activity);
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

  // ---- save (atomic: write temp -> rename) ----

  private serialize(): DbSnapshot {
    const projects = this.listProjectsSync();
    const standaloneSessions = this.listStandaloneSessionsSync();

    // Notes — extract projectId from composite key for deserialization
    const notes: NoteEntry[] = [];
    for (const [key, note] of this.notes) {
      const idx = key.indexOf("::");
      if (idx === -1) continue; // malformed key, skip
      const projectId = key.slice(0, idx);
      notes.push({ projectId, note });
    }

    // References — extract scope from composite key for deserialization
    const references: ReferenceEntry[] = [];
    for (const [key, ref] of this.references) {
      if (key.startsWith("proj:")) {
        const afterPrefix = key.slice(5); // remove "proj:"
        const idx = afterPrefix.indexOf("::");
        if (idx === -1) continue;
        const projectId = afterPrefix.slice(0, idx);
        references.push({ scope: { projectId }, reference: ref });
      } else if (key.startsWith("sess:")) {
        const afterPrefix = key.slice(5); // remove "sess:"
        const idx = afterPrefix.indexOf("::");
        if (idx === -1) continue;
        const sessionId = afterPrefix.slice(0, idx);
        references.push({ scope: { sessionId }, reference: ref });
      }
    }

    // Activity — flat entries per project ID
    const activity: Record<string, ActivityItem[]> = {};
    for (const [projectId, items] of this.activity) {
      if (items.length) {
        activity[projectId] = items;
      }
    }

    return { version: 1, projects, standaloneSessions, notes, references, activity };
  }

  private saveToDisk(): void {
    let tmpPath: string | undefined;
    try {
      ensureDir();
      const snap = this.serialize();
      tmpPath = join(dirname(this.dbPath), `.db-${Date.now()}.tmp`);
      writeFileSync(tmpPath, JSON.stringify(snap, null, 2), "utf-8");
      renameSync(tmpPath, this.dbPath);
      tmpPath = undefined; // successfully renamed — nothing to clean up
    } catch (err) {
      console.error("[JsonRepository] saveToDisk failed:", err);
      // Clean up orphaned temp file if rename failed
      if (tmpPath) {
        try { unlinkSync(tmpPath); } catch { /* ignore cleanup failure */ }
      }
    }
  }

  // ---- sync helpers for seeding (avoid async in constructor path) ----

  /** Sync version of upsertReference used during seeding. */
  private upsertReferenceSync(scope: RefScope, r: Reference): void {
    const withId = r.id ? { ...r } : { ...r, id: this.nextId("ref") };
    if ("projectId" in scope) {
      this.references.set(`proj:${scope.projectId}::${withId.id}`, withId);
    } else {
      this.references.set(`sess:${scope.sessionId}::${withId.id}`, withId);
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
