import { useEffect, useState } from "react";
import { ProjectsSidebar } from "../app/components/ProjectsSidebar";
import { ProjectView } from "../app/components/ProjectView";
import { HomeView } from "../app/components/HomeView";
import { TaskView } from "../app/components/TaskView";
import { SessionDetail } from "../app/components/SessionDetail";
import { SettingsPanel } from "./SettingsPanel.js";
import { CreateProjectDialog } from "../app/components/CreateProjectDialog";
import { SearchPalette } from "../lib/search/SearchPalette.js";
import { useDataMutations, useDataLoading, useProjects, useStandaloneSessions } from "../lib/data/DataProvider.js";
import { useSessionStream } from "../lib/session/useSessionStream.js";
import { useHarnessInfo } from "../lib/session/useHarnessInfo.js";
import { useChanges } from "../lib/session/useChanges.js";
import { usePrDetails } from "../lib/pr/usePr.js";
import type { Session, Reference, SessionMsg, AppSettingsData } from "@app/core";
import { sessionStateInfo } from "../app/components/SessionStateBadge";
import { call } from "../lib/ipc/client.js";

const projectKey = (pid: string, sid: string) => `p/${pid}/${sid}`;
const standaloneKey = (sid: string) => `s/${sid}`;

/** Seed: anything with attention-needed state OR currently running is unread. */
function computeInitialUnread(projectsArg: ReturnType<typeof useProjects>, sessionsArg: ReturnType<typeof useStandaloneSessions>): Set<string> {
  return new Set([
    ...projectsArg.flatMap((p) =>
      p.sessions
        .filter((s) => sessionStateInfo[s.status].tone !== "neutral" || s.status === "running")
        .map((s) => projectKey(p.id, s.id))
    ),
    ...sessionsArg
      .filter((s) => sessionStateInfo[s.status].tone !== "neutral" || s.status === "running")
      .map((s) => standaloneKey(s.id)),
  ]);
}

function NewSessionView({ onStart, onClose, currentModel, availableModels, onSelectModel }: { onStart: (prompt: string) => void; onClose: () => void; currentModel?: string; availableModels?: Array<{ id: string; label?: string; provider?: string }>; onSelectModel?: (modelId: string) => void }) {
  return (
    <SessionDetail
      backLabel="Home"
      session={null}
      onStartSession={onStart}
      onClose={onClose}
      currentModel={currentModel}
      availableModels={availableModels}
      onSelectModel={onSelectModel}
    />
  );
}

type View = "home" | "project" | "session" | "new-session";

export function AppShell() {
  const projects = useProjects();
  const dataSessions = useStandaloneSessions();
  const mutations = useDataMutations();
  const { isSyncing } = useDataLoading();
  const [view, setView] = useState<View>("home");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectInitialSession, setProjectInitialSession] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>(dataSessions);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [unread, setUnread] = useState<Set<string>>(new Set());

  // M4.2 — Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // M5.2 — Create project dialog state
  const [createProjectOpen, setCreateProjectOpen] = useState(false);

  // M6.3 — Global search palette (⌘K)
  const [searchOpen, setSearchOpen] = useState(false);

  // M-A8 — Load settings for harness/model state
  const [settings, setSettings] = useState<AppSettingsData | null>(null);
  useEffect(() => {
    call("settings:get", undefined).then((data) => setSettings(data));
  }, []);

  // M-A8 — Always fetch models for current harness so we can show in composer
  const { info: harnessInfo } = useHarnessInfo(settings?.harnessId, !!settings);

  const handleSelectModel = (modelId: string) => {
    call("settings:set", { defaultModel: modelId }).then((updated) => setSettings(updated));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Initialize selected project and unread state once when data first loads
  useEffect(() => {
    if (projects.length > 0) {
      setSelectedProjectId(projects[0].id);
      setUnread(computeInitialUnread(projects, dataSessions));
    }
  }, [projects, dataSessions]);

  // Keep the local session list in sync with the data layer. `dataSessions`
  // starts empty and is populated asynchronously (and again on every
  // data:changed reload), so without this the sidebar/Home would never show
  // standalone sessions and freshly created ones couldn't be opened.
  useEffect(() => {
    setSessions(dataSessions);
  }, [dataSessions]);

  const markRead = (key: string) => {
    setUnread((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const project = projects.find((p) => p.id === selectedProjectId) ?? (projects[0] ?? null);

  const openProject = (id: string, sessionId: string | null = null) => {
    setSelectedProjectId(id);
    setProjectInitialSession(sessionId);
    setView("project");
    if (sessionId) markRead(projectKey(id, sessionId));
  };

  const openSession = (id: string) => {
    setSelectedSessionId(id);
    setView("session");
    markRead(standaloneKey(id));
  };

  const archiveSession = (id: string, archived: boolean) => {
    // Optimistic update on local state
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, archived } : s)));
    // Persist to disk only when archiving (un-archiving is local-only for now)
    if (archived) mutations.archiveSession(id);
  };

  const addReferenceToSession = async (sessionId: string, ref: Reference) => {
    await mutations.upsertSessionReference(sessionId, ref);
  };

  // M3.4 — agent workflow foundation handlers (M-A5 runtime)
  const sendMessageToSession = async (messageText: string) => {
    if (!session) return;
    await mutations.sendToSession(session.id, messageText);
  };

  const stopSessionAgent = async () => {
    if (!session) return;
    await mutations.stopSessionViaRuntime(session.id);
  };

  const createSession = async (prompt: string) => {
    try {
      const { sessionId } = await mutations.startSession({ prompt });
      openSession(sessionId);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  // M5.1 — project-scoped session creation (M-A5 runtime)
  const handleCreateProjectSession = async (prompt: string, projectId: string) => {
    try {
      const { sessionId } = await mutations.startSession({ prompt, projectId });
      openProject(projectId, sessionId);
    } catch (err) {
      console.error("Failed to create project session:", err);
    }
  };

  // Resolve PRs for the current standalone session against any project that hosts a matching repo
  const session = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const sessionPRs = session?.linkedPRs ?? [];

  // M-A5 — Subscribe to live harness events for the active session.
  // Deltas are accumulated into local state and merged with the persisted session
  // so the UI shows real-time streaming output before the data layer refreshes.
  const [streamingMessages, setStreamingMessages] = useState<Map<string, SessionMsg>>(new Map());

  // Reset streaming overlay when switching sessions
  useEffect(() => {
    setStreamingMessages(new Map());
  }, [selectedSessionId]);

  useSessionStream(session?.id ?? null, (event) => {
    if (event.type === "message_delta") {
      // Accumulate streamed text into the live overlay bubble.
      setStreamingMessages((prev) => {
        const next = new Map(prev);
        const existing = next.get("current") ?? { role: "agent", content: "", ts: new Date().toISOString() };
        next.set("current", { ...existing, content: existing.content + event.delta });
        return next;
      });
    }
    // NOTE: we deliberately do NOT clear the overlay on "message"/"done". The
    // overlay is cleared (below) only once the persisted agent message has
    // actually arrived via data:changed — otherwise the streamed text would
    // vanish in the gap between the event and the reload.
  });

  // Once the persisted session ends with an agent message, the turn's output is
  // safely in `session.messages`; drop the overlay so we don't show it twice.
  const lastPersisted = session?.messages[session.messages.length - 1];
  const persistedEndsWithAgent = lastPersisted?.role === "agent";
  useEffect(() => {
    if (persistedEndsWithAgent && streamingMessages.size > 0) {
      setStreamingMessages(new Map());
    }
  }, [persistedEndsWithAgent, streamingMessages.size]);

  // M-C4 — live working-tree diffs for the active standalone session.
  const { changes: worktreeChanges } = useChanges(session?.id ?? null, view === "session");
  // M-B3 — enrich the session's linked PRs with live GitHub detail.
  const enrichedPRs = usePrDetails(sessionPRs, view === "session");

  // Show the overlay only while the agent's reply hasn't been persisted yet,
  // so the live stream transitions seamlessly into the saved message.
  const showOverlay = !!session && streamingMessages.size > 0 && !persistedEndsWithAgent;
  const effectiveSession = session ? {
    ...session,
    messages: showOverlay
      ? [...session.messages, streamingMessages.get("current")!]
      : session.messages,
  } : null;

  // Determine if we're inside a project session view (for sidebar highlight)
  const selectedProjectSessionId = view === "project" ? projectInitialSession : null;

  return (
    <div className="dark flex h-screen w-full overflow-hidden bg-background font-sans text-foreground">
      <ProjectsSidebar
        projects={projects}
        standaloneSessions={sessions}
        selectedProjectId={selectedProjectId}
        selectedSessionId={selectedSessionId}
        selectedProjectSessionId={selectedProjectSessionId}
        view={view}
        githubConnected={mutations.githubConnected}
        onGoHome={() => setView("home")}
        onSelectProject={(id) => openProject(id, null)}
        onOpenProjectSession={(pid, sid) => openProject(pid, sid)}
        onSelectSession={openSession}
        onNewSession={() => setView("new-session")}
        onArchiveSession={archiveSession}
        isProjectSessionUnread={(pid, sid) => unread.has(projectKey(pid, sid))}
        isStandaloneSessionUnread={(sid) => unread.has(standaloneKey(sid))}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCreateProject={() => setCreateProjectOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <main className="flex h-full min-w-0 flex-1">
        {view === "home" && (
          <HomeView
            projects={projects}
            standaloneSessions={sessions}
            onOpenProject={(id) => openProject(id, null)}
            onOpenStandaloneSession={openSession}
            onOpenProjectSession={(pid, sid) => openProject(pid, sid)}
            onCreateSession={createSession}
          />
        )}
        {view === "project" && project && (
          <ProjectView key={`${project.id}:${projectInitialSession ?? ""}`} project={project} initialSessionId={projectInitialSession} onSync={() => mutations.syncProject(selectedProjectId)} isSyncing={isSyncing} onCreateProjectSession={(prompt) => handleCreateProjectSession(prompt, selectedProjectId)} />
        )}
        {view === "session" && effectiveSession && (
          <TaskView
            key={effectiveSession.id}
            session={effectiveSession}
            prs={enrichedPRs}
            worktreeChanges={worktreeChanges}
            currentModel={settings?.defaultModel}
            availableModels={harnessInfo.models ?? []}
            onSelectModel={handleSelectModel}
            onAddReference={(r) => addReferenceToSession(effectiveSession.id, r)}
            onSendMessage={sendMessageToSession}
            onStopAgent={stopSessionAgent}
            onReplyToComment={(repo, number, commentId, body) => mutations.replyToComment(repo, number, commentId, body)}
            onRerunChecks={(repo, number) => mutations.rerunChecks(repo, number)}
            onAddressComments={(comments) => mutations.addressComments(effectiveSession.id, comments)}
            onOpenPR={() => mutations.openSessionPR(effectiveSession.id)}
            onClose={() => setView("home")}
          />
        )}
        {view === "new-session" && (
          <NewSessionView
            onStart={createSession}
            currentModel={settings?.defaultModel}
            availableModels={harnessInfo.models ?? []}
            onSelectModel={handleSelectModel}
            onClose={() => setView("home")}
          />
        )}
      </main>

      {/* M6.4 — Consolidated settings panel */}
      <SettingsPanel open={settingsOpen} onOpenChange={(open) => setSettingsOpen(open)} />

      {/* M5.2 — Create project dialog */}
      <CreateProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} />

      {/* M6.3 — Global search palette (⌘K) */}
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        projects={projects}
        standaloneSessions={sessions}
        onSelectProject={(id, sid) => openProject(id, sid)}
        onSelectSession={(sessionId, projectId) => {
          if (projectId) {
            // Project-scoped session — navigate within project context
            openProject(projectId, sessionId);
          } else {
            // Standalone session
            openSession(sessionId);
          }
        }}
      />
    </div>
  );
}
