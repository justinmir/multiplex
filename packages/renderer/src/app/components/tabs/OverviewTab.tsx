import { Sparkles, Terminal, FileText, ArrowRight, Plus, ChevronRight, BookOpen, GitPullRequest, Target } from "lucide-react";
import { Project, ActivityItem, Note, Reference } from "../../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo, sessionWeight } from "../SessionStateBadge";
import { ReferenceRow } from "./ReferencesTab";

interface Props {
  project: Project;
  references: Reference[];
  onOpenSession: (id: string | "new") => void;
  onOpenNote: (id: string) => void;
  onOpenTab: (t: "sessions" | "notes" | "references") => void;
}

const iconFor = (k: ActivityItem["kind"]) =>
  k === "pr" ? GitPullRequest : k === "session" ? Terminal : k === "note" ? FileText : k === "ref" ? BookOpen : Sparkles;

export function OverviewTab({ project, references, onOpenSession, onOpenNote, onOpenTab }: Props) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* AI summary */}
      <section className="lg:col-span-3 rounded-lg border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            Agent summary · synthesized 14m ago
          </span>
        </div>
        <p className="font-display text-[22px] leading-[1.35] text-foreground">{project.summary}</p>

        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2.5 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            <Target className="h-3 w-3" /> Suggested next steps
          </div>
          <ul className="space-y-1.5">
            {project.nextSteps.map((step, i) => (
              <li key={i} className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-secondary/60">
                <span className="mt-1 font-mono text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 text-[13px] text-foreground">{step}</span>
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Sessions */}
      <section className="lg:col-span-3 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-foreground">Sessions</h3>
          </div>
          <button
            onClick={() => onOpenSession("new")}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11.5px] text-foreground hover:bg-secondary"
          >
            <Plus className="h-3 w-3" /> New session
          </button>
        </div>
        {project.sessions.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
            No sessions yet — start one to put an agent to work.
          </div>
        ) : (
          <ul>
            {[...project.sessions]
              .sort((a, b) => sessionWeight(b.status) - sessionWeight(a.status))
              .map((s, i, arr) => (
                <li key={s.id}>
                  <button
                    onClick={() => onOpenSession(s.id)}
                    className={`group grid w-full grid-cols-[1fr_auto_auto] items-start gap-3 px-5 py-2.5 text-left hover:bg-secondary/40 ${
                      i < arr.length - 1 ? "border-b border-border/60" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-foreground">{s.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate font-mono text-[10.5px] text-muted-foreground">
                        {sessionStateInfo[s.status].tone !== "neutral" && (
                          <>
                            <SessionStateLabel status={s.status} withSpinner={false} />
                            <span className="text-muted-foreground/40">·</span>
                          </>
                        )}
                        <span>{s.workspaces.map((w) => w.repo).join(" + ") || "no workspace"}</span>
                      </div>
                    </div>
                    <span className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                      {s.status === "running" ? <SessionStateIndicator status="running" size={12} /> : s.startedAt}
                    </span>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Notes */}
      <section className="rounded-lg border border-border bg-card lg:col-span-2">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-foreground">Notes</h3>
          </div>
          <button
            onClick={() => onOpenTab("notes")}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {project.notes.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">No notes yet.</div>
        ) : (
          <ul>
            {project.notes.map((n: Note, i) => (
              <li key={n.id}>
                <button
                  onClick={() => onOpenNote(n.id)}
                  className={`group flex w-full flex-col gap-1 px-5 py-2.5 text-left hover:bg-secondary/40 ${
                    i < project.notes.length - 1 ? "border-b border-border/60" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] text-foreground">{n.title}</span>
                    <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{n.updatedAt}</span>
                  </div>
                  <p className="line-clamp-2 text-[12px] text-muted-foreground">{n.body}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* References */}
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-foreground">References</h3>
          </div>
          <button
            onClick={() => onOpenTab("references")}
            className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            Manage
          </button>
        </div>
        {references.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">No references yet.</div>
        ) : (
          <div>
            {references.slice(0, 5).map((r, i) => (
              <ReferenceRow key={r.id} reference={r} divider={i < Math.min(references.length, 5) - 1} compact />
            ))}
          </div>
        )}
      </section>

      {/* Pull Requests */}
      <section className="lg:col-span-3 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-foreground">Pull Requests</h3>
          </div>
        </div>
        {project.prs.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
            No PRs synced yet — connect GitHub and run a sync to populate this view.
          </div>
        ) : (
          <ul>
            {project.prs.map((pr, i) => (
              <li key={pr.id}>
                <div className={`group flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-secondary/40 ${i < project.prs.length - 1 ? "border-b border-border/60" : ""}`}>
                  {/* Mergeability badge */}
                  <span className={`flex h-2 w-2 shrink-0 rounded-full ${
                    pr.mergeable === 'clean' ? 'bg-green-500' :
                    pr.mergeable === 'conflict' ? 'bg-red-500' :
                    'bg-yellow-500/60'
                  }`} />

                  {/* PR info */}
                  <span className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-foreground">{pr.title}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">#{pr.number}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                      <span>{pr.repo}/{pr.branch}</span>
                      {pr.checks && (
                        <>
                          <span className="text-muted-foreground/40">&#8226;</span>
                          <span className={pr.checks.failed > 0 ? 'text-red-400' : ''}>
                            {pr.checks.passed} passed &#8226; {pr.checks.failed} failed &#8226; {pr.checks.pending} pending
                          </span>
                        </>
                      )}
                    </div>
                  </span>

                  {/* Status badge */}
                  <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide ${
                    pr.status === 'merged' ? 'bg-purple-500/15 text-purple-400' :
                    pr.status === 'draft' ? 'bg-gray-500/15 text-gray-400' :
                    'bg-blue-500/15 text-blue-400'
                  }`}>
                    {pr.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activity */}
      <section className="lg:col-span-3 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-foreground">Recent activity</h3>
        </div>
        <ul>
          {project.activity.map((a) => {
            const Icon = iconFor(a.kind);
            return (
              <li key={a.id} className="group flex items-center gap-3 border-b border-border/60 px-5 py-2.5 last:border-b-0 hover:bg-secondary/40">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-[13px] text-foreground">{a.text}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{a.ts}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
