import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Note, Project, Reference, RefScope, Session, SessionStatus } from "@app/core";
import { call, on } from "../ipc/client.js";
import { useReconnect } from "../ipc/reconnect.js";
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

  // M4.2 — GitHub connect flow
  /** Initiate GitHub OAuth connection; refreshes data on completion. */
  connectGitHub(): Promise<{ success: boolean }>;

  // M4.3 — PR merge + external links
  /** Merge a pull request via Octokit and refresh data. */
  mergePR(owner: string, repo: string, prNumber: number): Promise<{ success: boolean }>;
  /** Open a URL in the system browser via IPC. */
  openUrl(url: string): Promise<void>;

  // M-B4 / M-B5 — PR actions
  /** Reply to a PR/review comment on GitHub. */
  replyToComment(repo: string, number: number, commentId: string, body: string): Promise<void>;
  /** Re-run a PR's checks on GitHub. */
  rerunChecks(repo: string, number: number): Promise<void>;
  /** Ask the agent to address review comments (re-enters the harness). */
  addressComments(sessionId: string, comments: string[]): Promise<void>;
  /** Open a draft PR per touched repo with changes; returns the count opened. */
  openSessionPR(sessionId: string): Promise<{ opened: number; message?: string }>;

  // M5.3 — project intelligence
  /** (Re)synthesize a project's summary + next steps via the intelligence layer. */
  resynthesizeProject(projectId: string): Promise<void>;

  // M-A5 — Session runtime (live agent harness)
  /** Start a new session with the active harness. Returns the session ID. */
  startSession(input: { sessionId?: string; prompt: string; projectId?: string | null; model?: string }): Promise<{ sessionId: string }>;
  /** Send a follow-up message to an existing running session. */
  sendToSession(sessionId: string, message: string): Promise<void>;
  /** Stop the agent for a session via runtime (replaces optimistic stopAgent). */
  stopSessionViaRuntime(sessionId: string): Promise<void>;
  /** Run a queued message now (interrupting the current turn), or remove it. */
  interruptQueuedMessage(sessionId: string, index: number): Promise<void>;
  removeQueuedMessage(sessionId: string, index: number): Promise<void>;
  /** Replace the last user prompt and re-run it. */
  editSessionPrompt(sessionId: string, prompt: string): Promise<void>;

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

  // M7.1 — self-heal: refetch authoritative state on focus/online so missed
  // push events (window backgrounded, machine asleep) don't leave stale data.
  useReconnect(loadData);

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

    // ---- M-B4 / M-B5 — PR actions ----

    /** Reply to a PR/review comment on GitHub. */
    async replyToComment(repo: string, number: number, commentId: string, body: string): Promise<void> {
      const id = toast.loading("Posting reply…");
      try {
        await call("pr:reply", { repo, number, commentId, body });
        toast.success("Reply posted", { id });
      } catch (err) {
        toast.error(`Reply failed: ${err instanceof Error ? err.message : String(err)}`, { id });
        throw err;
      }
    },

    /** Re-run a PR's checks on GitHub. */
    async rerunChecks(repo: string, number: number): Promise<void> {
      const id = toast.loading("Re-running checks…");
      try {
        await call("pr:rerun", { repo, number });
        toast.success("Checks re-queued", { id });
      } catch (err) {
        toast.error(`Re-run failed: ${err instanceof Error ? err.message : String(err)}`, { id });
        throw err;
      }
    },

    /** Ask the agent to address the given review comments (re-enters the harness). */
    async addressComments(sessionId: string, comments: string[]): Promise<void> {
      try {
        await call("session:address-comments", { sessionId, comments });
        toast.success("Asked the agent to address the comments");
      } catch (err) {
        toast.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    },

    /** M5.3 — (re)synthesize a project's summary + next steps. */
    async resynthesizeProject(projectId: string): Promise<void> {
      const id = toast.loading("Synthesizing project summary…");
      try {
        const result = await call("project:resynthesize", { projectId });
        await loadData();
        toast.success(result ? "Summary updated" : "Nothing to synthesize", { id });
      } catch (err) {
        toast.error(`Synthesis failed: ${err instanceof Error ? err.message : String(err)}`, { id });
        throw err;
      }
    },

    /** Open a draft PR for every touched repo with changes. */
    async openSessionPR(sessionId: string): Promise<{ opened: number; message?: string }> {
      const id = toast.loading("Opening pull request(s)…");
      try {
        const result = await call("session:open-pr", { sessionId });
        await loadData();
        if (result.opened.length > 0) {
          toast.success(`Opened ${result.opened.length} pull request(s)`, { id });
        } else {
          toast.message(result.message ?? "No changes to open a PR for", { id });
        }
        return { opened: result.opened.length, message: result.message };
      } catch (err) {
        toast.error(`Open PR failed: ${err instanceof Error ? err.message : String(err)}`, { id });
        throw err;
      }
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

    async interruptQueuedMessage(sessionId: string, index: number): Promise<void> {
      try { await activeSource.interruptQueuedMessage(sessionId, index); }
      catch (err) { console.error("Failed to interrupt queued message:", err); }
    },

    async removeQueuedMessage(sessionId: string, index: number): Promise<void> {
      try { await activeSource.removeQueuedMessage(sessionId, index); }
      catch (err) { console.error("Failed to remove queued message:", err); }
    },

    async editSessionPrompt(sessionId: string, prompt: string): Promise<void> {
      try { await activeSource.editSessionPrompt(sessionId, prompt); }
      catch (err) { console.error("Failed to edit prompt:", err); }
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
