import type { CheckRun, FileChange, PullRequest, ReviewComment } from "@app/core";

/** Map a GitHub PR file (pulls.listFiles) to a domain FileChange. */
export function mapFile(f: {
  filename: string;
  previous_filename?: string;
  additions?: number;
  deletions?: number;
  status: string;
  patch?: string;
}): FileChange {
  const kind: FileChange["kind"] =
    f.status === "added" ? "added"
    : f.status === "removed" ? "deleted"
    : f.status === "renamed" ? "renamed"
    : "modified";
  return {
    path: f.filename,
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
    hunk: f.patch ?? "",
    kind,
  };
}

/** Map a GitHub review (pulls.listReviews) verdict to our ReviewComment. */
export function mapReview(r: {
  id: number;
  user: { login: string } | null;
  state: string;
  body: string;
  submitted_at?: string | null;
}): ReviewComment {
  const verdict: ReviewComment["verdict"] =
    r.state === "APPROVED" ? "approved"
    : r.state === "CHANGES_REQUESTED" ? "changes_requested"
    : "commented";
  return {
    id: `review_${r.id}`,
    author: r.user?.login ?? "unknown",
    kind: "review",
    verdict,
    body: r.body || (verdict === "approved" ? "Approved" : verdict === "changes_requested" ? "Requested changes" : "Commented"),
    ts: r.submitted_at ? new Date(r.submitted_at).toISOString() : new Date().toISOString(),
  };
}

/** Map an inline review comment (pulls.listReviewComments) to our ReviewComment. */
export function mapInlineComment(c: {
  id: number;
  user: { login: string } | null;
  body: string;
  path?: string;
  line?: number | null;
  created_at: string;
}): ReviewComment {
  return {
    id: `inline_${c.id}`,
    author: c.user?.login ?? "unknown",
    kind: "inline",
    body: c.body,
    path: c.path,
    line: c.line ?? undefined,
    ts: new Date(c.created_at).toISOString(),
  };
}

/** Map an issue-level comment (issues.listComments) to a general ReviewComment. */
export function mapIssueComment(c: {
  id: number;
  user: { login: string } | null;
  body?: string;
  created_at: string;
}): ReviewComment {
  return {
    id: `comment_${c.id}`,
    author: c.user?.login ?? "unknown",
    kind: "general",
    body: c.body ?? "",
    ts: new Date(c.created_at).toISOString(),
  };
}

/** Minimal shape of a GitHub REST API PR object (from pulls.list response). */
type GitHubPR = {
  number: number;
  title: string;
  head: { ref: string; repo?: { full_name: string } };
  base: { ref: string; repo: { full_name: string } };
  state: string;
  draft?: boolean;
  merged?: boolean;
  user: { login: string };
  additions?: number;
  deletions?: number;
  updated_at: string;
  mergeable?: true | false | null;
};

/** Map a GitHub REST API PR object to our domain PullRequest type. */
export function mapPullRequest(pr: GitHubPR): PullRequest {
  const repoName = pr.base.repo?.full_name || "unknown/repo";

  // Determine status from GitHub fields
  let status: PullRequest["status"];
  if (pr.merged) {
    status = "merged";
  } else if (pr.draft) {
    status = "draft";
  } else if (pr.state === "closed") {
    status = "closed";
  } else {
    status = "open";
  }

  // Map mergeable state
  const mergeable: PullRequest["mergeable"] =
    pr.mergeable === true ? "clean" : pr.mergeable === false ? "conflict" : undefined;

  return {
    id: `gh_${repoName}_${pr.number}`,
    number: pr.number,
    title: pr.title,
    repo: repoName,
    branch: pr.head.ref,
    baseBranch: pr.base.ref,
    status,
    mergeable,
    author: pr.user.login,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    updatedAt: new Date(pr.updated_at).toISOString(),
    checks: { passed: 0, failed: 0, pending: 0 }, // Populated separately from check runs API
  };
}

/** Minimal shape of a GitHub Check Run object (from checks.listForRef response). */
type GitHubCheckRun = {
  id: number;
  name: string;
  status: "completed" | "pending" | "in_progress" | "queued" | "waiting" | "requested";
  conclusion?:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "timed_out"
    | "skipped"
    | "action_required"
    | null;
  started_at?: string | null;
  completed_at?: string | null;
};

/** Map a GitHub Check Run object to our domain CheckRun type. */
export function mapCheckRun(cr: GitHubCheckRun): CheckRun {
  // Map GitHub check status to our simpler status type
  let status: CheckRun["status"];
  if (cr.conclusion === "success") {
    status = "success";
  } else if (cr.conclusion === "failure" || cr.conclusion === "action_required") {
    status = "failure";
  } else if (
    cr.conclusion === "skipped" ||
    cr.conclusion === "cancelled" ||
    cr.conclusion === "timed_out"
  ) {
    status = "skipped";
  } else if (cr.status === "in_progress" || cr.status === "queued") {
    status = "pending";
  } else {
    // Covers: pending, waiting, requested, completed without conclusion
    status = "pending";
  }

  // Calculate duration if both timestamps present (handle null values from Octokit types)
  let durationSec: number | undefined;
  if (cr.started_at && cr.completed_at) {
    const start = new Date(cr.started_at).getTime();
    const end = new Date(cr.completed_at).getTime();
    durationSec = Math.round((end - start) / 1000);
  }

  return {
    id: `check_${cr.id}`,
    name: cr.name,
    status,
    conclusion: cr.conclusion || undefined,
    durationSec,
  };
}
