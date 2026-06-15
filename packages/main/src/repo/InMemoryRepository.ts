import type { ActivityItem, Note, Project, Reference, RefScope, Repository, Session } from "@app/core";

/** Build the map key for a reference given its scope. */
function refKey(scope: RefScope, refId: string): string {
  if ("projectId" in scope) return `proj:${scope.projectId}::${refId}`;
  return `sess:${scope.sessionId}::${refId}`;
}

/** Build the map key for a note. */
function noteKey(projectId: string, noteId: string): string {
  return `${projectId}::${noteId}`;
}

export class InMemoryRepository implements Repository {
  // Protected maps so JsonRepository can extend and load/save
  protected projects = new Map<string, Project>();
  protected sessions = new Map<string, Session>();
  protected sessionProjectId = new Map<string, string | null>(); // sessionId -> projectId
  protected notes = new Map<string, Note>();            // key: `${projectId}::${noteId}`
  protected references = new Map<string, Reference>();   // key varies by scope (see refKey)
  protected activity = new Map<string, ActivityItem[]>(); // projectId -> items[]

  private counter = 0;

  // ---- helpers ----
  protected nextId(prefix: string): string {
    return `${prefix}_${++this.counter}`;
  }

  // ---- projects ----
  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).map((p) => ({ ...p }));
  }

  async getProject(id: string): Promise<Project | null> {
    const p = this.projects.get(id);
    return p ? { ...p } : null;
  }

  async upsertProject(p: Project): Promise<Project> {
    this.projects.set(p.id, { ...p });
    return { ...p };
  }

  // ---- sessions ----
  async listSessions(opts?: { projectId?: string | null }): Promise<Session[]> {
    const all = Array.from(this.sessions.values());
    // No filter or undefined → return all sessions
    if (opts?.projectId === undefined) {
      return all.map((s) => ({ ...s }));
    }
    // Explicitly null → return only standalone sessions (no project association)
    if (opts.projectId === null) {
      return all
        .filter((s) => this.sessionProjectId.get(s.id) === null)
        .map((s) => ({ ...s }));
    }
    // Specific projectId string → filter to that project's sessions
    return all
      .filter((s) => this.sessionProjectId.get(s.id) === opts!.projectId)
      .map((s) => ({ ...s }));
  }

  async getSession(id: string): Promise<Session | null> {
    const s = this.sessions.get(id);
    return s ? { ...s } : null;
  }

  async upsertSession(s: Session, projectId: string | null): Promise<Session> {
    // Ensure the session has an id
    if (!s.id) {
      const withId = { ...s, id: this.nextId("sess") };
      this.sessions.set(withId.id, withId);
      this.sessionProjectId.set(withId.id, projectId);
      return { ...withId };
    }
    this.sessions.set(s.id, { ...s });
    this.sessionProjectId.set(s.id, projectId);
    return { ...s };
  }

  // ---- notes ----
  async getNotes(projectId: string): Promise<Note[]> {
    const prefix = `${projectId}::`;
    const result: Note[] = [];
    for (const [key, note] of this.notes) {
      if (key.startsWith(prefix)) {
        result.push({ ...note });
      }
    }
    return result;
  }

  async upsertNote(projectId: string, n: Note): Promise<Note> {
    const withId = n.id ? { ...n } : { ...n, id: this.nextId("note") };
    this.notes.set(noteKey(projectId, withId.id), withId);
    return { ...withId };
  }

  async deleteNote(projectId: string, noteId: string): Promise<void> {
    this.notes.delete(noteKey(projectId, noteId));
  }

  // ---- references ----
  async getReferences(scope: RefScope): Promise<Reference[]> {
    const prefix = "projectId" in scope ? `proj:${scope.projectId}::` : `sess:${scope.sessionId}::`;
    const result: Reference[] = [];
    for (const [key, ref] of this.references) {
      if (key.startsWith(prefix)) {
        result.push({ ...ref });
      }
    }
    return result;
  }

  async upsertReference(scope: RefScope, r: Reference): Promise<Reference> {
    const withId = r.id ? { ...r } : { ...r, id: this.nextId("ref") };
    this.references.set(refKey(scope, withId.id), withId);
    return { ...withId };
  }

  async deleteReference(scope: RefScope, refId: string): Promise<void> {
    this.references.delete(refKey(scope, refId));
  }

  // ---- activity log ----
  async appendActivity(projectId: string, a: ActivityItem): Promise<void> {
    const items = this.activity.get(projectId) ?? [];
    const withId = a.id ? { ...a } : { ...a, id: this.nextId("act") };
    items.push(withId);
    this.activity.set(projectId, items);
  }

  async getActivity(projectId: string): Promise<ActivityItem[]> {
    return (this.activity.get(projectId) ?? []).map((a) => ({ ...a }));
  }

  // ---- archive ----
  async archiveSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.set(id, { ...s, archived: true });
  }

  /** Synchronously list sessions with no project association (standalone). */
  protected listStandaloneSessionsSync(): Session[] {
    const result: Session[] = [];
    for (const [sid, projId] of this.sessionProjectId) {
      if (projId === null) {
        const s = this.sessions.get(sid);
        if (s) result.push(s);
      }
    }
    return result;
  }

  /** Synchronously list all projects. */
  protected listProjectsSync(): Project[] {
    return Array.from(this.projects.values());
  }
}
