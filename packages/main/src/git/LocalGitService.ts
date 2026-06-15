import { spawnSync } from "node:child_process";
import type { CommitInfo, GitService, LocalBranch, RepoStatus } from "@app/core";

/** Run a git command synchronously. Returns stdout string or empty on error. */
function runGit(dir: string, ...args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf-8" as const,
    timeout: 10_000, // 10s timeout per command
    maxBuffer: 1024 * 512, // 512KB output cap
  });

  return {
    ok: result.status === 0 && !result.error,
    stdout: result.stdout || "",
    stderr: (result.stderr || "").slice(0, 500),
  };
}

/** Check if a directory is a valid git repository. */
function isGitDir(dir: string): boolean {
  return runGit(dir, "rev-parse", "--git-dir").ok;
}

export class LocalGitService implements GitService {

  async getBranches(dir: string): Promise<LocalBranch[]> {
    if (!isGitDir(dir)) return [];

    // Resolve the current HEAD branch name. symbolic-ref fails when HEAD is detached,
    // in which case we use "" so no branch will be marked as isHead.
    const headResult = runGit(dir, "symbolic-ref", "--short", "HEAD");
    const headBranch = headResult.ok ? headResult.stdout.trim() : "";

    // List all local branches with their commit SHAs
    const result = runGit(dir, "branch", "-v", "--no-color");
    if (!result.ok) return [];

    const branches: LocalBranch[] = [];
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip detached HEAD marker lines like "(HEAD detached at abc1234)"
      if (trimmed.startsWith("(")) continue;

      // After .trim() the leading whitespace is gone, so use \s* (zero or more) between
      // optional "*" and the branch name.  Format examples:
      //   "* main  abc123  Message"     (HEAD branch, trimmed to "* main ...")
      //   "feature/xyz  def789  Message" (non-HEAD, trimmed removes leading spaces)
      const match = trimmed.match(/^(\*?)\s*(\S+)\s+([a-f0-9]+)\s+(.*)$/);
      if (match) {
        branches.push({
          name: match[2],
          commitSha: match[3],
          isHead: headBranch === match[2],
        });
      }
    }

    return branches;
  }

  async getStatus(dir: string): Promise<RepoStatus> {
    if (!isGitDir(dir)) return { staged: 0, unstaged: 0, clean: true };

    // Count staged files (index vs HEAD)
    const stagedResult = runGit(dir, "diff", "--staged", "--name-only");
    const stagedFiles = stagedResult.stdout.trim().split("\n").filter(Boolean);

    // Count unstaged files only (working dir vs index).
    // Using `git status --porcelain` would include staged entries too, double-counting
    // any file that has both staged and unstaged changes.
    const unstagedResult = runGit(dir, "diff", "--name-only");
    const unstagedFiles = unstagedResult.stdout.trim().split("\n").filter(Boolean);

    return {
      staged: stagedFiles.length,
      unstaged: unstagedFiles.length,
      clean: stagedFiles.length === 0 && unstagedFiles.length === 0,
    };
  }

  async getLastCommit(dir: string, branch?: string): Promise<CommitInfo | null> {
    if (!isGitDir(dir)) return null;

    const ref = branch || "HEAD";

    // Get commit info using --format with delimiters
    const format = "%H%n%h%n%s%n%an%n%ai";
    const result = runGit(dir, "log", "-1", `--format=${format}`, ref);
    if (!result.ok) return null;

    const lines = result.stdout.trim().split("\n");
    if (lines.length < 5) return null;

    return {
      sha: lines[0],
      shortSha: lines[1],
      message: lines[2],
      authorName: lines[3],
      date: lines[4],
    };
  }
}

/** Default singleton instance. */
export const gitService = new LocalGitService();
