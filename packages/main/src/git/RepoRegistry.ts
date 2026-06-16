import { basename } from "node:path";
import { getAppSettings } from "../settings/AppSettings.js";
import { git } from "./exec.js";

export interface RegisteredRepo {
  name: string;
  root: string;
}

/**
 * The catalog of local repos the agent may draw from. Repos are registered once
 * in Settings (persisted as `settings.repoRoots`); a session's agent later
 * *declares* one and a worktree is materialized. This is NOT a per-session picker.
 *
 * Identifier convention: a repo is referenced by `Workspace.repo` /
 * `Project.repos[]` strings, which look like `owner/name` (e.g. "acme/ingest").
 * We resolve an identifier to a root by matching, in order: exact registered
 * `name`, the identifier's last path segment ("ingest"), or the root's basename.
 */
export class RepoRegistry {
  list(): RegisteredRepo[] {
    return getAppSettings().get().repoRoots ?? [];
  }

  /** Validate `root` is a git repo, then persist it under `name` (default: basename). */
  async add(root: string, name?: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    const check = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    if (!check.ok || check.stdout.trim() !== "true") {
      return { ok: false, error: `Not a git repository: ${root}` };
    }
    const repoName = (name?.trim() || basename(root.replace(/\/+$/, ""))) || root;
    const settings = getAppSettings();
    const existing = settings.get().repoRoots ?? [];
    if (existing.some((r) => r.name === repoName)) {
      return { ok: false, error: `A repo named "${repoName}" is already registered` };
    }
    settings.set({ repoRoots: [...existing, { name: repoName, root }] });
    return { ok: true, name: repoName };
  }

  remove(name: string): void {
    const settings = getAppSettings();
    const existing = settings.get().repoRoots ?? [];
    settings.set({ repoRoots: existing.filter((r) => r.name !== name) });
  }

  /** Resolve a repo identifier to its local root, or null if not registered. */
  resolve(identifier: string): RegisteredRepo | null {
    const repos = this.list();
    const last = identifier.split("/").pop() ?? identifier;
    return (
      repos.find((r) => r.name === identifier) ??
      repos.find((r) => r.name === last) ??
      repos.find((r) => basename(r.root.replace(/\/+$/, "")) === last) ??
      null
    );
  }
}

export const repoRegistry = new RepoRegistry();
