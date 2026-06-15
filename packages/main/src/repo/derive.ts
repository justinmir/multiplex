import type { Project, SessionStatus, PRStatus } from "@app/core";

const activeSessionStatuses: SessionStatus[] = ["running", "awaiting_input"];
const openPrStatuses: PRStatus[] = ["open", "review", "draft"];

/** Recompute derived fields on a project from its real sessions and PRs. */
export function deriveProjectFields(p: Project): Project {
  const activeSessions = p.sessions.filter((s) =>
    activeSessionStatuses.includes(s.status),
  ).length;

  const openPRs = p.prs.filter((pr) => openPrStatuses.includes(pr.status)).length;

  // Compute lastActivity from the most recent session timestamp
  const latestTimestampMs = computeLatestTimestamp(p);
  const lastActivity = formatRelativeTime(latestTimestampMs);

  return { ...p, activeSessions, openPRs, lastActivity };
}

/** Find the most recent activity timestamp across all sessions in a project. */
function computeLatestTimestamp(project: Project): number {
  let latest = 0;
  for (const s of project.sessions) {
    if (s.createdAtMs > latest) latest = s.createdAtMs;
  }
  // Fall back to now if no sessions have timestamps — avoids negative relative time
  return latest || Date.now();
}

/** Convert an epoch-millisecond timestamp to a human-readable relative string. */
export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
