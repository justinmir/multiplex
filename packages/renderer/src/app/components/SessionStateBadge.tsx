import { Loader2 } from "lucide-react";
import { SessionStatus } from "../data/mockData";

export type StateTone = "danger" | "warning" | "success" | "neutral";

interface Info {
  label: string;
  tone: StateTone;
  /** show a rotating gray spinner alongside the label */
  spinning?: boolean;
  /** sort weight — higher = needs more attention */
  weight: number;
}

/**
 * State copy and tone for each session status.
 * Color is only applied for the three "needs attention" tones:
 *   danger  → checks failed, changes requested, failed
 *   warning → needs input, waiting for review
 *   success → ready to merge
 * Everything else (running, merged, completed, idle) is neutral.
 * Running additionally renders a rotating spinner to signal motion.
 */
export const sessionStateInfo: Record<SessionStatus, Info> = {
  running:            { label: "Running",            tone: "neutral", spinning: true, weight: 30 },
  awaiting_input:     { label: "Needs Input",        tone: "warning", weight: 100 },
  review_pending:     { label: "Waiting for Review", tone: "warning", weight: 60 },
  changes_requested:  { label: "Changes Requested",  tone: "danger",  weight: 85 },
  mergeable_comments: { label: "Ready to Merge",     tone: "success", weight: 80 },
  mergeable:          { label: "Ready to Merge",     tone: "success", weight: 80 },
  checks_failing:     { label: "Checks Failed",      tone: "danger",  weight: 95 },
  merged:             { label: "Merged",             tone: "neutral", weight: 10 },
  completed:          { label: "Completed",          tone: "neutral", weight: 5 },
  failed:             { label: "Failed",             tone: "danger",  weight: 88 },
  idle:               { label: "Idle",               tone: "neutral", weight: 20 },
};

const toneClass: Record<StateTone, string> = {
  danger:  "text-destructive",
  warning: "text-[var(--warning)]",
  success: "text-[var(--success)]",
  neutral: "text-muted-foreground",
};

export function sessionWeight(s: SessionStatus): number {
  return sessionStateInfo[s].weight;
}

export function stateToneClass(tone: StateTone): string {
  return toneClass[tone];
}

/** Tiny rotating spinner. Used in place of an indicator for "running". */
export function RunningSpinner({ className = "h-3 w-3" }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin text-muted-foreground`} />;
}

interface LineProps {
  status: SessionStatus;
  /** prepend a spinner when running (default true) */
  withSpinner?: boolean;
  className?: string;
}

/** Inline state label, colored only for needs-attention tones. */
export function SessionStateLabel({ status, withSpinner = true, className = "" }: LineProps) {
  const info = sessionStateInfo[status];
  return (
    <span className={`inline-flex items-center gap-1 ${toneClass[info.tone]} ${className}`}>
      {withSpinner && info.spinning && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      <span>{info.label}</span>
    </span>
  );
}

/**
 * Leading indicator for list rows.
 * - running:  rotating gray spinner (says "happening, no action needed")
 * - others:   nothing rendered (state is conveyed by the subtitle)
 */
export function SessionStateIndicator({ status, size = 12 }: { status: SessionStatus; size?: number }) {
  if (status === "running") {
    return <Loader2 style={{ width: size, height: size }} className="animate-spin text-muted-foreground" />;
  }
  return null;
}
