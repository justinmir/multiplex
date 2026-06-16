import { Octokit } from "@octokit/rest";
import type { CheckRun, FileChange, ForgeService, OpenPRInput, PullRequest, ReviewComment } from "@app/core";
import { configStore } from "../git/ConfigStore.js";
import { mapPullRequest, mapCheckRun, mapFile, mapReview, mapInlineComment, mapIssueComment } from "../git/GitHubMapper.js";

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  return { owner, name: name ?? "" };
}

/** GitHub implementation of ForgeService (octokit). Auth from ConfigStore token. */
export class GitHubForgeService implements ForgeService {
  private octokit(): Octokit {
    const token = configStore.getGitHubToken();
    if (!token) throw new Error("GitHub is not connected — add a token in Settings.");
    return new Octokit({ auth: token });
  }

  async openDraftPR(p: OpenPRInput): Promise<PullRequest> {
    const { owner, name } = splitRepo(p.repo);
    const res = await this.octokit().pulls.create({
      owner, repo: name,
      title: p.title,
      head: p.head,
      base: p.base ?? "main",
      body: p.body,
      draft: p.draft ?? true,
    });
    return mapPullRequest(res.data as Parameters<typeof mapPullRequest>[0]);
  }

  async getPR(repo: string, number: number): Promise<PullRequest | null> {
    const { owner, name } = splitRepo(repo);
    try {
      const ok = this.octokit();
      const res = await ok.pulls.get({ owner, repo: name, pull_number: number });
      const base = mapPullRequest(res.data as Parameters<typeof mapPullRequest>[0]);
      const [files, comments, checkRuns] = await Promise.all([
        this.listPRFiles(repo, number),
        this.listReviewComments(repo, number),
        this.listCheckRuns(repo, number),
      ]);
      const checks = {
        passed: checkRuns.filter((c) => c.status === "success").length,
        failed: checkRuns.filter((c) => c.status === "failure").length,
        pending: checkRuns.filter((c) => c.status === "pending").length,
      };
      const verdict = comments
        .filter((c) => c.kind === "review" && c.verdict)
        .reduce<PullRequest["reviewVerdict"]>((acc, c) => {
          if (c.verdict === "changes_requested") return "changes_requested";
          if (c.verdict === "approved" && acc !== "changes_requested") return "approved";
          return acc;
        }, "pending");
      return { ...base, files, comments, checkRuns, checks, reviewVerdict: verdict };
    } catch (err) {
      console.error(`[forge] getPR ${repo}#${number} failed:`, err);
      return null;
    }
  }

  async listPRFiles(repo: string, number: number): Promise<FileChange[]> {
    const { owner, name } = splitRepo(repo);
    const res = await this.octokit().paginate(this.octokit().pulls.listFiles, {
      owner, repo: name, pull_number: number, per_page: 100,
    });
    return res.map((f) => mapFile(f as Parameters<typeof mapFile>[0]));
  }

  async listReviewComments(repo: string, number: number): Promise<ReviewComment[]> {
    const { owner, name } = splitRepo(repo);
    const ok = this.octokit();
    const [reviews, inline, issue] = await Promise.all([
      ok.paginate(ok.pulls.listReviews, { owner, repo: name, pull_number: number, per_page: 100 }),
      ok.paginate(ok.pulls.listReviewComments, { owner, repo: name, pull_number: number, per_page: 100 }),
      ok.paginate(ok.issues.listComments, { owner, repo: name, issue_number: number, per_page: 100 }),
    ]);
    return [
      ...reviews.filter((r) => r.state !== "PENDING").map((r) => mapReview(r as Parameters<typeof mapReview>[0])),
      ...inline.map((c) => mapInlineComment(c as Parameters<typeof mapInlineComment>[0])),
      ...issue.map((c) => mapIssueComment(c as Parameters<typeof mapIssueComment>[0])),
    ];
  }

  async listCheckRuns(repo: string, number: number): Promise<CheckRun[]> {
    const { owner, name } = splitRepo(repo);
    const ok = this.octokit();
    const pr = await ok.pulls.get({ owner, repo: name, pull_number: number });
    const ref = pr.data.head.sha;
    const res = await ok.checks.listForRef({ owner, repo: name, ref, per_page: 100 });
    return res.data.check_runs.map((cr) => mapCheckRun(cr as Parameters<typeof mapCheckRun>[0]));
  }

  async replyToComment(repo: string, number: number, commentId: string, body: string): Promise<void> {
    const { owner, name } = splitRepo(repo);
    const ok = this.octokit();
    // Inline review comments get a threaded reply; everything else posts a PR comment.
    const inlineId = commentId.startsWith("inline_") ? Number(commentId.slice("inline_".length)) : null;
    if (inlineId != null && !Number.isNaN(inlineId)) {
      await ok.pulls.createReplyForReviewComment({ owner, repo: name, pull_number: number, comment_id: inlineId, body });
    } else {
      await ok.issues.createComment({ owner, repo: name, issue_number: number, body });
    }
  }

  async rerunChecks(repo: string, number: number): Promise<void> {
    const { owner, name } = splitRepo(repo);
    const ok = this.octokit();
    const pr = await ok.pulls.get({ owner, repo: name, pull_number: number });
    const ref = pr.data.head.sha;
    const runs = await ok.checks.listForRef({ owner, repo: name, ref, per_page: 100 });
    await Promise.all(
      runs.data.check_runs.map((cr) =>
        ok.checks.rerequestRun({ owner, repo: name, check_run_id: cr.id }).catch(() => {}),
      ),
    );
  }

  async merge(repo: string, number: number): Promise<void> {
    const { owner, name } = splitRepo(repo);
    await this.octokit().pulls.merge({ owner, repo: name, pull_number: number });
  }
}

export const githubForge = new GitHubForgeService();
