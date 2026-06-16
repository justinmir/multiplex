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

  for (const pr of prs) {
    // Only consider open/review/draft PRs — skip merged/closed
    if (!["open", "review", "draft"].includes(pr.status)) continue;

    // 2. Checks failing (danger — needs immediate fix)
    const hasFailingChecks =
      pr.checkRuns?.some((c) => c.status === "failure") || pr.checks.failed > 0;
    if (hasFailingChecks) return "checks_failing";

    // 3. Changes requested on review
    const hasChangesRequested =
      pr.reviewVerdict === "changes_requested" ||
      pr.comments?.some((c) => !c.resolved && c.verdict === "changes_requested");
    if (hasChangesRequested) return "changes_requested";

    // 4. Review pending
    if (pr.reviewVerdict === "pending") {
      const hasAnyApproved = prs.some(
        (p) =>
          p.id !== pr.id &&
          ["open", "review", "draft"].includes(p.status) &&
          p.reviewVerdict === "approved",
      );
      if (!hasAnyApproved) return "review_pending";
    }

    // 5. Mergeable — approved + clean + all checks green/skipped, no pending
    const allChecksGreen =
      pr.checkRuns?.every((c) => c.status === "success" || c.status === "skipped") ?? true;
    const noPendingChecks = !pr.checkRuns?.some((c) => c.status === "pending") && pr.checks.pending === 0;
    if (
      pr.mergeable === "clean" &&
      pr.reviewVerdict === "approved" &&
      allChecksGreen &&
      noPendingChecks
    ) {
      return "mergeable";
    }
  }

  // Check for merged PRs
  const hasMerged = prs.some((pr) => pr.status === "merged");
  if (hasMerged) return "merged";

  // Fall back to harness-driven status (running, completed, failed, idle)
  return session.status;
}
