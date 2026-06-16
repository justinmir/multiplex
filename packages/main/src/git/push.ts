import { git } from "./exec.js";

/**
 * Push a worktree's branch to origin. Relies on the repo's existing origin and
 * push credentials (a credential helper or `gh` setup) — we don't inject tokens
 * into the remote URL here.
 */
export async function pushBranch(worktreePath: string, branch: string): Promise<void> {
  const res = await git(worktreePath, ["push", "-u", "origin", branch], 60_000);
  if (!res.ok) {
    throw new Error(`git push of ${branch} failed: ${res.stderr || `exit ${res.code}`}`);
  }
}
