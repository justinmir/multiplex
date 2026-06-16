import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ActivityItem, Note, Project, Reference, RefScope, Repository, Session,
} from "@app/core";
import { seedProjects, seedStandaloneSessions } from "./seed.js";

/**
 * SQLite-backed Repository (M7.2). Same interface as JsonRepository, but writes
 * single rows instead of rewriting the whole DB on every mutation, and keeps
 * data on disk rather than fully in memory.
 *
 * Storage model: top-level entities are stored one-row-per-entity with a JSON
 * `data` blob plus the columns we filter on. Sessions/notes/references/activity
 * live in their own tables (the source of truth) and are hydrated onto the
 * parent Project/Session on read — mirroring InMemoryRepository's semantics.
 */
export class SqliteRepository implements Repository {
  private db: Database.Database;
  private jsonPath?: string;

  /** `dbPath` is the SQLite file; `jsonPath` (optional) is a db.json to migrate
   *  from on first run. Both are injected by the caller (paths.ts is
   *  electron-bound, so this class stays free of it and unit-testable). */
  constructor(dbPath: string, jsonPath?: string) {
    this.jsonPath = jsonPath;
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (project_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (project_id, id));
      CREATE TABLE IF NOT EXISTS refs (scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (scope_type, scope_id, id));
      CREATE TABLE IF NOT EXISTS activity (project_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id);
    `);

    const empty = (this.db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n === 0
      && (this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n === 0;
    if (empty) this.firstRun();
  }

  // ---- first run: migrate from db.json, else seed ----

  private firstRun(): void {
    if (this.jsonPath && existsSync(this.jsonPath)) {
      const jsonPath = this.jsonPath;
      try {
        const snap = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
          projects?: Project[];
          standaloneSessions?: Session[];
          notes?: { projectId: string; note: Note }[];
          references?: { scope: RefScope; reference: Reference }[];
          activity?: Record<string, ActivityItem[]>;
        };
        this.migrate(snap);
        renameSync(jsonPath, `${jsonPath}.bak`);
        console.log("[SqliteRepository] migrated db.json → SQLite (backed up to db.json.bak)");
        return;
      } catch (err) {
        console.error("[SqliteRepository] migration failed, seeding fresh:", err);
      }
    }
    this.seed();
  }

  private migrate(snap: {
    projects?: Project[];
    standaloneSessions?: Session[];
    notes?: { projectId: string; note: Note }[];
    references?: { scope: RefScope; reference: Reference }[];
    activity?: Record<string, ActivityItem[]>;
  }): void {
    const tx = this.db.transaction(() => {
      for (const p of snap.projects ?? []) {
        this.putProject(p);
        for (const s of p.sessions ?? []) this.putSession(s, p.id);
      }
      for (const s of snap.standaloneSessions ?? []) this.putSession(s, null);
      for (const e of snap.notes ?? []) this.putNote(e.projectId, e.note);
      for (const e of snap.references ?? []) this.putRefScoped(e.scope, e.reference);
      for (const [pid, items] of Object.entries(snap.activity ?? {})) {
        for (const a of items) this.pushActivity(pid, a);
      }
    });
    tx();
  }

  private seed(): void {
    const tx = this.db.transaction(() => {
      for (const p of seedProjects) {
        this.putProject(p);
        for (const s of p.sessions ?? []) {
          this.putSession(s, p.id);
          for (const r of s.references ?? []) this.putRefScoped({ sessionId: s.id }, r);
        }
        for (const n of p.notes ?? []) this.putNote(p.id, n);
        for (const r of p.references ?? []) this.putRefScoped({ projectId: p.id }, r);
        for (const a of p.activity ?? []) this.pushActivity(p.id, a);
      }
      for (const s of seedStandaloneSessions) {
        this.putSession(s, null);
        for (const r of s.references ?? []) this.putRefScoped({ sessionId: s.id }, r);
      }
    });
    tx();
  }

  // ---- low-level writers (store "bare" parents; collections live in their tables) ----

  private putProject(p: Project): void {
    const bare: Project = { ...p, sessions: [], notes: [], references: [], activity: [] };
    this.db.prepare("INSERT OR REPLACE INTO projects(id, data) VALUES(?, ?)").run(p.id, JSON.stringify(bare));
  }

  private putSession(s: Session, projectId: string | null): void {
    const bare: Session = { ...s, references: [] };
    this.db.prepare("INSERT OR REPLACE INTO sessions(id, project_id, data) VALUES(?, ?, ?)").run(s.id, projectId, JSON.stringify(bare));
  }

  private putNote(projectId: string, note: Note): void {
    this.db.prepare("INSERT OR REPLACE INTO notes(project_id, id, data) VALUES(?, ?, ?)").run(projectId, note.id, JSON.stringify(note));
  }

  private putRefScoped(scope: RefScope, ref: Reference): void {
    const [type, id] = "projectId" in scope ? ["project", scope.projectId] : ["session", scope.sessionId];
    this.db.prepare("INSERT OR REPLACE INTO refs(scope_type, scope_id, id, data) VALUES(?, ?, ?, ?)").run(type, id, ref.id, JSON.stringify(ref));
  }

  private pushActivity(projectId: string, a: ActivityItem): void {
    this.db.prepare("INSERT INTO activity(project_id, data) VALUES(?, ?)").run(projectId, JSON.stringify(a));
  }

  // ---- hydration ----

  private hydrateProject(bare: Project): Project {
    return {
      ...bare,
      sessions: this.sessionsForProject(bare.id),
      notes: this.notesFor(bare.id),
      references: this.refsFor("project", bare.id),
      activity: this.activityFor(bare.id),
    };
  }

  private hydrateSession(bare: Session): Session {
    return { ...bare, references: this.refsFor("session", bare.id) };
  }

  private sessionsForProject(projectId: string): Session[] {
    const rows = this.db.prepare("SELECT data FROM sessions WHERE project_id = ?").all(projectId) as { data: string }[];
    return rows.map((r) => this.hydrateSession(JSON.parse(r.data) as Session));
  }

  private notesFor(projectId: string): Note[] {
    const rows = this.db.prepare("SELECT data FROM notes WHERE project_id = ?").all(projectId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Note);
  }

  private refsFor(scopeType: string, scopeId: string): Reference[] {
    const rows = this.db.prepare("SELECT data FROM refs WHERE scope_type = ? AND scope_id = ?").all(scopeType, scopeId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Reference);
  }

  private activityFor(projectId: string): ActivityItem[] {
    const rows = this.db.prepare("SELECT data FROM activity WHERE project_id = ? ORDER BY rowid").all(projectId) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as ActivityItem);
  }

  // ---- Repository: projects ----

  async listProjects(): Promise<Project[]> {
    const rows = this.db.prepare("SELECT data FROM projects").all() as { data: string }[];
    return rows.map((r) => this.hydrateProject(JSON.parse(r.data) as Project));
  }

  async getProject(id: string): Promise<Project | null> {
    const row = this.db.prepare("SELECT data FROM projects WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? this.hydrateProject(JSON.parse(row.data) as Project) : null;
  }

  async upsertProject(p: Project): Promise<Project> {
    this.putProject(p);
    return p;
  }

  // ---- Repository: sessions ----

  async listSessions(opts?: { projectId?: string | null }): Promise<Session[]> {
    let rows: { data: string }[];
    if (opts?.projectId === undefined) {
      rows = this.db.prepare("SELECT data FROM sessions").all() as { data: string }[];
    } else if (opts.projectId === null) {
      rows = this.db.prepare("SELECT data FROM sessions WHERE project_id IS NULL").all() as { data: string }[];
    } else {
      rows = this.db.prepare("SELECT data FROM sessions WHERE project_id = ?").all(opts.projectId) as { data: string }[];
    }
    return rows.map((r) => this.hydrateSession(JSON.parse(r.data) as Session));
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.prepare("SELECT data FROM sessions WHERE id = ?").get(id) as { data: string } | undefined;
    return row ? this.hydrateSession(JSON.parse(row.data) as Session) : null;
  }

  async upsertSession(s: Session, projectId: string | null): Promise<Session> {
    this.putSession(s, projectId);
    return s;
  }

  async getSessionProjectId(id: string): Promise<string | null> {
    const row = this.db.prepare("SELECT project_id FROM sessions WHERE id = ?").get(id) as { project_id: string | null } | undefined;
    return row ? row.project_id : null;
  }

  // ---- Repository: notes ----

  async getNotes(projectId: string): Promise<Note[]> {
    return this.notesFor(projectId);
  }

  async upsertNote(projectId: string, n: Note): Promise<Note> {
    this.putNote(projectId, n);
    return n;
  }

  async deleteNote(projectId: string, noteId: string): Promise<void> {
    this.db.prepare("DELETE FROM notes WHERE project_id = ? AND id = ?").run(projectId, noteId);
  }

  // ---- Repository: references ----

  async getReferences(scope: RefScope): Promise<Reference[]> {
    const [type, id] = "projectId" in scope ? ["project", scope.projectId] : ["session", scope.sessionId];
    return this.refsFor(type, id as string);
  }

  async upsertReference(scope: RefScope, r: Reference): Promise<Reference> {
    this.putRefScoped(scope, r);
    return r;
  }

  async deleteReference(scope: RefScope, refId: string): Promise<void> {
    const [type, id] = "projectId" in scope ? ["project", scope.projectId] : ["session", scope.sessionId];
    this.db.prepare("DELETE FROM refs WHERE scope_type = ? AND scope_id = ? AND id = ?").run(type, id, refId);
  }

  // ---- Repository: activity ----

  async appendActivity(projectId: string, a: ActivityItem): Promise<void> {
    this.pushActivity(projectId, a);
  }

  async getActivity(projectId: string): Promise<ActivityItem[]> {
    return this.activityFor(projectId);
  }

  // ---- Repository: archive ----

  async archiveSession(id: string): Promise<void> {
    const row = this.db.prepare("SELECT project_id, data FROM sessions WHERE id = ?").get(id) as { project_id: string | null; data: string } | undefined;
    if (!row) return;
    const s = JSON.parse(row.data) as Session;
    this.putSession({ ...s, archived: true }, row.project_id);
  }

  /** Close the database (called on shutdown). */
  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }
}
