import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Note, Project, Reference, RefScope, Session, SessionMsg, SessionStatus } from "@app/core";
import { on } from "../ipc/client.js";
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
  /** Upsert a reference scoped to a specific session, then refresh all data from IPC. */
  upsertSessionReference(sessionId: string, ref: Reference): Promise<Reference>;
  /** Delete a reference scoped to a specific session, then refresh all data from IPC. */
  deleteSessionReference(sessionId: string, refId: string): Promise<void>;

  // M3.1 — session CRUD
  /** Create a new standalone session via IPC and refresh data. */
  createSession(session: Session, projectId?: string): Promise<Session>;
  /** Update a session's status — optimistic update on local state, then persist. */
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  // M2.5 — project management + sync
  /** Create or update a project, then refresh all data from IPC. */
  upsertProject(project: Project): Promise<Project>;
  /** Trigger GitHub PR sync for a project; refreshes data on completion. */
  syncProject(projectId: string): Promise<void>;
  /** Current GitHub connection status (loaded at provider mount). */
  githubConnected: boolean;
  /** True while any project sync is in progress. */
  isSyncing: boolean;

  // M3.4 — agent workflow foundation
  /** Add a message to a session's conversation — optimistic update, then persist via IPC. */
  addMessage(sessionId: string, message: SessionMsg): Promise<void>;
  /** Start simulated agent execution for a session. */
  startAgent(sessionId: string): Promise<void>;
  /** Stop agent execution — optimistic status change to completed, then persist. */
  stopAgent(sessionId: string): Promise<void>;

  // M4.2 — GitHub connect flow
  /** Initiate GitHub OAuth connection; refreshes data on completion. */
  connectGitHub(): Promise<{ success: boolean }>;

  // M4.3 — PR merge + external links
  /** Merge a pull request via Octokit and refresh data. */
  mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }>;
  /** Open a URL in the system browser via IPC. */
  openUrl(url: string): Promise<void>;

  // M-A5 — Session runtime (live agent harness)
  /** Start a new session with the active harness. Returns the session ID. */
  startSession(input: { sessionId?: string; prompt: string; projectId?: string | null; model?: string }): Promise<{ sessionId: string }>;
  /** Send a follow-up message to an existing running session. */
  sendToSession(sessionId: string, message: string): Promise<void>;
  /** Stop the agent for a session via runtime (replaces optimistic stopAgent). */
  stopSessionViaRuntime(sessionId: string): Promise<void>;

  // M-A8 — Harness health + model list
  /** Check harness health. */
  checkHarnessHealth(harnessId: string): Promise<{ ok: boolean; version?: string; detail?: string }>;
  /** Get available models for a given harness id. */
  getHarnessModels(harnessId: string): Promise<Array<{ id: string; label?: string; provider?: string }>>;
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

  // M3.2 — subscribe to data:changed push events from main process
  // M6.2 — subscribe to session-status-changed for optimistic local updates
  useEffect(() => {
    const onDataChanged = (_event: unknown) => {
      loadData();
    };

    const onStatusChanged = (payload: unknown) => {
      const evt = payload as { sessionId: string; status: SessionStatus };
      // Optimistic local update — triggers re-render immediately without full reload
      setStandaloneSessions((prev) =>
        prev.map((s) => (s.id === evt.sessionId ? { ...s, status: evt.status } : s))
      );
    };

    const unsubData = on("data:changed", onDataChanged);
    const unsubStatus = on("session-status-changed", onStatusChanged);
    return () => {
      unsubData();
      unsubStatus();
    };
  }, [loadData]);

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
        toast.success("Note saved");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save note";
        setError(msg);
        toast.error(`Failed to save note: ${msg}`);
        throw err;
      }
    },

    async deleteNote(projectId: string, noteId: string): Promise<void> {
      try {
        await activeSource.deleteNote(projectId, noteId);
        await loadData();
        toast.success("Note deleted");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to delete note";
        setError(msg);
        toast.error(`Failed to delete note: ${msg}`);
        throw err;
      }
    },

    async upsertReference(scope: RefScope, reference: Reference): Promise<Reference> {
      try {
        const result = await activeSource.upsertReference(scope, reference);
        await loadData();
        toast.success("Reference added");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add reference";
        setError(msg);
        toast.error(`Failed to add reference: ${msg}`);
        throw err;
      }
    },

    async deleteReference(scope: RefScope, refId: string): Promise<void> {
      try {
        await activeSource.deleteReference(scope, refId);
        await loadData();
        toast.success("Reference removed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to remove reference";
        setError(msg);
        toast.error(`Failed to remove reference: ${msg}`);
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
        toast.success("Session archived");
      } catch (err) {
        // Roll back optimistic update on failure
        setStandaloneSessions(prevSessions);
        const msg = err instanceof Error ? err.message : "Failed to archive session";
        setError(msg);
        toast.error(`Failed to archive session: ${msg}`);
        throw err;
      }
    },

    /** Upsert a reference scoped to a specific session, then refresh all data from IPC. */
    async upsertSessionReference(sessionId: string, ref: Reference): Promise<Reference> {
      try {
        const result = await activeSource.upsertSessionReference(sessionId, ref);
        await loadData();
        toast.success("Reference added to session");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add reference";
        setError(msg);
        toast.error(`Failed to add reference: ${msg}`);
        throw err;
      }
    },

    /** Delete a reference scoped to a specific session, then refresh all data from IPC. */
    async deleteSessionReference(sessionId: string, refId: string): Promise<void> {
      try {
        await activeSource.deleteSessionReference(sessionId, refId);
        await loadData();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to remove reference";
        setError(msg);
        toast.error(`Failed to remove reference: ${msg}`);
        throw err;
      }
    },

    /** Create a new standalone session via IPC and refresh data. */
    async createSession(session: Session, projectId?: string): Promise<Session> {
      try {
        const result = await activeSource.createSession(session, projectId);
        await loadData();
        toast.success("Session created");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create session";
        setError(msg);
        toast.error(`Failed to create session: ${msg}`);
        throw err;
      }
    },

    /** Update a session's status — optimistic update on local state + persist via IPC. */
    async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
      const prevSessions = standaloneSessions;
      // Optimistic update
      setStandaloneSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status } : s))
      );
      try {
        await activeSource.updateSessionStatus(sessionId, status);
      } catch (err) {
        // Roll back optimistic update on failure
        setStandaloneSessions(prevSessions);
        setError(err instanceof Error ? err.message : "Failed to update session status");
        throw err;
      }
    },

    // ---- M2.5 — project management + sync ----

    async upsertProject(project: Project): Promise<Project> {
      try {
        const result = await activeSource.upsertProject(project);
        await loadData();
        toast.success("Project saved");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save project";
        setError(msg);
        toast.error(`Failed to save project: ${msg}`);
        throw err;
      }
    },

    async syncProject(projectId: string): Promise<void> {
      setSyncingProjectId(projectId);
      const loadingId = toast.loading("Syncing project...");
      try {
        await activeSource.syncProject(projectId);
        await loadData();
        toast.success("Project synced", { id: loadingId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to sync project";
        setError(msg);
        toast.error(`Sync failed: ${msg}`, { id: loadingId });
        throw err;
      } finally {
        // Only clear if still the same project syncing (avoid race conditions)
        setSyncingProjectId((prev) => (prev === projectId ? null : prev));
      }
    },

    // ---- M3.4 — agent workflow foundation ----

    /** Add a message to a session's conversation — optimistic update, then persist via IPC. */
    async addMessage(sessionId: string, message: SessionMsg): Promise<void> {
      const prevSessions = standaloneSessions;
      // Optimistic update — append message to local session state
      setStandaloneSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, messages: [...s.messages, message] } : s))
      );
      try {
        await activeSource.addMessage(sessionId, message);
      } catch (err) {
        // Roll back optimistic update on failure
        setStandaloneSessions(prevSessions);
        setError(err instanceof Error ? err.message : "Failed to send message");
        toast.error(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    },

    /** Start simulated agent execution for a session. */
    async startAgent(sessionId: string): Promise<void> {
      try {
        await activeSource.startAgent(sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start agent");
        toast.error(`Failed to start agent: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    },

    /** Stop agent execution — optimistic status change to completed, then persist. */
    async stopAgent(sessionId: string): Promise<void> {
      const prevSessions = standaloneSessions;
      // Optimistic update
      setStandaloneSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: "completed" } : s))
      );
      try {
        await activeSource.stopAgent(sessionId);
        toast.success("Agent stopped");
      } catch (err) {
        // Roll back optimistic update on failure
        setStandaloneSessions(prevSessions);
        const msg = err instanceof Error ? err.message : "Failed to stop agent";
        setError(msg);
        toast.error(`Failed to stop agent: ${msg}`);
        throw err;
      }
    },

    /** M4.2 — Initiate GitHub OAuth connection, then refresh all data including status. */
    async connectGitHub(): Promise<{ success: boolean }> {
      const loadingId = toast.loading("Connecting to GitHub...");
      try {
        const result = await activeSource.connectGitHub();
        // Refresh GitHub connection status after connect attempt
        activeSource.getGithubStatus().then((status) => {
          setGithubConnected(status.connected);
        }).catch(() => {
          // Silently fail — not critical
        });
        toast.success("Connected to GitHub", { id: loadingId });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to connect to GitHub";
        setError(msg);
        toast.error(`GitHub connection failed: ${msg}`, { id: loadingId });
        throw err;
      }
    },

    /** M4.3 — Merge a PR via Octokit and refresh all data. */
    async mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }> {
      const loadingId = toast.loading("Merging pull request...");
      try {
        const result = await activeSource.mergePR(owner, repo, prNumber);
        await loadData();
        toast.success("Pull request merged", { id: loadingId });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to merge PR";
        setError(msg);
        toast.error(`Merge failed: ${msg}`, { id: loadingId });
        throw err;
      }
    },

    /** M4.3 — Open a URL in the system browser via IPC. */
    async openUrl(url: string): Promise<void> {
      await activeSource.openUrl(url);
    },

    // ---- M-A5 — Session runtime (live agent harness) ----

    /** Start a new session with the active harness. Returns the session ID. */
    async startSession(input: { sessionId?: string; prompt: string; projectId?: string | null; model?: string }): Promise<{ sessionId: string }> {
      try {
        const result = await activeSource.startSession(input);
        await loadData();
        toast.success("Session started");
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to start session";
        setError(msg);
        toast.error(`Failed to start session: ${msg}`);
        throw err;
      }
    },

    /** Send a follow-up message to an existing running session. */
    async sendToSession(sessionId: string, message: string): Promise<void> {
      try {
        await activeSource.sendToSession(sessionId, message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to send message";
        setError(msg);
        toast.error(`Failed to send message: ${msg}`);
        throw err;
      }
    },

    /** Stop the agent for a session via runtime. */
    async stopSessionViaRuntime(sessionId: string): Promise<void> {
      const prevSessions = standaloneSessions;
      setStandaloneSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: "idle" } : s))
      );
      try {
        await activeSource.stopSession(sessionId);
        toast.success("Agent stopped");
      } catch (err) {
        setStandaloneSessions(prevSessions);
        const msg = err instanceof Error ? err.message : "Failed to stop agent";
        setError(msg);
        toast.error(`Failed to stop agent: ${msg}`);
        throw err;
      }
    },

    // ---- M-A8 — Harness health + model list ----

    /** Check harness health. */
    async checkHarnessHealth(harnessId: string): Promise<{ ok: boolean; version?: string; detail?: string }> {
      return activeSource.harnessHealth(harnessId);
    },

    /** Get available models for a given harness id. */
    async getHarnessModels(harnessId: string): Promise<Array<{ id: string; label?: string; provider?: string }>> {
      return activeSource.harnessModels(harnessId);
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
