import { useEffect, useState } from "react";
import { ProjectsSidebar } from "../app/components/ProjectsSidebar";
import { ProjectView } from "../app/components/ProjectView";
import { HomeView } from "../app/components/HomeView";
import { TaskView } from "../app/components/TaskView";
import { SessionDetail } from "../app/components/SessionDetail";
import { SettingsPanel } from "./SettingsPanel.js";
import { CreateProjectDialog } from "../app/components/CreateProjectDialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../app/components/ui/resizable";
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
  // LLM-suggested prompts derived from overall Multiplex context (falls back to
  // the built-in examples when intelligence is off or hasn't generated any yet).
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    call("suggestions:global", undefined as never).then((p) => setSuggestions(p ?? [])).catch(() => {});
  }, []);
  return (
    <SessionDetail
      backLabel="Home"
      session={null}
      starterPrompts={suggestions.length ? suggestions : undefined}
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

  // M3.4 — agent workflow foundation handlers (M-A5 runtime). The runtime
  // decides whether to run the message now or queue it (single-threaded turns),
  // so the renderer just forwards it.
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

  // M-A5 — Subscribe to live harness events for the active session and build an
  // ordered, in-flight "turn" of steps (thinking → tool calls → streaming reply)
  // shown below the persisted transcript until the turn is flushed to the store.
  const [liveSteps, setLiveSteps] = useState<SessionMsg[]>([]);

  // Reset the live turn when switching sessions.
  useEffect(() => {
    setLiveSteps([]);
  }, [selectedSessionId]);

  useSessionStream(session?.id ?? null, (event) => {
    setLiveSteps((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      switch (event.type) {
        case "message_delta":
          if (last?.role === "agent") next[next.length - 1] = { ...last, content: last.content + event.delta };
          else next.push({ role: "agent", content: event.delta, ts: new Date().toISOString() });
          return next;
        case "reasoning_delta":
          if (last?.role === "thinking") next[next.length - 1] = { ...last, content: last.content + event.delta };
          else next.push({ role: "thinking", content: event.delta, ts: new Date().toISOString() });
          return next;
        case "tool_use":
          next.push({ role: "tool", content: "", ts: new Date().toISOString(), tool: { name: event.name, input: event.input, callId: event.id, status: "running" } });
          return next;
        case "tool_result": {
          const idx = next.findIndex((m) => m.tool?.callId === event.id);
          if (idx < 0) return prev;
          const m = next[idx];
          next[idx] = { ...m, content: event.content, tool: { ...m.tool!, status: event.isError ? "error" : "ok" } };
          return next;
        }
        default:
          return prev;
      }
    });
    // We deliberately do NOT clear on "message"/"done"; the live turn is cleared
    // (below) only once the persisted transcript has caught up, so steps don't
    // flicker in the gap between the event and the data reload.
  });

  // Once the persisted session ends with an agent message, the turn's output is
  // safely in `session.messages`; drop the live steps so we don't show them twice.
  const lastPersisted = session?.messages[session.messages.length - 1];
  const persistedEndsWithAgent = lastPersisted?.role === "agent";
  useEffect(() => {
    if (persistedEndsWithAgent && liveSteps.length > 0) {
      setLiveSteps([]);
    }
  }, [persistedEndsWithAgent, liveSteps.length]);

  // M-C4 — live working-tree diffs for the active standalone session.
  const { changes: worktreeChanges } = useChanges(session?.id ?? null, view === "session");
  // M-B3 — enrich the session's linked PRs with live GitHub detail. Skip the
  // live fetch when GitHub isn't connected — there's nothing to fetch, and the
  // stored linked PRs already render fine on their own.
  const enrichedPRs = usePrDetails(sessionPRs, view === "session" && mutations.githubConnected);

  // Show the live turn only while the agent's reply hasn't been persisted yet,
  // so the live stream transitions seamlessly into the saved transcript.
  const visibleLiveSteps = !!session && !persistedEndsWithAgent ? liveSteps : [];
  // The queue is owned by the runtime and persisted on the session.
  const sessionQueue = session?.queuedMessages ?? [];

  // Determine if we're inside a project session view (for sidebar highlight)
  const selectedProjectSessionId = view === "project" ? projectInitialSession : null;

  return (
    <div className="dark h-screen w-full overflow-hidden bg-background font-sans text-foreground">
      <ResizablePanelGroup direction="horizontal" autoSaveId="multiplex:shell" className="h-full w-full">
      <ResizablePanel order={1} defaultSize={18} minSize={12} maxSize={38} className="min-w-0">
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
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel order={2} className="flex min-w-0">
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
        {view === "session" && session && (
          <TaskView
            key={session.id}
            session={session}
            liveSteps={visibleLiveSteps}
            queuedMessages={sessionQueue}
            onInterruptQueued={(i) => session && mutations.interruptQueuedMessage(session.id, i)}
            onDeleteQueued={(i) => session && mutations.removeQueuedMessage(session.id, i)}
            prs={enrichedPRs}
            worktreeChanges={worktreeChanges}
            currentModel={settings?.defaultModel}
            availableModels={harnessInfo.models ?? []}
            onSelectModel={handleSelectModel}
            onAddReference={(r) => addReferenceToSession(session.id, r)}
            onSendMessage={sendMessageToSession}
            onStopAgent={stopSessionAgent}
            onReplyToComment={(repo, number, commentId, body) => mutations.replyToComment(repo, number, commentId, body)}
            onRerunChecks={(repo, number) => mutations.rerunChecks(repo, number)}
            onAddressComments={(comments) => mutations.addressComments(session.id, comments)}
            onOpenPR={() => mutations.openSessionPR(session.id)}
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
      </ResizablePanel>
      </ResizablePanelGroup>

      {/* M6.4 — Consolidated settings panel */}
      <SettingsPanel open={settingsOpen} onOpenChange={(open) => setSettingsOpen(open)} />

      {/* M5.2 — Create project dialog */}
      <CreateProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} onCreated={(id) => openProject(id, null)} />

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
