import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import type { CommitInfo, GitFileChange, GitService, LocalBranch, RepoStatus } from "@app/core";
import { git, gitOrThrow } from "./exec.js";

/** Count +/- lines and extract the hunk body (from the first @@) of a unified diff. */
function parseUnifiedDiff(raw: string): { additions: number; deletions: number; hunk: string } {
  let additions = 0;
  let deletions = 0;
  const lines = raw.split("\n");
  for (const l of lines) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) additions++;
    else if (l.startsWith("-")) deletions++;
  }
  const at = raw.indexOf("@@");
  const hunk = at >= 0 ? raw.slice(at) : raw.trimEnd();
  return { additions, deletions, hunk };
}

/** Map a porcelain XY status code to a FileChange kind. */
function kindFromStatus(code: string): GitFileChange["kind"] {
  const c = code.trim();
  if (c === "??" || c.includes("A")) return "added";
  if (c.includes("D")) return "deleted";
  if (c.includes("R")) return "renamed";
  return "modified";
}

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

  // ---- worktree management ----

  async defaultBranch(repoRoot: string): Promise<string> {
    // Prefer origin/HEAD's target.
    const originHead = await git(repoRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (originHead.ok) {
      const name = originHead.stdout.trim().replace(/^origin\//, "");
      if (name) return name;
    }
    for (const candidate of ["main", "master"]) {
      const ref = await git(repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
      if (ref.ok) return candidate;
    }
    const head = await git(repoRoot, ["symbolic-ref", "--short", "HEAD"]);
    if (head.ok && head.stdout.trim()) return head.stdout.trim();
    return "main";
  }

  async createWorktree(
    repoRoot: string,
    worktreePath: string,
    branch: string,
    baseBranch?: string,
  ): Promise<{ worktreePath: string }> {
    const base = baseBranch ?? (await this.defaultBranch(repoRoot));
    await gitOrThrow(repoRoot, ["worktree", "add", "-b", branch, worktreePath, base]);
    return { worktreePath };
  }

  async removeWorktree(worktreePath: string): Promise<void> {
    // Resolve the main repo so `worktree remove` runs from a stable cwd.
    const commonDir = await git(worktreePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const repoRoot = commonDir.ok ? dirname(commonDir.stdout.trim()) : worktreePath;
    await git(repoRoot, ["worktree", "remove", "--force", worktreePath]);
    await git(repoRoot, ["worktree", "prune"]);
  }

  async currentBranch(worktreePath: string): Promise<string> {
    const res = await git(worktreePath, ["symbolic-ref", "--short", "HEAD"]);
    return res.ok ? res.stdout.trim() : "";
  }

  async hasChanges(worktreePath: string): Promise<boolean> {
    const res = await git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]);
    return res.ok && res.stdout.trim().length > 0;
  }

  async listBranches(repoRoot: string): Promise<string[]> {
    const res = await git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
    if (!res.ok) return [];
    return res.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async diff(worktreePath: string): Promise<GitFileChange[]> {
    const status = await git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
    if (!status.ok) return [];

    // -z output is NUL-separated; rename entries consume two records (new\0old).
    const records = status.stdout.split("\0").filter((r) => r.length > 0);
    const hasHead = (await git(worktreePath, ["rev-parse", "--verify", "HEAD"])).ok;
    const out: GitFileChange[] = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const code = rec.slice(0, 2);
      let path = rec.slice(3);
      const kind = kindFromStatus(code);
      if (kind === "renamed") {
        // The following record is the old path; skip it.
        i++;
      }

      const untracked = code === "??";
      let raw = "";
      if (untracked) {
        const d = await git(worktreePath, ["diff", "--no-color", "--no-index", "--", "/dev/null", path]);
        raw = d.stdout; // exits non-zero by design; stdout still holds the diff
      } else if (hasHead) {
        const d = await git(worktreePath, ["diff", "--no-color", "HEAD", "--", path]);
        raw = d.stdout;
      } else {
        const d = await git(worktreePath, ["diff", "--no-color", "--", path]);
        raw = d.stdout;
      }

      const { additions, deletions, hunk } = parseUnifiedDiff(raw);
      out.push({ path, additions, deletions, hunk, kind });
    }

    return out;
  }
}

/** Default singleton instance. */
export const gitService = new LocalGitService();
