import { useEffect, useState, type ReactNode } from "react";
import {
  Search, Plus, Settings, Home, ChevronRight, ChevronDown,
  Archive, ArchiveRestore, GitPullRequest, BarChart3,
} from "lucide-react";
import { Project, Session, bucketForSession, sessionWindowLabels, SessionWindow } from "../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo } from "./SessionStateBadge";
import { formatRelativeTime } from "../../lib/format/time.js";
import { call } from "../../lib/ipc/client.js";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem } from "./ui/context-menu";

interface Props {
  projects: Project[];
  standaloneSessions: Session[];
  selectedProjectId: string;
  selectedSessionId: string | null;
  selectedProjectSessionId: string | null;
  view: "home" | "project" | "session" | "new-session" | "analytics";
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
  /** Open the token-usage analytics page. */
  onOpenAnalytics?: () => void;
  /** M5.2 — callback to open the Create Project dialog */
  onOpenCreateProject?: () => void;
  /** M6.3 — open the global search (⌘K) palette */
  onOpenSearch?: () => void;
  /** Right-click actions. */
  onEditProject?: (project: Project) => void;
  onRenameSession?: (session: Session) => void;
  onTogglePin?: (session: Session) => void;
}

const windowOrder: SessionWindow[] = ["last_24h", "last_7d", "last_30d", "older", "archived"];

/** Wrap a project row with a right-click menu (Edit Project). */
function ProjectMenu({ project, onEditProject, children }: { project: Project; onEditProject?: (p: Project) => void; children: ReactNode }) {
  if (!onEditProject) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={() => onEditProject(project)}>Edit Project</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Wrap a session row with a right-click menu (Rename / Pin). */
function SessionMenu({ session, onRenameSession, onTogglePin, children }: { session: Session; onRenameSession?: (s: Session) => void; onTogglePin?: (s: Session) => void; children: ReactNode }) {
  if (!onRenameSession && !onTogglePin) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {onRenameSession && <ContextMenuItem onClick={() => onRenameSession(session)}>Rename Session</ContextMenuItem>}
        {onTogglePin && <ContextMenuItem onClick={() => onTogglePin(session)}>{session.pinned ? "Unpin Session" : "Pin Session"}</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function ProjectsSidebar({
  projects, standaloneSessions, selectedProjectId, selectedSessionId, selectedProjectSessionId, view, githubConnected,
  onGoHome, onSelectProject, onOpenProjectSession, onSelectSession,
  onNewSession, onArchiveSession,
  isProjectSessionUnread, isStandaloneSessionUnread,
  onOpenSettings,
  onOpenAnalytics,
  onEditProject,
  onRenameSession,
  onTogglePin,
  onOpenCreateProject,
  onOpenSearch,
}: Props) {
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({
    [selectedProjectId]: true,
  });
  const [archivedOpen, setArchivedOpen] = useState(false);
  // Real app version for packaged releases; "dev" for unpackaged/dev runs.
  const [versionLabel, setVersionLabel] = useState("dev");
  useEffect(() => {
    call("app:version", undefined as never)
      .then(({ version, isPackaged }) => setVersionLabel(isPackaged ? `v${version}` : "dev"))
      .catch(() => { /* keep "dev" */ });
  }, []);

  const toggleExpand = (id: string) =>
    setExpandedProjects((p) => ({ ...p, [id]: !p[id] }));

  // Pinned sessions sort to the top, independent of age, and are excluded from
  // the time-window buckets below.
  const pinnedSessions = standaloneSessions
    .filter((s) => s.pinned && !s.archived)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  // Group the remaining standalone sessions by window.
  const buckets = windowOrder
    .map((w) => ({
      window: w,
      items: standaloneSessions
        .filter((s) => bucketForSession(s) === w && !(s.pinned && !s.archived))
        .sort((a, b) => b.createdAtMs - a.createdAtMs),
    }))
    .filter((b) => b.items.length > 0);

  // One standalone-session row (reused by the Pinned section + time buckets).
  const standaloneRow = (s: Session) => {
    const isSel = view === "session" && s.id === selectedSessionId;
    return (
      <SessionMenu key={s.id} session={s} onRenameSession={onRenameSession} onTogglePin={onTogglePin}>
        <div className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${isSel ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"}`}>
          <button onClick={() => onSelectSession(s.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate text-[12.5px] text-foreground ${isStandaloneSessionUnread(s.id) ? "font-semibold" : ""}`}>{s.title}</span>
                {s.status === "running" ? (
                  <SessionStateIndicator status="running" size={10} />
                ) : (
                  <span className="font-mono text-[10px] text-muted-foreground">{formatRelativeTime(s.createdAtMs)}</span>
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
      </SessionMenu>
    );
  };

  return (
    <aside className="flex h-full w-full min-w-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 ring-1 ring-accent/40">
          <span className="font-mono text-[10px] text-accent">MX</span>
        </div>
        <span className="font-display text-[17px] tracking-tight text-foreground">Multiplex</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{versionLabel}</span>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2 rounded-md border border-border bg-input-background px-2.5 py-1.5 text-left hover:border-border-strong"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="w-full text-[12.5px] text-muted-foreground/70">Search projects, sessions, PRs</span>
          <span className="font-mono text-[10px] text-muted-foreground">⌘K</span>
        </button>
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
                <ProjectMenu project={p} onEditProject={onEditProject}>
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
                </ProjectMenu>

                {/* Inline sessions under expanded project (archived hidden — they
                    live in the project's "Archived sessions" section). */}
                {expanded && (
                  <div className="mb-1 ml-5 border-l border-sidebar-border pl-1">
                    {p.sessions.filter((s) => !s.archived).length === 0 ? (
                      <div className="px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground/70">No sessions</div>
                    ) : (
                      p.sessions
                        .filter((s) => !s.archived)
                        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAtMs - a.createdAtMs)
                        .map((s) => {
                          const isSelected = selectedProjectSessionId === s.id && selectedProjectId === p.id && view === "project";
                          return (
                            <SessionMenu key={s.id} session={s} onRenameSession={onRenameSession} onTogglePin={onTogglePin}>
                            <button
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
                            </SessionMenu>
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
          {pinnedSessions.length > 0 && (
            <section className="mt-1.5">
              <div className="flex items-center gap-1.5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">
                <span>Pinned</span>
                <span className="ml-auto normal-case tracking-normal text-muted-foreground/60">{pinnedSessions.length}</span>
              </div>
              <div>{pinnedSessions.map((s) => standaloneRow(s))}</div>
            </section>
          )}
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
                    {bucket.items.map((s) => standaloneRow(s))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="flex flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </button>
          <button
            onClick={onOpenAnalytics}
            title="Token usage"
            className="rounded-sm p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            <BarChart3 className="h-3.5 w-3.5" />
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
