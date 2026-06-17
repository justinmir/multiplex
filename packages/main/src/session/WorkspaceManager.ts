import { existsSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { GitService, Workspace, FileChange } from "@app/core";
import type { RepoRegistry } from "../git/RepoRegistry.js";

/** Filesystem-safe segment from a repo identifier ("acme/ingest" → "acme__ingest"). */
function repoSlug(repoId: string): string {
  return repoId.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

/**
 * Owns a session's workspace root and the lazy materialization of per-repo
 * worktrees under it. Every session gets a root; worktrees appear only as repos
 * are declared (via the `open_repo` host tool) or pre-materialized for the
 * session's in-scope repos.
 */
export class WorkspaceManager {
  constructor(
    private readonly git: GitService,
    private readonly registry: RepoRegistry,
    private readonly baseDir: string,
  ) {}

  /** The workspace root for a session (created on demand). */
  rootFor(sessionId: string): string {
    return join(this.baseDir, sessionId);
  }

  /** Deterministic, shared-across-repos branch name for a session. */
  branchFor(sessionId: string): string {
    return `multiplex/${sessionId}`;
  }

  /** Identifiers of all repos in the catalog the agent may declare. */
  catalog(): string[] {
    return this.registry.list().map((r) => r.name);
  }

  /** Whether a repo identifier resolves to a registered repo. */
  resolves(repoId: string): boolean {
    return this.registry.resolve(repoId) != null;
  }

  ensureRoot(sessionId: string): string {
    const root = this.rootFor(sessionId);
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    return root;
  }

  /**
   * Materialize a worktree for `repoId` under the session root (idempotent).
   * Returns the new/existing Workspace, or an error string if the repo is
   * unknown. Does not persist — the caller records the Workspace on the session.
   */
  async openRepo(
    sessionId: string,
    repoId: string,
    existing: Workspace[],
  ): Promise<{ workspace?: Workspace; error?: string }> {
    const already = existing.find((w) => w.repo === repoId && w.worktree);
    if (already) return { workspace: already };

    const repo = this.registry.resolve(repoId);
    if (!repo) return { error: `Unknown repo "${repoId}" — register it in Settings first.` };

    const root = this.ensureRoot(sessionId);
    const worktreePath = join(root, repoSlug(repoId));
    const branch = this.branchFor(sessionId);

    if (existsSync(worktreePath)) {
      // Left over from a previous run — reuse it.
      return { workspace: { repo: repoId, branch, worktree: worktreePath } };
    }

    try {
      const base = await this.git.defaultBranch(repo.root);
      await this.git.createWorktree(repo.root, worktreePath, branch, base);
      return { workspace: { repo: repoId, branch, worktree: worktreePath } };
    } catch (err) {
      return { error: err instanceof Error ? err.message : `Failed to create worktree for ${repoId}` };
    }
  }

  /**
   * Files written directly into the session root (not inside a repo worktree) —
   * e.g. a standalone script when no repo is in scope. The root isn't a git
   * repo, so these are surfaced as "added" with their content so they still show
   * up in Changes. Worktree subdirs and harness/config files are excluded.
   */
  looseRootChanges(sessionId: string, workspaces: Workspace[]): { repo: string; files: FileChange[] } | null {
    const root = this.rootFor(sessionId);
    if (!existsSync(root)) return null;
    const worktreePaths = new Set(workspaces.map((w) => w.worktree).filter((p): p is string => !!p));
    const skip = new Set(["node_modules", "opencode.json"]);
    const files: FileChange[] = [];
    const MAX_FILES = 200;
    const MAX_BYTES = 64 * 1024;

    const walk = (dir: string, rel: string): void => {
      if (files.length >= MAX_FILES) return;
      let entries: Dirent[];
      try { entries = readdirSync(dir, { withFileTypes: true }) as Dirent[]; } catch { return; }
      for (const e of entries) {
        if (files.length >= MAX_FILES) break;
        if (e.name.startsWith(".") || skip.has(e.name)) continue;
        const abs = join(dir, e.name);
        if (worktreePaths.has(abs)) continue; // a repo worktree — handled by diffAll
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          walk(abs, relPath);
        } else if (e.isFile()) {
          let content: string;
          try {
            if (statSync(abs).size > MAX_BYTES) { content = "(file too large to preview)"; }
            else content = readFileSync(abs, "utf-8");
          } catch { continue; }
          if (content.includes("\u0000")) content = "(binary file)";
          const lines = content.split("\n");
          files.push({
            path: relPath,
            kind: "added",
            additions: lines.length,
            deletions: 0,
            hunk: lines.map((l) => `+${l}`).join("\n"),
          });
        }
      }
    };
    walk(root, "");
    return files.length > 0 ? { repo: "workspace", files } : null;
  }

  /** Diff every materialized worktree, grouped by repo. */
  async diffAll(workspaces: Workspace[]): Promise<Array<{ repo: string; files: FileChange[] }>> {
    const out: Array<{ repo: string; files: FileChange[] }> = [];
    for (const ws of workspaces) {
      if (!ws.worktree) continue;
      const files = (await this.git.diff(ws.worktree)) as FileChange[];
      out.push({ repo: ws.repo, files });
    }
    return out;
  }

  /** Which materialized worktrees actually have changes (drives PR fan-out). */
  async changedWorkspaces(workspaces: Workspace[]): Promise<Workspace[]> {
    const changed: Workspace[] = [];
    for (const ws of workspaces) {
      if (ws.worktree && (await this.git.hasChanges(ws.worktree))) changed.push(ws);
    }
    return changed;
  }

  /** Remove all worktrees for a session and delete its root. */
  async cleanup(sessionId: string, workspaces: Workspace[]): Promise<void> {
    for (const ws of workspaces) {
      if (ws.worktree) {
        try { await this.git.removeWorktree(ws.worktree); } catch { /* best effort */ }
      }
    }
    try { rmSync(this.rootFor(sessionId), { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
