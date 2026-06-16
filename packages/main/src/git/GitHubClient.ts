import { Octokit } from "@octokit/rest";
import type { CheckRun as DomainCheckRun, PullRequest } from "@app/core";
import { configStore } from "./ConfigStore.js";
import { mapPullRequest, mapCheckRun } from "./GitHubMapper.js";

export class GitHubClient {
  #token: string | null = null;

  /** Get or create an authenticated Octokit instance. Returns null if no token configured. */
  getOctokit(): Octokit | null {
    const token = this.#token ?? configStore.getGitHubToken();
    if (!token) return null;
    this.#token = token;
    return new Octokit({ auth: token });
  }

  /** Fetch open PRs for a repository. Returns empty array if no token or repo not found. */
  async listPRs(owner: string, repo: string): Promise<PullRequest[]> {
    const octokit = this.getOctokit();
    if (!octokit) return [];

    try {
      const results: PullRequest[] = [];

      // Paginate through all open PRs (up to 100 per page, max ~5 pages for performance)
      let page = 1;
      const maxPages = 5;

      while (page <= maxPages) {
        const response = await octokit.pulls.list({
          owner,
          repo,
          state: "open",
          per_page: 100,
          page,
          sort: "updated",
          direction: "desc",
        });

        for (const pr of response.data) {
          // Octokit types are broader than our narrow mapper input; cast to match
          results.push(
            mapPullRequest(pr as Parameters<typeof mapPullRequest>[0]),
          );
        }

        // If we got fewer than requested, no more pages
        if (response.data.length < 100) break;
        page++;
      }

      return results;
    } catch (err) {
      console.error(`GitHubClient.listPRs failed for ${owner}/${repo}:`, err);
      return [];
    }
  }

  /** Fetch latest check runs for a branch. Returns empty array if no token or not found. */
  async getCheckRuns(owner: string, repo: string, branch: string): Promise<DomainCheckRun[]> {
    const octokit = this.getOctokit();
    if (!octokit) return [];

    try {
      // Get the latest commit SHA for this branch
      const refResponse = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      const commitSha = refResponse.data.object.sha;

      // Fetch check runs for that commit
      const checksResponse = await octokit.checks.listForRef({
        owner,
        repo,
        ref: commitSha,
      });

      // Octokit types are broader than our narrow mapper input; cast to match
      return checksResponse.data.check_runs.map((cr) =>
        mapCheckRun(cr as Parameters<typeof mapCheckRun>[0]),
      );
    } catch (err) {
      console.error(
        `GitHubClient.getCheckRuns failed for ${owner}/${repo}:${branch}:`,
        err,
      );
      return [];
    }
  }

  /** Merge a PR via Octokit. Returns true on success. */
  async mergePR(owner: string, repo: string, prNumber: number): Promise<boolean> {
    const octokit = this.getOctokit();
    if (!octokit) return false;

    try {
      await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
      });
      return true;
    } catch (err) {
      console.error(
        `GitHubClient.mergePR failed for ${owner}/${repo}#${prNumber}:`,
        err,
      );
      throw err; // Let renderer handle the error
    }
  }

  /** Fetch reviews for a specific PR. Returns verdict summary. */
  async getReviewVerdict(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<"approved" | "changes_requested" | "pending"> {
    const octokit = this.getOctokit();
    if (!octokit) return "pending";

    try {
      const response = await octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Find the latest review verdict (excluding submitted/dismissed)
      let verdict: "approved" | "changes_requested" | "pending" = "pending";

      for (const review of response.data) {
        if (review.state === "APPROVED") {
          verdict = "approved";
        } else if (review.state === "CHANGES_REQUESTED") {
          // Most recent REQUEST_CHANGES overrides approve
          verdict = "changes_requested";
        }
      }

      return verdict;
    } catch (err) {
      console.error(
        `GitHubClient.getReviewVerdict failed for ${owner}/${repo}#${prNumber}:`,
        err,
      );
      return "pending";
    }
  }
}

/** Default singleton instance. */
export const githubClient = new GitHubClient();
