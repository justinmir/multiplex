/** A local branch in a git worktree. */
export interface LocalBranch {
  /** Branch name (e.g. "main", "feature/xyz") */
  name: string;
  /** Short commit SHA at tip of this branch */
  commitSha: string;
  /** True if this is the currently checked-out HEAD branch */
  isHead: boolean;
}

/** Working tree status for a git directory. */
export interface RepoStatus {
  /** Number of staged file changes */
  staged: number;
  /** Number of unstaged (working dir) file changes */
  unstaged: number;
  /** True when both staged and unstaged are 0 */
  clean: boolean;
}

/** Minimal commit info for the latest commit on a branch. */
export interface CommitInfo {
  /** Full 40-char SHA */
  sha: string;
  /** Abbreviated 7-char SHA */
  shortSha: string;
  /** First line of commit message */
  message: string;
  /** Author display name */
  authorName: string;
  /** ISO date string */
  date: string;
}

/** A single file's change, mirrors domain.FileChange (kept structural to avoid a cycle). */
export interface GitFileChange {
  path: string;
  additions: number;
  deletions: number;
  hunk: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

/** Service interface for local git worktree state + worktree management. */
export interface GitService {
  /** List all local branches in the given directory. Returns empty array if not a git dir. */
  getBranches(dir: string): Promise<LocalBranch[]>;

  /** Get working tree status (staged/unstaged change counts). Returns clean=true for non-git dirs. */
  getStatus(dir: string): Promise<RepoStatus>;

  /** Get the latest commit on a branch (or HEAD if no branch specified). Returns null if not a git dir or branch doesn't exist. */
  getLastCommit(dir: string, branch?: string): Promise<CommitInfo | null>;

  // ---- worktree management ----

  /** Create a worktree at `worktreePath` on a new `branch` off `baseBranch`
   *  (defaults to the repo's default branch). Returns the worktree path. */
  createWorktree(repoRoot: string, worktreePath: string, branch: string, baseBranch?: string): Promise<{ worktreePath: string }>;

  /** Remove a worktree (force) and prune the admin records. */
  removeWorktree(worktreePath: string): Promise<void>;

  /** Diff the worktree against HEAD (tracked + untracked), as FileChange[]. */
  diff(worktreePath: string): Promise<GitFileChange[]>;

  /** Current checked-out branch of a worktree ("" if detached). */
  currentBranch(worktreePath: string): Promise<string>;

  /** Resolve a sane base branch for new session branches (origin/HEAD → main → master → current). */
  defaultBranch(repoRoot: string): Promise<string>;

  /** True if the worktree has any tracked or untracked changes. */
  hasChanges(worktreePath: string): Promise<boolean>;

  /** List local branch names in a repo. */
  listBranches(repoRoot: string): Promise<string[]>;
}
