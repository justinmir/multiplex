import { useState } from "react";
import {
  ArrowLeft, Send, GitBranch, Cpu, Square, Sparkles, Paperclip, Wrench, User, Bot,
  GitPullRequest, GitMerge, Coins, Clock, MessageSquare, FileCode, CheckCircle2, XCircle,
  CircleDashed, ExternalLink, Reply, ThumbsUp, AlertTriangle, ChevronDown, ChevronRight,
  Eye, BookOpen, Plus, PanelRightClose, PanelRightOpen, LayoutGrid, Folder,
} from "lucide-react";
import { Session, PullRequest, ReviewComment, CheckRun, Reference, Workspace } from "../data/mockData";
import { SessionStateIndicator, SessionStateLabel, sessionStateInfo } from "./SessionStateBadge";
import { ReferenceRow } from "./tabs/ReferencesTab";

interface Props {
  /** Optional parent project name. When set, shows a small breadcrumb above the title. */
  projectName?: string;
  /** Breadcrumb label for the back button (e.g. "All sessions", "Home") */
  backLabel?: string;
  session: Session | null;
  prs?: PullRequest[];
  references?: Reference[];
  onAddReference?: (r: Reference) => void;
  /** Called when the "Start session" button is pressed on the new-session page. */
  onStartSession?: (prompt: string) => void;
  /** Called when user sends a message in an existing session. Receives the message text. */
  onSendMessage?: (message: string) => void;
  /** Called when user clicks the Stop button while agent is running. */
  onStopAgent?: () => void;
  onClose: () => void;
  starterPrompts?: string[];
}

type RailTab = "overview" | "changes" | "reviews" | "checks" | "references";

export function SessionDetail({
  projectName, backLabel = "Back", session, prs = [], references = [],
  onAddReference, onStartSession, onSendMessage, onStopAgent, onClose, starterPrompts,
}: Props) {
  const hasPRs = prs.length > 0;

  const allFiles = prs.flatMap((p) => (p.files ?? []).map((f) => ({ ...f, _prNumber: p.number, _repo: p.repo })));
  const allComments = prs.flatMap((p) => (p.comments ?? []).map((c) => ({ ...c, _prNumber: p.number, _repo: p.repo })));
  const allRuns = prs.flatMap((p) => (p.checkRuns ?? []).map((r) => ({ ...r, _prNumber: p.number, _repo: p.repo })));

  const anyFailing = allRuns.some((r) => r.status === "failure");
  const anyChangesRequested = prs.some((p) => p.reviewVerdict === "changes_requested");

  // Default rail tab picks what needs attention
  const initialRailTab: RailTab =
    !session ? "overview"
    : anyChangesRequested ? "reviews"
    : anyFailing ? "checks"
    : "overview";

  const [railOpen, setRailOpen] = useState<boolean>(!!session);
  const [railTab, setRailTab] = useState<RailTab>(initialRailTab);
  const [draft, setDraft] = useState("");

  const railTabs: { id: RailTab; label: string; icon: any; count?: number; tone?: string }[] = [
    { id: "overview", label: "Overview", icon: LayoutGrid, count: prs.length || undefined },
    { id: "changes", label: "Changes", icon: FileCode, count: allFiles.length || undefined },
    { id: "reviews", label: "Reviews", icon: Eye, count: allComments.length || undefined,
      tone: anyChangesRequested ? "text-destructive" : prs.length > 0 && prs.every((p) => p.reviewVerdict === "approved") ? "text-[var(--success)]" : undefined },
    { id: "checks", label: "Checks", icon: CheckCircle2, count: allRuns.length || undefined,
      tone: anyFailing ? "text-destructive" : undefined },
    { id: "references", label: "References", icon: BookOpen, count: references.length || undefined },
  ];

  const openRailAt = (id: RailTab) => {
    setRailTab(id);
    setRailOpen(true);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </button>
        <span className="text-muted-foreground/40">/</span>
        {projectName && (
          <>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <Folder className="h-3 w-3" />
              {projectName}
            </span>
            <span className="text-muted-foreground/40">/</span>
          </>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] text-foreground">
            {session?.title ?? "New session"}
          </span>
          {session && sessionStateInfo[session.status].tone !== "neutral" && (
            <SessionStateLabel status={session.status} withSpinner={false} className="font-mono text-[10.5px] uppercase tracking-[0.1em]" />
          )}
        </div>

        {session && (
          <div className="ml-auto flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{session.model}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{session.durationMin}m</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="flex items-center gap-1"><Coins className="h-3 w-3" />{(session.tokens / 1000).toFixed(1)}k · ${session.cost.toFixed(2)}</span>
            {session.status === "running" && (
              <>
                <span className="ml-1"><SessionStateIndicator status="running" size={14} /></span>
                <button onClick={onStopAgent} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground hover:bg-secondary">
                  <Square className="h-3 w-3" /> Stop
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Body: conversation + right rail */}
      <div className="flex min-h-0 flex-1">
        {/* Conversation column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            {!session ? (
              <NewSessionPane projectName={projectName} starterPrompts={starterPrompts} draft={draft} setDraft={setDraft} />
            ) : (
              <ConversationPane session={session} />
            )}
          </div>
          <Composer
            session={session}
            draft={draft}
            setDraft={setDraft}
            onSend={() => {
              const v = draft.trim();
              if (!v) return;
              // For new sessions, delegate to onStartSession
              if (!session) {
                onStartSession?.(v);
              } else {
                // For existing sessions, send message text up to parent
                onSendMessage?.(v);
              }
              setDraft("");
            }}
          />
        </div>

        {/* Right rail */}
        {session && (railOpen ? (
          <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-card/30">
            <div className="flex items-center gap-1 border-b border-border px-1 py-1">
              {railTabs.map((t) => {
                const Icon = t.icon;
                const active = railTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setRailTab(t.id)}
                    className={`relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors ${
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                    title={t.label}
                  >
                    <Icon className={`h-3.5 w-3.5 ${t.tone ?? ""}`} />
                    <span className="hidden lg:inline">{t.label}</span>
                    {t.count !== undefined && (
                      <span className={`font-mono text-[10px] ${t.tone ?? "text-muted-foreground/70"}`}>{t.count}</span>
                    )}
                  </button>
                );
              })}
              <button
                onClick={() => setRailOpen(false)}
                className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                title="Collapse panel"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {railTab === "overview" && <OverviewRail session={session} prs={prs} />}
              {railTab === "changes" && <ChangesRail files={allFiles} totalAdds={prs.reduce((s, p) => s + p.additions, 0)} totalDels={prs.reduce((s, p) => s + p.deletions, 0)} multiPR={prs.length > 1} />}
              {railTab === "reviews" && <ReviewsRail comments={allComments} multiPR={prs.length > 1} />}
              {railTab === "checks" && <ChecksRail runs={allRuns} multiPR={prs.length > 1} />}
              {railTab === "references" && <ReferencesRail references={references} onAdd={onAddReference} />}
            </div>
          </aside>
        ) : (
          <aside className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border bg-card/30 py-2">
            <button
              onClick={() => setRailOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Expand panel"
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
            </button>
            <div className="my-1 h-px w-5 bg-border" />
            {railTabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => openRailAt(t.id)}
                  className="relative rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title={t.label}
                >
                  <Icon className={`h-3.5 w-3.5 ${t.tone ?? ""}`} />
                  {t.count !== undefined && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-secondary px-1 font-mono text-[8.5px] text-foreground ring-1 ring-border">
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </aside>
        ))}
      </div>
    </div>
  );
}

/* ---------- Right-rail panes ---------- */

function OverviewRail({ session, prs }: { session: Session; prs: PullRequest[] }) {
  return (
    <div className="space-y-4 px-4 py-4">
      {/* Workspaces */}
      <RailBlock title="Workspaces" count={session.workspaces.length}>
        {session.workspaces.length === 0 ? (
          <EmptyLine text="No workspaces yet." />
        ) : (
          <ul className="space-y-1">
            {session.workspaces.map((w: Workspace, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[11.5px]">
                <GitBranch className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">{w.repo}</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-foreground">{w.branch}</span>
              </li>
            ))}
          </ul>
        )}
      </RailBlock>

      {/* Linked PRs */}
      <RailBlock title="Pull requests" count={prs.length}>
        {prs.length === 0 ? (
          <EmptyLine text="No PRs opened yet." />
        ) : (
          <ul className="space-y-2">
            {prs.map((pr) => <PRSummaryCard key={pr.id} pr={pr} />)}
          </ul>
        )}
      </RailBlock>

      {/* Meta */}
      <RailBlock title="Run">
        <dl className="grid grid-cols-2 gap-y-1.5 font-mono text-[11px]">
          <Meta k="model" v={session.model} />
          <Meta k="duration" v={`${session.durationMin}m`} />
          <Meta k="tokens" v={`${(session.tokens / 1000).toFixed(1)}k`} />
          <Meta k="cost" v={`$${session.cost.toFixed(2)}`} />
          <Meta k="started" v={session.startedAt} />
        </dl>
      </RailBlock>
    </div>
  );
}

function PRSummaryCard({ pr }: { pr: PullRequest }) {
  const checksFailing = (pr.checkRuns ?? []).some((c) => c.status === "failure") || pr.checks.failed > 0;
  const checksPending = (pr.checkRuns ?? []).some((c) => c.status === "pending") || pr.checks.pending > 0;
  const verdict = pr.reviewVerdict ?? "pending";
  const canMerge = pr.mergeable === "clean" && verdict === "approved" && !checksFailing && !checksPending && pr.status !== "merged";

  return (
    <li className="overflow-hidden rounded-md border border-border bg-card">
      <div className="px-3 pt-2.5">
        <div className="flex items-start gap-2">
          <GitPullRequest className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 font-mono text-[10.5px] text-muted-foreground">
              <span>{pr.repo}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-foreground">#{pr.number}</span>
            </div>
            <div className="text-[12.5px] text-foreground">{pr.title}</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
              {pr.branch} → {pr.baseBranch ?? "main"}
            </div>
          </div>
          <span className="font-mono text-[10.5px]">
            <span className="text-[var(--success)]">+{pr.additions}</span>{" "}
            <span className="text-destructive">−{pr.deletions}</span>
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2">
        <VerdictPill verdict={verdict} />
        <CheckSummary pr={pr} />
        <button className="ml-auto rounded-md border border-border p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Open on GitHub">
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          disabled={!canMerge}
          className={`flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] ${
            canMerge ? "bg-[var(--success)] text-[#0c0d10] hover:opacity-90" : "cursor-not-allowed bg-secondary text-muted-foreground"
          }`}
        >
          <GitMerge className="h-3 w-3" />
          {pr.status === "merged" ? "Merged" : canMerge ? "Merge" : "Blocked"}
        </button>
      </div>
    </li>
  );
}

function VerdictPill({ verdict }: { verdict: "pending" | "approved" | "changes_requested" }) {
  const meta = verdict === "approved"
    ? { label: "Approved", icon: ThumbsUp, color: "text-[var(--success)]", chip: "bg-[var(--success)]/10 ring-[var(--success)]/30" }
    : verdict === "changes_requested"
      ? { label: "Changes requested", icon: AlertTriangle, color: "text-destructive", chip: "bg-destructive/10 ring-destructive/30" }
      : { label: "Awaiting review", icon: Eye, color: "text-muted-foreground", chip: "bg-secondary ring-border" };
  const Icon = meta.icon;
  return (
    <span className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ring-1 ${meta.chip} ${meta.color}`}>
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

function CheckSummary({ pr }: { pr: PullRequest }) {
  const { failed, pending, passed } = pr.checks;
  if (failed > 0) return (
    <span className="flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] text-destructive ring-1 ring-destructive/30">
      <XCircle className="h-2.5 w-2.5" /> {failed} failing
    </span>
  );
  if (pending > 0) return (
    <span className="flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border">
      <CircleDashed className="h-2.5 w-2.5 animate-spin" /> {pending} pending
    </span>
  );
  return (
    <span className="flex items-center gap-1 rounded-md bg-[var(--success)]/10 px-1.5 py-0.5 font-mono text-[10px] text-[var(--success)] ring-1 ring-[var(--success)]/30">
      <CheckCircle2 className="h-2.5 w-2.5" /> {passed} passed
    </span>
  );
}

/* ---------- Conversation ---------- */

function ConversationPane({ session }: { session: Session }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      {session.prompt && (
        <div className="rounded-md border border-border bg-card px-3.5 py-2.5">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Original prompt</div>
          <p className="text-[13px] text-foreground">{session.prompt}</p>
        </div>
      )}
      {session.messages.map((m, i) => (
        <Message key={i} role={m.role} content={m.content} ts={m.ts} />
      ))}
      {session.status === "running" && (
        <div className="flex items-center gap-2 pl-9 font-mono text-[11px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
          agent is thinking…
        </div>
      )}
    </div>
  );
}

function Message({ role, content, ts }: { role: "user" | "agent" | "tool"; content: string; ts: string }) {
  if (role === "tool") {
    return (
      <div className="rounded-md border border-border bg-secondary/40 px-3.5 py-2.5">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <Wrench className="h-3 w-3" /> tool output
          <span className="ml-auto normal-case tracking-normal">{ts}</span>
        </div>
        <pre className="whitespace-pre-wrap font-mono text-[12px] text-foreground/80">{content}</pre>
      </div>
    );
  }
  const meta = role === "user"
    ? { Icon: User, label: "you", tone: "bg-secondary text-foreground" }
    : { Icon: Bot, label: "agent", tone: "bg-secondary text-foreground" };
  const Icon = meta.Icon;
  return (
    <div className="flex items-start gap-3">
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${meta.tone}`}>
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
          <span>{meta.label}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{ts}</span>
        </div>
        <p className="text-[13.5px] leading-relaxed text-foreground">{content}</p>
      </div>
    </div>
  );
}

/* ---------- Changes rail ---------- */

interface FileWithMeta {
  path: string; additions: number; deletions: number; hunk: string; kind: "added" | "modified" | "deleted" | "renamed";
  _prNumber: number; _repo: string;
}

function ChangesRail({ files, totalAdds, totalDels, multiPR }: { files: FileWithMeta[]; totalAdds: number; totalDels: number; multiPR: boolean }) {
  if (files.length === 0) return <RailEmpty text="No file changes yet." />;
  const groups: { label: string; items: FileWithMeta[] }[] = multiPR
    ? Array.from(new Set(files.map((f) => f._repo))).map((repo) => ({
        label: repo, items: files.filter((f) => f._repo === repo),
      }))
    : [{ label: "", items: files }];
  return (
    <div className="space-y-3 px-3 py-3">
      <div className="px-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
        {files.length} files · <span className="text-[var(--success)]">+{totalAdds}</span> <span className="text-destructive">−{totalDels}</span>
      </div>
      {groups.map((g) => (
        <div key={g.label || "all"} className="space-y-1.5">
          {g.label && (
            <div className="flex items-center gap-1.5 px-1 font-mono text-[10.5px] text-muted-foreground">
              <GitBranch className="h-3 w-3" /> {g.label}
            </div>
          )}
          {g.items.map((f) => <FileCard key={`${f._repo}:${f.path}`} file={f} />)}
        </div>
      ))}
    </div>
  );
}

function FileCard({ file }: { file: FileWithMeta }) {
  const [open, setOpen] = useState(false);
  const kindBadge =
    file.kind === "added" ? { label: "added", color: "text-[var(--success)] bg-[var(--success)]/10" }
    : file.kind === "deleted" ? { label: "deleted", color: "text-destructive bg-destructive/10" }
    : file.kind === "renamed" ? { label: "renamed", color: "text-muted-foreground bg-secondary" }
    : { label: "modified", color: "text-muted-foreground bg-secondary" };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-secondary/40">
        {open ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        <FileCode className="h-3 w-3 text-muted-foreground" />
        <span className="truncate font-mono text-[11.5px] text-foreground">{file.path}</span>
        <span className={`rounded-sm px-1 py-px font-mono text-[9.5px] uppercase tracking-[0.08em] ${kindBadge.color}`}>
          {kindBadge.label}
        </span>
        <span className="ml-auto font-mono text-[10px]">
          <span className="text-[var(--success)]">+{file.additions}</span>{" "}
          <span className="text-destructive">−{file.deletions}</span>
        </span>
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-border bg-background/40 px-3 py-2 font-mono text-[11px] leading-[1.5]">
          {file.hunk.split("\n").map((line, i) => {
            const cls =
              line.startsWith("+") ? "text-[var(--success)] bg-[var(--success)]/5" :
              line.startsWith("-") ? "text-destructive bg-destructive/5" :
              "text-foreground/70";
            return <div key={i} className={`-mx-3 px-3 ${cls}`}>{line || " "}</div>;
          })}
        </pre>
      )}
    </div>
  );
}

/* ---------- Reviews rail ---------- */

interface CommentWithMeta extends ReviewComment { _prNumber: number; _repo: string; }

function ReviewsRail({ comments, multiPR }: { comments: CommentWithMeta[]; multiPR: boolean }) {
  if (comments.length === 0) return <RailEmpty text="No review comments yet." />;
  const unresolved = comments.filter((c) => c.kind === "inline" && !c.resolved).length;
  return (
    <div className="space-y-2.5 px-3 py-3">
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          {comments.length} comments · {unresolved} unresolved
        </span>
        <button className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-secondary/80">
          Address all
        </button>
      </div>
      {comments.map((c) => <ReviewCommentCard key={c.id + c._prNumber} comment={c} multiPR={multiPR} />)}
    </div>
  );
}

function ReviewCommentCard({ comment, multiPR }: { comment: CommentWithMeta; multiPR: boolean }) {
  const [reply, setReply] = useState("");
  const isVerdict = comment.kind === "review" && comment.verdict;
  return (
    <article className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-2.5 py-1.5">
        <span className="text-[11.5px] text-foreground">{comment.author}</span>
        {isVerdict && <VerdictPill verdict={comment.verdict as any} />}
        {multiPR && (
          <span className="rounded-sm bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
            {comment._repo}#{comment._prNumber}
          </span>
        )}
        {comment.kind === "inline" && comment.path && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">{comment.path}:{comment.line}</span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{comment.ts}</span>
      </div>
      <div className="px-2.5 py-2 text-[12.5px] text-foreground">{comment.body}</div>

      {comment.replies && comment.replies.length > 0 && (
        <div className="space-y-1 border-t border-border/60 bg-background/40 px-2.5 py-2">
          {comment.replies.map((r, i) => (
            <div key={i} className="text-[12px]">
              <span className="font-mono text-[10px] text-muted-foreground">{r.author} · {r.ts}</span>
              <p className="text-foreground">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5 border-t border-border/60 px-2 py-1.5">
        <Reply className="h-3 w-3 text-muted-foreground" />
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply…"
          className="flex-1 bg-transparent text-[12px] placeholder:text-muted-foreground/70 focus:outline-none"
        />
        <button className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground">
          Ask agent
        </button>
        <button
          disabled={!reply.trim()}
          className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reply
        </button>
      </div>
    </article>
  );
}

/* ---------- Checks rail ---------- */

interface RunWithMeta extends CheckRun { _prNumber: number; _repo: string; }

function ChecksRail({ runs, multiPR }: { runs: RunWithMeta[]; multiPR: boolean }) {
  if (runs.length === 0) return <RailEmpty text="No checks." />;
  const failed = runs.filter((r) => r.status === "failure");
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex items-center justify-between px-1">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          {runs.length} checks · {failed.length > 0 ? `${failed.length} failing` : "healthy"}
        </span>
        <button className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-secondary/80">
          Re-run
        </button>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-card">
        {runs.map((c, i) => <CheckRow key={c.id + c._prNumber} run={c} divider={i < runs.length - 1} multiPR={multiPR} />)}
      </div>
    </div>
  );
}

function CheckRow({ run, divider, multiPR }: { run: RunWithMeta; divider: boolean; multiPR: boolean }) {
  const meta = run.status === "success" ? { Icon: CheckCircle2, color: "text-[var(--success)]" }
    : run.status === "failure" ? { Icon: XCircle, color: "text-destructive" }
    : run.status === "pending" ? { Icon: CircleDashed, color: "text-muted-foreground", spin: true }
    : { Icon: CircleDashed, color: "text-muted-foreground" };
  const Icon = meta.Icon;
  return (
    <div className={`flex items-start gap-2 px-2.5 py-1.5 ${divider ? "border-b border-border/60" : ""}`}>
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.color} ${"spin" in meta && meta.spin ? "animate-spin" : ""}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] text-foreground">{run.name}</span>
          {multiPR && (
            <span className="rounded-sm bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
              {run._repo}#{run._prNumber}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {run.durationSec ? `${Math.floor(run.durationSec / 60)}m${run.durationSec % 60}s` : "—"}
          </span>
        </div>
        {run.detail && (
          <p className="mt-0.5 font-mono text-[10.5px] text-destructive">{run.detail}</p>
        )}
      </div>
    </div>
  );
}

/* ---------- References rail ---------- */

function ReferencesRail({ references, onAdd }: { references: Reference[]; onAdd?: (r: Reference) => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const submit = () => {
    if (!title.trim()) return;
    onAdd?.({
      id: `ref_${Date.now().toString(36)}`,
      kind: url.includes("/pull/") ? "pr" : url ? "link" : "todo",
      title: title.trim(),
      url: url.trim() || undefined,
      addedAt: "just now",
      addedBy: "you",
    });
    setTitle(""); setUrl(""); setAdding(false);
  };
  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          <Sparkles className="h-3 w-3" /> indexed by agent
        </span>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-secondary/80"
          >
            <Plus className="inline h-2.5 w-2.5" /> Add
          </button>
        )}
      </div>
      {adding && (
        <div className="space-y-1.5 rounded-md border border-border bg-card p-2">
          <input
            autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-[12px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <input
            value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="URL (optional)"
            className="w-full bg-transparent font-mono text-[11px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setAdding(false)} className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-secondary">Cancel</button>
            <button onClick={submit} className="rounded-md bg-secondary px-2 py-0.5 font-mono text-[10px] text-foreground hover:bg-secondary/80">Add</button>
          </div>
        </div>
      )}
      {references.length === 0 ? (
        <RailEmpty text="No references on this session yet." />
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {references.map((r, i) => (
            <ReferenceRow key={r.id} reference={r} divider={i < references.length - 1} compact />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Shared bits ---------- */

function RailBlock({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 px-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>{title}</span>
        {count !== undefined && <span className="text-muted-foreground/60">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-foreground">{v}</dd>
    </>
  );
}

function RailEmpty({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-6 text-center text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <div className="text-[12px] text-muted-foreground">{text}</div>;
}

function NewSessionPane({ projectName, starterPrompts, draft, setDraft }: { projectName?: string; starterPrompts?: string[]; draft: string; setDraft: (v: string) => void }) {
  const prompts = starterPrompts ?? [
    "Investigate the failing check on PR #482",
    "Draft tests for the dedupe eviction policy",
    "Summarize open questions in notes into a kickoff doc",
    "Bisect the latency regression introduced in May",
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-8">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          {projectName ? `Start a session on ${projectName}` : "Start a new session"}
        </span>
      </div>
      <p className="font-display text-[28px] leading-[1.3] text-foreground">What should the agent work on?</p>
      <p className="text-[13.5px] text-muted-foreground">
        The agent will get the notes, references, and open PRs as context. It can span multiple repos and branches, and will open a draft PR in each one as needed.
      </p>
      <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
        {prompts.map((s) => (
          <button
            key={s} onClick={() => setDraft(s)}
            className="rounded-md border border-border bg-card px-3 py-2.5 text-left text-[12.5px] text-foreground hover:border-border-strong hover:bg-secondary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ session, draft, setDraft, onSend }: { session: Session | null; draft: string; setDraft: (v: string) => void; onSend?: () => void }) {
  return (
    <div className="border-t border-border bg-card/40 px-6 py-4">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-lg border border-border bg-input-background focus-within:border-border-strong">
          <textarea
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSend?.(); }}
            placeholder={session ? "Reply to the agent…" : "Describe the task. The agent will plan, code, and open PRs across the repos it needs."}
            rows={3}
            className="w-full resize-none bg-transparent px-3.5 py-3 text-[13.5px] placeholder:text-muted-foreground/70 focus:outline-none"
          />
          <div className="flex items-center gap-2 border-t border-border/60 px-2 py-2">
            <button className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Cpu className="h-3 w-3" /> claude-opus-4-7
            </button>
            <button className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <GitBranch className="h-3 w-3" /> repos & branches
            </button>
            <button className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <BookOpen className="h-3 w-3" /> add reference
            </button>
            <button className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Paperclip className="h-3 w-3" /> attach
            </button>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">⌘↵ to send</span>
            <button
              onClick={onSend}
              disabled={!draft.trim()}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1 text-[12px] text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              {session ? "Send" : "Start session"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
