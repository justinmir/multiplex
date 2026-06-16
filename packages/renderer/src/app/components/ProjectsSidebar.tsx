import { useState } from "react";
import {
  Search, Plus, Settings, Home, ChevronRight, ChevronDown,
  Archive, ArchiveRestore, GitPullRequest,
} from "lucide-react";
import { Project, Session, bucketForSession, sessionWindowLabels, SessionWindow } from "../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo } from "./SessionStateBadge";

interface Props {
  projects: Project[];
  standaloneSessions: Session[];
  selectedProjectId: string;
  selectedSessionId: string | null;
  selectedProjectSessionId: string | null;
  view: "home" | "project" | "session" | "new-session";
  githubConnected?: boolean;
  onGoHome: () => void;
  onSelectProject: (id: string) => void;
  onOpenProjectSession: (projectId: string, sessionId: string) => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  isProjectSessionUnread: (projectId: string, sessionId: string) => boolean;
  isStandaloneSessionUnread: (sessionId: string) => boolean;
  /** M4.2 — callback to open the Settings dialog */
  onOpenSettings: () => void;
  /** M5.2 — callback to open the Create Project dialog */
  onOpenCreateProject?: () => void;
}

const windowOrder: SessionWindow[] = ["last_24h", "last_7d", "last_30d", "older", "archived"];

export function ProjectsSidebar({
  projects, standaloneSessions, selectedProjectId, selectedSessionId, selectedProjectSessionId, view, githubConnected,
  onGoHome, onSelectProject, onOpenProjectSession, onSelectSession,
  onNewSession, onArchiveSession,
  isProjectSessionUnread, isStandaloneSessionUnread,
  onOpenSettings,
  onOpenCreateProject,
}: Props) {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({
    [selectedProjectId]: true,
  });
  const [archivedOpen, setArchivedOpen] = useState(false);

  const toggleExpand = (id: string) =>
    setExpandedProjects((p) => ({ ...p, [id]: !p[id] }));

  // Group standalone sessions by window
  const buckets = windowOrder
    .map((w) => ({
      window: w,
      items: standaloneSessions
        .filter((s) => bucketForSession(s) === w)
        .sort((a, b) => b.createdAtMs - a.createdAtMs),
    }))
    .filter((b) => b.items.length > 0);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 ring-1 ring-accent/40">
          <span className="font-mono text-[10px] text-accent">HX</span>
        </div>
        <span className="font-display text-[17px] tracking-tight text-foreground">harness</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">v0.4.2</span>
      </div>

      <div className="px-3 pb-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-input-background px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            placeholder="Search projects, sessions, PRs"
            className="w-full bg-transparent text-[12.5px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <span className="font-mono text-[10px] text-muted-foreground">⌘K</span>
        </div>
      </div>

      <nav className="px-2 pb-2">
        <button
          onClick={onGoHome}
          className={`group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
            view === "home" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60"
          }`}
        >
          <Home className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
          <span>Home</span>
        </button>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Projects */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Projects
          </span>
          <button
            onClick={onOpenCreateProject}
            className="rounded-sm p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            title="New project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-2 pb-1">
          {projects.map((p) => {
            const isSel = view === "project" && p.id === selectedProjectId;
            const expanded = !!expandedProjects[p.id];
            return (
              <div key={p.id}>
                <div className={`group flex w-full items-center gap-0.5 rounded-md ${isSel ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}>
                  <button
                    onClick={() => toggleExpand(p.id)}
                    className="flex h-7 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={expanded ? "Collapse" : "Expand"}
                  >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => onSelectProject(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left"
                  >
                    <span className="truncate text-[13px] text-foreground">{p.name}</span>
                    {p.prs.length > 0 && (
                      <span className="flex items-center gap-1 rounded-sm bg-secondary/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                        <GitPullRequest className="h-2.5 w-2.5" />{p.openPRs} open
                      </span>
                    )}
                  </button>
                </div>

                {/* Inline sessions under expanded project */}
                {expanded && (
                  <div className="mb-1 ml-5 border-l border-sidebar-border pl-1">
                    {p.sessions.length === 0 ? (
                      <div className="px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground/70">No sessions</div>
                    ) : (
                      [...p.sessions]
                        .sort((a, b) => b.createdAtMs - a.createdAtMs)
                        .map((s) => {
                          const isSelected = selectedProjectSessionId === s.id && selectedProjectId === p.id && view === "project";
                          return (
                            <button
                              key={s.id}
                              onClick={() => onOpenProjectSession(p.id, s.id)}
                              className={`group flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors ${
                                isSelected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
                              }`}
                              title={s.title}
                            >
                              <div className="min-w-0 flex-1">
                                <div className={`truncate text-[12px] text-foreground ${isProjectSessionUnread(p.id, s.id) ? "font-semibold" : ""}`}>
                                  {s.title}
                                </div>
                                {sessionStateInfo[s.status].tone !== "neutral" && (
                                  <SessionStateLabel status={s.status} withSpinner={false} className="text-[10.5px] font-mono" />
                                )}
                              </div>
                              <span className="mt-0.5 flex w-3 shrink-0 justify-center">
                                <SessionStateIndicator status={s.status} size={10} />
                              </span>
                            </button>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sessions (standalone) */}
        <div className="flex items-center justify-between px-4 pt-4 pb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Sessions
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {standaloneSessions.filter((s) => !s.archived).length}
          </span>
        </div>

        <div className="px-2 pb-1">
          <button
            onClick={onNewSession}
            className={`mb-1.5 flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors ${
              view === "new-session" ? "bg-sidebar-accent" : "bg-card hover:bg-secondary"
            }`}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <span>New Session</span>
          </button>
        </div>

        <div className="px-2 pb-3">
          {buckets.map((bucket) => {
            const isArchived = bucket.window === "archived";
            const open = isArchived ? archivedOpen : true;
            return (
              <section key={bucket.window} className="mt-1.5">
                <button
                  onClick={() => isArchived && setArchivedOpen((v) => !v)}
                  className={`flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80 ${
                    isArchived ? "hover:text-foreground" : "cursor-default"
                  }`}
                >
                  {isArchived && (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                  <span>{sessionWindowLabels[bucket.window]}</span>
                  <span className="ml-auto normal-case tracking-normal text-muted-foreground/60">{bucket.items.length}</span>
                </button>
                {open && (
                  <div>
                    {bucket.items.map((s) => {
                      const isSel = view === "session" && s.id === selectedSessionId;
                      return (
                        <div
                          key={s.id}
                          className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                            isSel ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
                          }`}
                        >
                          <button
                            onClick={() => onSelectSession(s.id)}
                            className="flex min-w-0 flex-1 items-start gap-2 text-left"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <span className={`min-w-0 flex-1 truncate text-[12.5px] text-foreground ${isStandaloneSessionUnread(s.id) ? "font-semibold" : ""}`}>
                                  {s.title}
                                </span>
                                {s.status === "running" ? (
                                  <SessionStateIndicator status="running" size={10} />
                                ) : (
                                  <span className="font-mono text-[10px] text-muted-foreground">{s.startedAt}</span>
                                )}
                              </div>
                              {sessionStateInfo[s.status].tone !== "neutral" && (
                                <SessionStateLabel status={s.status} withSpinner={false} className="text-[10.5px] font-mono" />
                              )}
                            </div>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onArchiveSession(s.id, !s.archived); }}
                            className="rounded-sm p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                            title={s.archived ? "Unarchive" : "Archive"}
                          >
                            {s.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary font-mono text-[10px] text-foreground">
            AS
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-foreground">Alex Stern</div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">alex@acme.dev</div>
          </div>
          <button
            onClick={onOpenSettings}
            className="rounded-sm p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* GitHub connection status */}
        {githubConnected !== undefined && !githubConnected && (
          <button
            onClick={onOpenSettings}
            className="mt-1.5 block w-full rounded-sm bg-yellow-500/15 px-1.5 py-0.5 font-mono text-[9px] text-yellow-400 hover:bg-yellow-500/25"
          >
            Connect GitHub for live PRs
          </button>
        )}
      </div>
    </aside>
  );
}
