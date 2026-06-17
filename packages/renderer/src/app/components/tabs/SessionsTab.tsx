import { useState } from "react";
import { Plus, Terminal, ChevronRight, ChevronDown, GitPullRequest, Archive, ArchiveRestore } from "lucide-react";
import { Project, Session } from "../../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo, sessionWeight } from "../SessionStateBadge";
import { SessionDetail } from "../SessionDetail";
import { LiveSession } from "../LiveSession";
import { formatRelativeTime } from "../../../lib/format/time.js";

interface Props {
  project: Project;
  openId: string | "new" | null;
  onOpen: (id: string | "new" | null) => void;
  /** Called when the user starts a new session from within this tab. */
  onStartSession?: (prompt: string) => void;
  /** Navigate to a project note (e.g. from a note tool-call card). */
  onOpenNote?: (noteId: string) => void;
  /** Archive / unarchive a session in this project. */
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
}

export function SessionsTab({ project, openId, onOpen, onStartSession, onOpenNote, onArchiveSession }: Props) {
  const close = () => onOpen(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  if (openId === "new") {
    return (
      <SessionDetail
        projectName={project.name}
        backLabel="All sessions"
        session={null}
        references={project.references}
        starterPrompts={project.suggestedPrompts}
        onStartSession={onStartSession}
        onClose={close}
      />
    );
  }

  const session = openId ? project.sessions.find((s) => s.id === openId) : null;
  if (session) {
    return (
      <LiveSession
        projectName={project.name}
        backLabel="All sessions"
        session={session}
        onClose={close}
        onOpenNote={onOpenNote}
      />
    );
  }

  // A specific session was requested but isn't in the project yet — this is the
  // brief window after an optimistic "start session" navigation, before the
  // runtime has persisted it and emitted data:changed. Show a starting state
  // rather than flashing the full session list.
  if (openId && openId !== "new") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <Terminal className="h-6 w-6 animate-pulse text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground">Starting session…</p>
      </div>
    );
  }

  const active = [...project.sessions]
    .filter((s) => !s.archived)
    .sort((a, b) => sessionWeight(b.status) - sessionWeight(a.status));
  const archived = [...project.sessions]
    .filter((s) => s.archived)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-foreground">Sessions</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Each session wraps an agent run — sessions can span multiple repos and open a PR in each.
          </p>
        </div>
        <button
          onClick={() => onOpen("new")}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] text-accent-foreground hover:bg-accent/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New session
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {project.sessions.length === 0 ? (
          <div className="p-10 text-center">
            <Terminal className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">No sessions yet. Start one to put an agent to work.</p>
          </div>
        ) : active.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-[13px] text-muted-foreground">No active sessions — all are archived.</p>
          </div>
        ) : (
          active.map((s, i) => (
            <SessionRow
              key={s.id}
              session={s}
              divider={i < active.length - 1}
              onOpen={() => onOpen(s.id)}
              onArchive={onArchiveSession}
            />
          ))
        )}
      </div>

      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setArchivedOpen((v) => !v)}
            className="flex items-center gap-1.5 px-1 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Archived sessions
            <span className="normal-case tracking-normal text-muted-foreground/60">{archived.length}</span>
          </button>
          {archivedOpen && (
            <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
              {archived.map((s, i) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  divider={i < archived.length - 1}
                  onOpen={() => onOpen(s.id)}
                  onArchive={onArchiveSession}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One session row with an archive/unarchive affordance. The open action and
 *  the archive action are sibling buttons inside a relative wrapper, so neither
 *  is nested in the other. */
function SessionRow({ session: s, divider, onOpen, onArchive }: {
  session: Session;
  divider: boolean;
  onOpen: () => void;
  onArchive?: (sessionId: string, archived: boolean) => void;
}) {
  return (
    <div className={`group relative ${divider ? "border-b border-border/60" : ""}`}>
      <button
        onClick={onOpen}
        className="grid w-full grid-cols-[1fr_auto_auto_auto] items-start gap-4 px-5 py-3.5 pr-12 text-left transition-colors hover:bg-secondary/40"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] text-foreground">{s.title}</span>
            {(s.linkedPRs ?? []).map((lp) => (
              <span key={`${lp.repo}#${lp.number}`} className="flex items-center gap-1 rounded-sm bg-secondary px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                <GitPullRequest className="h-2.5 w-2.5" />{lp.repo} #{lp.number}
              </span>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
            {sessionStateInfo[s.status].tone !== "neutral" && (
              <>
                <SessionStateLabel status={s.status} withSpinner={false} />
                <span className="text-muted-foreground/40">·</span>
              </>
            )}
            <span>{s.workspaces.map((w) => `${w.repo}/${w.branch}`).join(" + ") || "no workspace"}</span>
            {s.status !== "running" && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>started {formatRelativeTime(s.createdAtMs)}</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">Model</div>
          <div className="mt-0.5 font-mono text-[11.5px] text-foreground">{s.model}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">Cost</div>
          <div className="mt-0.5 font-mono text-[11.5px] text-foreground">${s.cost.toFixed(2)} · {(s.tokens / 1000).toFixed(1)}k</div>
        </div>
        <span className="mt-1 flex w-4 justify-center">
          {s.status === "running" && <SessionStateIndicator status="running" size={14} />}
        </span>
      </button>
      {onArchive && (
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(s.id, !s.archived); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
          title={s.archived ? "Unarchive" : "Archive"}
        >
          {s.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
