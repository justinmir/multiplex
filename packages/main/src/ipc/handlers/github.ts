import { handle } from "../router.js";
import { githubClient } from "../../git/GitHubClient.js";

/** Register GitHub API IPC handlers. */
export function registerGitHubHandlers() {
  // List open PRs for a repository
  handle("prs:list", async (req) => {
    return githubClient.listPRs(req.owner, req.repo);
  });

  // Get check runs for a branch
  handle("checks:get", async (req) => {
    return githubClient.getCheckRuns(req.owner, req.repo, req.branch);
  });

  // Merge a PR via Octokit
  handle("prs:merge", async (req) => {
    const success = await githubClient.mergePR(req.owner, req.repo, req.prNumber);
    return { success };
  });
}
