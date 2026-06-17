export type ProjectStatus = "active" | "paused" | "shipped";
export type PRStatus = "open" | "draft" | "merged" | "review" | "closed";
export type SessionStatus =
  | "running"
  | "awaiting_input"
  | "review_pending"
  | "changes_requested"
  | "mergeable_comments"
  | "mergeable"
  | "checks_failing"
  | "merged"
  | "completed"
  | "failed"
  | "idle";

export type ReferenceKind = "pr" | "doc" | "link" | "meeting" | "todo" | "issue";

export interface Reference {
  id: string;
  kind: ReferenceKind;
  title: string;
  source?: string;       // e.g. "github.com/acme/ingest#312", "Notion", "Linear"
  url?: string;
  summary?: string;      // one-line agent-extracted summary
  addedAt: string;
  addedBy?: string;
  /**
   * Internal representation of the reference's content, pulled once via the
   * harness (with web/MCP tools enabled) so project intelligence can reuse it
   * without re-fetching the resource on every synthesis.
   */
  indexedContent?: string;
  /** When the reference was last indexed (epoch ms). Drives "Last Indexed". */
  indexedAtMs?: number;
  /** Clear, user-facing error when the harness couldn't access the resource. */
  indexError?: string;
}

/** One token-usage data point, for per-session and application-wide analytics. */
export interface TokenUsageEvent {
  ts: number;                      // epoch ms
  source: "session" | "app";
  sessionId?: string;              // set when source === "session"
  operation?: string;             // set when source === "app" (e.g. "title", "synthesis")
  tokens: number;
  costUsd: number;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  hunk: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

export interface ReviewComment {
  id: string;
  author: string;
  kind: "review" | "inline" | "general";
  verdict?: "approved" | "changes_requested" | "commented";
  body: string;
  path?: string;
  line?: number;
  ts: string;
  resolved?: boolean;
  replies?: { author: string; body: string; ts: string }[];
}

export interface CheckRun {
  id: string;
  name: string;
  status: "success" | "failure" | "pending" | "skipped";
  durationSec?: number;
  conclusion?: string;
  workflow?: string;
  detail?: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  repo: string;
  branch: string;
  baseBranch?: string;
  status: PRStatus;
  mergeable?: "clean" | "blocked" | "conflict" | "behind";
  reviewVerdict?: "pending" | "approved" | "changes_requested";
  author: string;
  additions: number;
  deletions: number;
  updatedAt: string;
  checks: { passed: number; failed: number; pending: number };
  files?: FileChange[];
  comments?: ReviewComment[];
  checkRuns?: CheckRun[];
}

export interface Workspace {
  repo: string;
  branch: string;
  worktree?: string;
}

export interface SessionMsg {
  role: "user" | "agent" | "tool" | "thinking";
  content: string;
  ts: string;
  /**
   * Present when role === "tool": the agentic tool call this message represents.
   * `content` carries the tool's result/output (empty while running).
   */
  tool?: {
    name: string;
    input?: unknown;
    callId: string;
    status: "running" | "ok" | "error";
  };
}

export interface Session {
  id: string;
  title: string;
  /** The original prompt that initiated the session. */
  prompt?: string;
  status: SessionStatus;
  model: string;
  /** All repos/branches this session is working across. */
  workspaces: Workspace[];
  /** Full PR objects opened by this session — signals drive derived status. */
  linkedPRs?: PullRequest[];
  startedAt: string;
  createdAtMs: number;
  archived?: boolean;
  /** Pinned sessions sort to the top of the sidebar, independent of age. */
  pinned?: boolean;
  durationMin: number;
  tokens: number;
  cost: number;
  messages: SessionMsg[];
  /** Messages queued while a turn is in progress; drained one at a time (FIFO)
   *  by the runtime, including for background sessions and across restarts. */
  queuedMessages?: string[];
  /** The git branch this session's worktrees use (a short, human-readable name
   *  derived from the prompt). Decided once, on first worktree creation. */
  branch?: string;
  /** Optional per-session references the agent should consult. */
  references?: Reference[];
}

export interface Note {
  id: string;
  title: string;
  body: string;
  author: string;
  updatedAt: string;
  tags: string[];
}

export interface ActivityItem {
  id: string;
  kind: "pr" | "session" | "note" | "summary" | "ref";
  text: string;
  ts: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  /** Projects can span multiple repos. */
  repos: string[];
  status: ProjectStatus;
  color: string;
  progress: number;
  openPRs: number;
  activeSessions: number;
  lastActivity: string;
  prs: PullRequest[];
  sessions: Session[];
  notes: Note[];
  references: Reference[];
  activity: ActivityItem[];
  summary: string;
  nextSteps: string[];
  /** Epoch ms when summary/nextSteps were last LLM-synthesized (M5.3). */
  summarySynthesizedAtMs?: number;
  /** 4 actionable session prompts generated during synthesis. */
  suggestedPrompts?: string[];
  /** A ready-to-run session prompt for each next step (aligned by index). */
  nextStepPrompts?: string[];
}

export type SessionWindow = "last_24h" | "last_7d" | "last_30d" | "older" | "archived";

const min = 60_000, hr = 3_600_000, day = 86_400_000;

export function bucketForSession(s: Session, now: number = Date.now()): SessionWindow {
  if (s.archived) return "archived";
  const d = now - s.createdAtMs;
  if (d <= day) return "last_24h";
  if (d <= 7 * day) return "last_7d";
  if (d <= 30 * day) return "last_30d";
  return "older";
}

export const sessionWindowLabels: Record<SessionWindow, string> = {
  last_24h: "Last 24 hours",
  last_7d: "Last 7 days",
  last_30d: "Last 30 days",
  older: "Older",
  archived: "Archived",
};
