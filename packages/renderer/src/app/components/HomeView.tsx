import { ChevronRight, Cpu, GitBranch, GitPullRequest, Zap, Plus, Folder } from "lucide-react";
import { useState } from "react";
import { Project, Session, SessionStatus } from "../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo, sessionWeight } from "./SessionStateBadge";
import { formatRelativeTime } from "../../lib/format/time.js";

interface Props {
  projects: Project[];
  standaloneSessions: Session[];
  onOpenProject: (id: string) => void;
  onOpenStandaloneSession: (id: string) => void;
  onOpenProjectSession: (projectId: string, sessionId: string) => void;
  onCreateSession: (prompt: string) => void;
}

type Row = {
  key: string;
  parentKind: "project" | "session";
  parentName: string;
  session: Session;
  onOpen: () => void;
};

const needsAttention = (s: SessionStatus) => sessionStateInfo[s].tone !== "neutral";

export function HomeView({
  projects, standaloneSessions, onOpenProject, onOpenStandaloneSession, onOpenProjectSession, onCreateSession,
}: Props) {
  const active = standaloneSessions.filter((s) => !s.archived);

  const allRows: Row[] = [
    ...projects.flatMap((p) =>
      p.sessions.map((s) => ({
        key: `p:${p.id}:${s.id}`,
        parentKind: "project" as const,
        parentName: p.name,
        session: s,
        onOpen: () => onOpenProjectSession(p.id, s.id),
      }))
    ),
    ...active.map((s) => ({
      key: `s:${s.id}`,
      parentKind: "session" as const,
      parentName: "Session",
      session: s,
      onOpen: () => onOpenStandaloneSession(s.id),
    })),
  ];

  const attention = allRows
    .filter((r) => needsAttention(r.session.status))
    .sort((a, b) => sessionWeight(b.session.status) - sessionWeight(a.session.status));

  const running = allRows.filter((r) => r.session.status === "running");

  // Recent standalone sessions for the bottom rail
  const recent = [...active]
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 6);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="px-8 pt-10 pb-6">
        <h1 className="font-display text-[32px] leading-none text-foreground">Home</h1>
        <p className="mt-2 text-[13.5px] text-muted-foreground">
          Everything in flight, ordered by what needs you most.
        </p>
        <PromptBar onSubmit={onCreateSession} />
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-14">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8">
          {/* Needs you */}
          <Section title="Needs you" count={attention.length} hint="Sessions waiting on review, input, or a fix.">
            {attention.length === 0 ? (
              <EmptyRow text="Nothing is waiting on you right now." />
            ) : (
              <Card>{attention.map((r, i) => <SessionRow key={r.key} row={r} divider={i < attention.length - 1} showState />)}</Card>
            )}
          </Section>

          {/* In progress */}
          <Section title="In progress" count={running.length} hint="Agents working. No action required.">
            {running.length === 0 ? (
              <EmptyRow text="No active runs." />
            ) : (
              <Card>{running.map((r, i) => <SessionRow key={r.key} row={r} divider={i < running.length - 1} />)}</Card>
            )}
          </Section>

          {/* Projects */}
          <Section title="Projects" count={projects.length} hint="">
            <Card>
              {projects.map((p, i) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  divider={i < projects.length - 1}
                  onOpen={() => onOpenProject(p.id)}
                  onOpenSession={(sid) => onOpenProjectSession(p.id, sid)}
                />
              ))}
            </Card>
          </Section>

          {/* Recent standalone sessions */}
          {recent.length > 0 && (
            <Section title="Recent sessions" count={recent.length} hint="Standalone sessions you've started recently.">
              <Card>
                {recent.map((s, i) => (
                  <SessionRow
                    key={s.id}
                    row={{
                      key: s.id, parentKind: "session", parentName: "Session", session: s,
                      onOpen: () => onOpenStandaloneSession(s.id),
                    }}
                    divider={i < recent.length - 1}
                    showState={needsAttention(s.status)}
                  />
                ))}
              </Card>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Sections / chrome ---------- */

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline gap-3">
        <h2 className="text-foreground">{title}</h2>
        {count !== undefined && <span className="font-mono text-[11px] text-muted-foreground">{count}</span>}
        {hint && <span className="font-mono text-[11px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-border bg-card">{children}</div>;
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/40 px-5 py-6 text-center text-[12.5px] text-muted-foreground">
      {text}
    </div>
  );
}

/* ---------- Prompt bar ---------- */

function PromptBar({ onSubmit }: { onSubmit: (prompt: string) => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onSubmit(v);
    setDraft("");
  };
  return (
    <div className="mt-5 flex items-center gap-2 rounded-md border border-border bg-input-background px-3 py-2 focus-within:border-border-strong">
      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="Start a new session from a prompt…"
        className="w-full bg-transparent text-[13px] placeholder:text-muted-foreground/70 focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={!draft.trim()}
        className="rounded-md border border-border bg-card px-3 py-1 font-mono text-[10.5px] text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start session
      </button>
    </div>
  );
}

/* ---------- Rows ---------- */

function SessionRow({ row, divider, showState = false }: { row: Row; divider: boolean; showState?: boolean }) {
  const s = row.session;
  return (
    <button
      onClick={row.onOpen}
      className={`group grid w-full grid-cols-[auto_1fr_auto_auto] items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40 ${
        divider ? "border-b border-border/60" : ""
      }`}
    >
      <span className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
        {row.parentKind === "session" ? (
          <><Zap className="h-2.5 w-2.5" />Session</>
        ) : (
          <><Folder className="h-2.5 w-2.5" />{row.parentName}</>
        )}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] text-foreground">{s.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
          {showState && (
            <>
              <SessionStateLabel status={s.status} withSpinner={false} />
              <span className="text-muted-foreground/40">·</span>
            </>
          )}
          <span className="flex items-center gap-1"><Cpu className="h-2.5 w-2.5" />{s.model}</span>
          {s.workspaces.slice(0, 2).map((w, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-muted-foreground/40">·</span>
              <GitBranch className="h-2.5 w-2.5" />{w.repo}
            </span>
          ))}
          {s.workspaces.length > 2 && (
            <span className="text-muted-foreground">+{s.workspaces.length - 2}</span>
          )}
          {(s.linkedPRs ?? []).slice(0, 1).map((lp, i) => (
            <span key={`pr${i}`} className="flex items-center gap-1">
              <span className="text-muted-foreground/40">·</span>
              <GitPullRequest className="h-2.5 w-2.5" />#{lp.number}
            </span>
          ))}
        </div>
      </div>
      <span className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
        {s.status === "running" ? <SessionStateIndicator status="running" size={12} /> : formatRelativeTime(s.createdAtMs)}
      </span>
      <ChevronRight className="mt-0.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function ProjectRow({ project, divider, onOpen, onOpenSession }: {
  project: Project; divider: boolean; onOpen: () => void; onOpenSession: (id: string) => void;
}) {
  const sessions = project.sessions;
  const attentionCount = sessions.filter((s) => needsAttention(s.status)).length;
  const runningCount = sessions.filter((s) => s.status === "running").length;

  return (
    <div className={divider ? "border-b border-border/60" : ""}>
      <button
        onClick={onOpen}
        className="group grid w-full grid-cols-[1fr_auto_auto] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40"
      >
        <div className="min-w-0">
          <div className="truncate text-[13.5px] text-foreground">{project.name}</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {sessions.length > 0 ? `last activity ${project.lastActivity}` : "no activity yet"}
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-3 font-mono text-[10.5px]">
          {attentionCount > 0 && (
            <span className="text-[var(--warning)]">{attentionCount} need you</span>
          )}
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <SessionStateIndicator status="running" size={10} />
              {runningCount} running
            </span>
          )}
          {attentionCount === 0 && runningCount === 0 && (
            <span className="text-muted-foreground/70">idle</span>
          )}
        </div>
        <ChevronRight className="mt-0.5 h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {/* Inline preview: a couple of attention-needed sessions for direct jump */}
      {attentionCount > 0 && (
        <div className="border-t border-border/40 bg-background/30 px-4 py-1.5">
          {sessions
            .filter((s) => needsAttention(s.status))
            .slice(0, 3)
            .map((s) => (
              <button
                key={s.id}
                onClick={(e) => { e.stopPropagation(); onOpenSession(s.id); }}
                className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-secondary/40"
              >
                <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{s.title}</span>
                <SessionStateLabel status={s.status} withSpinner={false} className="font-mono text-[10.5px]" />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
