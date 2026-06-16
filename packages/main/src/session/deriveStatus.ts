import type { Session, SessionStatus } from "@app/core";

/**
 * Derive a session's status from PR review verdicts, check results,
 * mergeability, and awaiting-input signals.
 *
 * Precedence (highest → lowest):
 *  1. awaiting_input — harness signal always wins
 *  2. checks_failing — any failing CI/check run on open PRs
 *  3. changes_requested — review verdict or unresolved comment
 *  4. review_pending — pending review, no other PR approved yet
 *  5. mergeable — clean + approved + all checks green/skipped
 *  6. merged — any linked PR is already merged
 *  7. fallback — harness-driven status (running, completed, failed, idle)
 */
export function deriveSessionStatus(session: Session): SessionStatus {
  // 1. If agent is actively awaiting user input, that always wins
  if (session.status === "awaiting_input") return "awaiting_input";

  const prs = session.linkedPRs ?? [];
  const openPrs = prs.filter((pr) => ["open", "review", "draft"].includes(pr.status));

  // Aggregate across ALL open PRs at each priority level before returning.
  // This ensures strict precedence: a high-priority signal on any PR wins,
  // regardless of which PR is encountered first in the array.

  // 2. Checks failing — any failing CI/check run on ANY open PR (danger)
  if (openPrs.some(
    (pr) => pr.checkRuns?.some((c) => c.status === "failure") || pr.checks.failed > 0,
  )) {
    return "checks_failing";
  }

  // 3. Changes requested — review verdict or unresolved comment on ANY open PR
  if (openPrs.some(
    (pr) =>
      pr.reviewVerdict === "changes_requested" ||
      pr.comments?.some((c) => !c.resolved && c.verdict === "changes_requested"),
  )) {
    return "changes_requested";
  }

  // 4. Review pending — no PR is approved yet and all open PRs are pending or have no verdict
  const hasAnyApproved = openPrs.some((pr) => pr.reviewVerdict === "approved");
  if (!hasAnyApproved && openPrs.length > 0) {
    const allPendingOrNoVerdict = openPrs.every(
      (pr) => pr.reviewVerdict === "pending" || !pr.reviewVerdict,
    );
    if (allPendingOrNoVerdict) return "review_pending";
  }

  // 5. Mergeable — any PR that is approved + clean + all checks green/skipped, no pending
  const hasMergeable = openPrs.some((pr) => {
    const allChecksGreen =
      pr.checkRuns?.every((c) => c.status === "success" || c.status === "skipped") ?? true;
    const noPendingChecks =
      !pr.checkRuns?.some((c) => c.status === "pending") && pr.checks.pending === 0;
    return (
      pr.mergeable === "clean" &&
      pr.reviewVerdict === "approved" &&
      allChecksGreen &&
      noPendingChecks
    );
  });
  if (hasMergeable) return "mergeable";

  // Check for merged PRs
  const hasMerged = prs.some((pr) => pr.status === "merged");
  if (hasMerged) return "merged";

  // Fall back to harness-driven status (running, completed, failed, idle)
  return session.status;
}
