import { Plus, Terminal, ChevronRight, GitPullRequest } from "lucide-react";
import { Project } from "../../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo, sessionWeight } from "../SessionStateBadge";
import { SessionDetail } from "../SessionDetail";
import { formatRelativeTime } from "../../../lib/format/time.js";
import { useDataMutations } from "../../../lib/data/DataProvider.js";

interface Props {
  project: Project;
  openId: string | "new" | null;
  onOpen: (id: string | "new" | null) => void;
  /** Called when the user starts a new session from within this tab. */
  onStartSession?: (prompt: string) => void;
}

export function SessionsTab({ project, openId, onOpen, onStartSession }: Props) {
  const mutations = useDataMutations();
  const close = () => onOpen(null);

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
    const prs = session.linkedPRs ?? [];
    return (
      <SessionDetail
        projectName={project.name}
        backLabel="All sessions"
        session={session}
        prs={prs}
        references={session.references ?? []}
        onAddReference={(r) => mutations.upsertSessionReference(session.id, r)}
        onStopAgent={() => mutations.stopSessionViaRuntime(session.id)}
        onClose={close}
      />
    );
  }

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
        {project.sessions.length === 0 && (
          <div className="p-10 text-center">
            <Terminal className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="text-[13px] text-muted-foreground">No sessions yet. Start one to put an agent to work.</p>
          </div>
        )}
        {[...project.sessions]
          .sort((a, b) => sessionWeight(b.status) - sessionWeight(a.status))
          .map((s, i, arr) => (
            <button
              key={s.id}
              onClick={() => onOpen(s.id)}
              className={`group grid w-full grid-cols-[1fr_auto_auto_auto_auto] items-start gap-4 px-5 py-3.5 text-left transition-colors hover:bg-secondary/40 ${
                i < arr.length - 1 ? "border-b border-border/60" : ""
              }`}
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
              <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
      </div>
    </div>
  );
}
