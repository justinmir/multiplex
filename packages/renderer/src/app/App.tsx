import { useState } from "react";
import { ProjectsSidebar } from "./components/ProjectsSidebar";
import { ProjectView } from "./components/ProjectView";
import { HomeView } from "./components/HomeView";
import { TaskView } from "./components/TaskView";
import { SessionDetail } from "./components/SessionDetail";
import { useDataMutations } from "../lib/data/DataProvider.js";
import { projects, standaloneSessions as seed, Session, Reference } from "./data/mockData";
import { sessionStateInfo } from "./components/SessionStateBadge";

const projectKey = (pid: string, sid: string) => `p/${pid}/${sid}`;
const standaloneKey = (sid: string) => `s/${sid}`;

/** Seed: anything with attention-needed state OR currently running is unread. */
const initialUnread = new Set<string>([
  ...projects.flatMap((p) =>
    p.sessions
      .filter((s) => sessionStateInfo[s.status].tone !== "neutral" || s.status === "running")
      .map((s) => projectKey(p.id, s.id))
  ),
  ...seed
    .filter((s) => sessionStateInfo[s.status].tone !== "neutral" || s.status === "running")
    .map((s) => standaloneKey(s.id)),
]);

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

export default function App() {
  const mutations = useDataMutations();
  const [view, setView] = useState<View>("home");
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0].id);
  const [projectInitialSession, setProjectInitialSession] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>(seed);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [unread, setUnread] = useState<Set<string>>(initialUnread);

  const markRead = (key: string) => {
    setUnread((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const project = projects.find((p) => p.id === selectedProjectId) ?? projects[0];
  const session = sessions.find((s) => s.id === selectedSessionId) ?? null;

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
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, archived } : s)));
  };

  const addReferenceToSession = (sessionId: string, ref: Reference) => {
    setSessions((prev) => prev.map((s) =>
      s.id === sessionId ? { ...s, references: [ref, ...(s.references ?? [])] } : s
    ));
  };

  /** Stop the agent for a session — calls both stopAgent and updateSessionStatus for clean transition. */
  const handleStopAgent = (sessionId: string) => {
    mutations.stopAgent(sessionId);
  };

  const createSession = (prompt: string) => {
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
    setSessions((prev) => [next, ...prev]);
    openSession(id);
  };

  // Resolve PRs for the current standalone session against any project that hosts a matching repo
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
        onGoHome={() => setView("home")}
        onSelectProject={(id) => openProject(id, null)}
        onOpenProjectSession={(pid, sid) => openProject(pid, sid)}
        onSelectSession={openSession}
        onNewSession={() => setView("new-session")}
        onArchiveSession={archiveSession}
        isProjectSessionUnread={(pid, sid) => unread.has(projectKey(pid, sid))}
        isStandaloneSessionUnread={(sid) => unread.has(standaloneKey(sid))}
        onOpenSettings={() => {}}
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
        {view === "project" && (
          <ProjectView key={`${project.id}:${projectInitialSession ?? ""}`} project={project} initialSessionId={projectInitialSession} />
        )}
        {view === "session" && session && (
          <TaskView
            key={session.id}
            session={session}
            prs={sessionPRs}
            onAddReference={(r) => addReferenceToSession(session.id, r)}
            onStopAgent={() => handleStopAgent(session.id)}
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
    </div>
  );
}
