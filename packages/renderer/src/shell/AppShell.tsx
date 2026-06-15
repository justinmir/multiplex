import { useEffect, useState } from "react";
import { ProjectsSidebar } from "../app/components/ProjectsSidebar";
import { ProjectView } from "../app/components/ProjectView";
import { HomeView } from "../app/components/HomeView";
import { TaskView } from "../app/components/TaskView";
import { SessionDetail } from "../app/components/SessionDetail";
import { SettingsDialog } from "../app/components/SettingsDialog";
import { useDataMutations, useDataLoading, useProjects, useStandaloneSessions } from "../lib/data/DataProvider.js";
import type { Session, Reference, SessionMsg } from "@app/core";
import { sessionStateInfo } from "../app/components/SessionStateBadge";

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

function NewSessionView({ onStart, onClose }: { onStart: (prompt: string) => void; onClose: () => void }) {
  return (
    <SessionDetail
      backLabel="Home"
      session={null}
      onStartSession={onStart}
      onClose={onClose}
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

  // Initialize selected project and unread state once when data first loads
  useEffect(() => {
    if (projects.length > 0) {
      setSelectedProjectId(projects[0].id);
      setUnread(computeInitialUnread(projects, dataSessions));
    }
  }, [projects, dataSessions]);

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

  // M3.4 — agent workflow foundation handlers
  const sendMessageToSession = async (messageText: string) => {
    if (!session) return;
    const msg: SessionMsg = {
      role: "user",
      content: messageText,
      ts: new Date().toISOString(),
    };
    await mutations.addMessage(session.id, msg);
    // Trigger agent execution after persisting the user message
    await mutations.startAgent(session.id);
  };

  const stopSessionAgent = async () => {
    if (!session) return;
    await mutations.stopAgent(session.id);
  };

  const createSession = async (prompt: string) => {
    const id = `ss_${Date.now().toString(36)}`;
    const title = prompt.length > 60 ? prompt.slice(0, 60).trim() + "…" : prompt;
    const next: Session = {
      id, title, prompt,
      status: "running",
      model: "claude-sonnet-4-6",
      workspaces: [],
      startedAt: "just now",
      createdAtMs: Date.now(),
      durationMin: 0, tokens: 0, cost: 0,
      messages: [
        { role: "user", content: prompt, ts: "just now" },
        { role: "agent", content: "Spinning up a fresh workspace and getting started.", ts: "just now" },
      ],
    };
    await mutations.createSession(next);
    openSession(id);
  };

  // Resolve PRs for the current standalone session against any project that hosts a matching repo
  const session = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const sessionPRs = session?.linkedPRs
    ? session.linkedPRs
        .map((lp) => projects.flatMap((p) => p.prs).find((pr) => pr.repo === lp.repo && pr.number === lp.number))
        .filter((p): p is NonNullable<typeof p> => !!p)
    : [];

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
          <ProjectView key={`${project.id}:${projectInitialSession ?? ""}`} project={project} initialSessionId={projectInitialSession} onSync={() => mutations.syncProject(selectedProjectId)} isSyncing={isSyncing} />
        )}
        {view === "session" && session && (
          <TaskView
            key={session.id}
            session={session}
            prs={sessionPRs}
            onAddReference={(r) => addReferenceToSession(session.id, r)}
            onSendMessage={sendMessageToSession}
            onStopAgent={stopSessionAgent}
            onClose={() => setView("home")}
          />
        )}
        {view === "new-session" && (
          <NewSessionView
            onStart={createSession}
            onClose={() => setView("home")}
          />
        )}
      </main>

      {/* M4.2 — Settings dialog */}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
