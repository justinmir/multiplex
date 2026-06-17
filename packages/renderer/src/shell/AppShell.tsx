import { useEffect, useRef, useState } from "react";
import { ProjectsSidebar } from "../app/components/ProjectsSidebar";
import { ProjectView } from "../app/components/ProjectView";
import { HomeView } from "../app/components/HomeView";
import { LiveSession } from "../app/components/LiveSession";
import { SessionDetail } from "../app/components/SessionDetail";
import { SettingsPanel } from "./SettingsPanel.js";
import { CreateProjectDialog } from "../app/components/CreateProjectDialog";
import { RenameSessionDialog } from "../app/components/RenameSessionDialog";
import { AnalyticsView } from "../app/components/AnalyticsView";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../app/components/ui/resizable";
import { SearchPalette } from "../lib/search/SearchPalette.js";
import { useDataMutations, useDataLoading, useProjects, useStandaloneSessions } from "../lib/data/DataProvider.js";
import { useHarnessInfo } from "../lib/session/useHarnessInfo.js";
import type { Session, Project, AppSettingsData } from "@app/core";
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

type View = "home" | "project" | "session" | "new-session" | "analytics";

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

  // Settings dialog state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Create project dialog state
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  // Context-menu editing state (Edit Project / Rename Session).
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [renamingSession, setRenamingSession] = useState<Session | null>(null);

  // Global search palette (⌘K)
  const [searchOpen, setSearchOpen] = useState(false);

  // Load settings for harness/model state
  const [settings, setSettings] = useState<AppSettingsData | null>(null);
  useEffect(() => {
    call("settings:get", undefined).then((data) => setSettings(data));
  }, []);

  // Always fetch models for current harness so we can show in composer
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

  // Initialize selected project and unread state ONCE when data first loads.
  // Previously this ran on every data:changed reload, which reset the selected
  // project back to projects[0] (yanking the user between projects) and clobbered
  // read state. Guard it so it only runs on the first populated load.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && projects.length > 0) {
      initializedRef.current = true;
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
    // Persist both directions (archive + unarchive).
    mutations.archiveSession(id, archived);
  };

  const createSession = async (prompt: string) => {
    try {
      const { sessionId } = await mutations.startSession({ prompt });
      openSession(sessionId);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  // project-scoped session creation
  // Navigate to the session immediately (optimistic) so clicking a suggested
  // next step opens the created session right away instead of waiting for the
  // full startSession round-trip (workspace prep + harness spawn). We mint the
  // id client-side and hand it to the runtime, which persists the session early
  // and emits data:changed so the live view populates within a frame.
  const handleCreateProjectSession = (prompt: string, projectId: string) => {
    const sessionId = `ss_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    openProject(projectId, sessionId);
    mutations.startSession({ sessionId, prompt, projectId }).catch((err) => {
      console.error("Failed to create project session:", err);
      // Roll back the optimistic navigation if the session never got created
      // (e.g. concurrency limit hit before it was persisted).
      setProjectInitialSession((cur) => (cur === sessionId ? null : cur));
    });
  };

  // The active standalone session (its full live view is owned by LiveSession).
  const session = sessions.find((s) => s.id === selectedSessionId) ?? null;

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
        onOpenAnalytics={() => setView("analytics")}
        onOpenCreateProject={() => setCreateProjectOpen(true)}
        onEditProject={(p) => setEditingProject(p)}
        onRenameSession={(s) => setRenamingSession(s)}
        onTogglePin={(s) => mutations.setSessionPinned(s.id, !s.pinned)}
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
          <LiveSession key={session.id} session={session} onClose={() => setView("home")} />
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
        {view === "analytics" && <AnalyticsView onClose={() => setView("home")} />}
      </main>
      </ResizablePanel>
      </ResizablePanelGroup>

      {/* Consolidated settings panel */}
      <SettingsPanel open={settingsOpen} onOpenChange={(open) => setSettingsOpen(open)} />

      {/* Create project dialog */}
      <CreateProjectDialog open={createProjectOpen} onOpenChange={setCreateProjectOpen} onCreated={(id) => openProject(id, null)} />

      {/* Edit Project (from right-click) */}
      <CreateProjectDialog open={!!editingProject} onOpenChange={(o) => { if (!o) setEditingProject(null); }} editProject={editingProject} />

      {/* Rename Session (from right-click) */}
      <RenameSessionDialog session={renamingSession} onOpenChange={(o) => { if (!o) setRenamingSession(null); }} />

      {/* Global search palette (⌘K) */}
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
