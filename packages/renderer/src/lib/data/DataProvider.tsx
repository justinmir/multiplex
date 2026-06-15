import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Note, Project, Reference, RefScope, Session } from "@app/core";
import type { DataSource } from "./types.js";

interface DataContextValue {
  projects: Project[];
  standaloneSessions: Session[];
  loading: boolean;
  isSyncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextValue>(null!);

// ---- Mutation context (M1.5) ----

interface DataMutationValue {
  /** Upsert a note in the given project, then refresh all data from IPC. */
  upsertNote(projectId: string, note: Note): Promise<Note>;
  /** Delete a note from the given project, then refresh all data from IPC. */
  deleteNote(projectId: string, noteId: string): Promise<void>;
  /** Upsert a reference in the given scope, then refresh all data from IPC. */
  upsertReference(scope: RefScope, reference: Reference): Promise<Reference>;
  /** Delete a reference from the given scope, then refresh all data from IPC. */
  deleteReference(scope: RefScope, refId: string): Promise<void>;
  /** Archive a standalone session — optimistic update on local state, then persist. */
  archiveSession(sessionId: string): Promise<void>;

  // M2.5 — project management + sync
  /** Create or update a project, then refresh all data from IPC. */
  upsertProject(project: Project): Promise<Project>;
  /** Trigger GitHub PR sync for a project; refreshes data on completion. */
  syncProject(projectId: string): Promise<void>;
  /** Current GitHub connection status (loaded at provider mount). */
  githubConnected: boolean;
  /** True while any project sync is in progress. */
  isSyncing: boolean;
}

const DataMutationContext = createContext<DataMutationValue>(null!);

export function DataProvider({
  children,
  source,
}: {
  children: React.ReactNode;
  source?: DataSource;
}) {
  const activeSource = source!; // caller (main.tsx) always provides a source

  const [projects, setProjects] = useState<Project[]>([]);
  const [standaloneSessions, setStandaloneSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // M2.5 — GitHub connection status + sync tracking
  const [githubConnected, setGithubConnected] = useState(false);
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [projectsData, sessions] = await Promise.all([
        activeSource.listProjects(),
        activeSource.listStandaloneSessions(),
      ]);
      setProjects(projectsData);
      setStandaloneSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [activeSource]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load GitHub connection status on mount
  useEffect(() => {
    activeSource.getGithubStatus().then((status) => {
      setGithubConnected(status.connected);
    }).catch(() => {
      // Silently fail — not critical for app boot
    });
  }, [activeSource]);

  const value: DataContextValue = {
    projects,
    standaloneSessions,
    loading,
    isSyncing: syncingProjectId !== null,
    error,
    refresh: loadData,
  };

  // ---- Mutation methods (M1.5) ----

  /** Project-scoped mutations: call IPC write, then full refresh to stay consistent. */
  const mutationValue = useMemo<DataMutationValue>(() => ({
    async upsertNote(projectId: string, note: Note): Promise<Note> {
      try {
        const result = await activeSource.upsertNote(projectId, note);
        await loadData();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upsert note");
        throw err;
      }
    },

    async deleteNote(projectId: string, noteId: string): Promise<void> {
      try {
        await activeSource.deleteNote(projectId, noteId);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete note");
        throw err;
      }
    },

    async upsertReference(scope: RefScope, reference: Reference): Promise<Reference> {
      try {
        const result = await activeSource.upsertReference(scope, reference);
        await loadData();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upsert reference");
        throw err;
      }
    },

    async deleteReference(scope: RefScope, refId: string): Promise<void> {
      try {
        await activeSource.deleteReference(scope, refId);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete reference");
        throw err;
      }
    },

    /** Archive session — optimistic update on local state + persist via IPC. */
    async archiveSession(sessionId: string): Promise<void> {
      const prevSessions = standaloneSessions;
      // Optimistic update
      setStandaloneSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, archived: true } : s))
      );
      try {
        await activeSource.archiveSession(sessionId);
      } catch (err) {
        // Roll back optimistic update on failure
        setStandaloneSessions(prevSessions);
        setError(err instanceof Error ? err.message : "Failed to archive session");
        throw err;
      }
    },

    // ---- M2.5 — project management + sync ----

    async upsertProject(project: Project): Promise<Project> {
      try {
        const result = await activeSource.upsertProject(project);
        await loadData();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upsert project");
        throw err;
      }
    },

    async syncProject(projectId: string): Promise<void> {
      setSyncingProjectId(projectId);
      try {
        await activeSource.syncProject(projectId);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sync project");
        throw err;
      } finally {
        // Only clear if still the same project syncing (avoid race conditions)
        setSyncingProjectId((prev) => (prev === projectId ? null : prev));
      }
    },

    githubConnected,
    isSyncing: syncingProjectId !== null,
  }), [activeSource, loadData, standaloneSessions, githubConnected, syncingProjectId]);

  return (
    <DataContext.Provider value={value}>
      <DataMutationContext.Provider value={mutationValue}>
        {children}
      </DataMutationContext.Provider>
    </DataContext.Provider>
  );
}

export function useProjects(): Project[] {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useProjects must be used within DataProvider");
  return ctx.projects;
}

export function useProject(id: string): Project | undefined {
  const projects = useProjects();
  return projects.find((p) => p.id === id);
}

export function useStandaloneSessions(): Session[] {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useStandaloneSessions must be used within DataProvider");
  return ctx.standaloneSessions;
}

export function useSession(id: string): Session | undefined {
  const sessions = useStandaloneSessions();
  return sessions.find((s) => s.id === id);
}

/** Returns loading + error state for use in top-level UI (e.g. AppShell). */
export function useDataLoading(): Pick<DataContextValue, "loading" | "isSyncing" | "error"> {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataLoading must be used within DataProvider");
  return { loading: ctx.loading, isSyncing: ctx.isSyncing, error: ctx.error };
}

/** Returns sync state for use in top-level UI (e.g. AppShell sync button). */
export function useSyncState(): { isSyncing: boolean } {
  const mutations = useDataMutations();
  return { isSyncing: mutations.isSyncing };
}

/** Access mutation methods for notes, references, and session metadata. */
export function useDataMutations(): DataMutationValue {
  const ctx = useContext(DataMutationContext);
  if (!ctx) throw new Error("useDataMutations must be used within DataProvider");
  return ctx;
}
