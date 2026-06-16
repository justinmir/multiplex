import type { ActivityItem, PullRequest, Project } from "@app/core";
import type { Repository } from "@app/core";
import { configStore } from "./ConfigStore.js";
import { githubClient } from "./GitHubClient.js";

/** 
 * SyncService fetches real GitHub PR data for project repos and merges into local store.
 */
export class SyncService {
  readonly #repo: Repository;
  
  constructor(repo: Repository) {
    this.#repo = repo;
  }

  /** 
   * Sync a single project's PRs from its configured repos.
   * Returns the updated project or null if not found.
   */
  async syncProject(projectId: string): Promise<Project | null> {
    const project = await this.#repo.getProject(projectId);
    if (!project) return null;

    // Collect all PRs from each configured repo  
    const allPRs: PullRequest[] = [];
    
    for (const repoSlug of project.repos) {
      const parts = repoSlug.split("/");
      if (parts.length !== 2) continue;
      
      const [owner, name] = parts;
      try {
        const prs = await githubClient.listPRs(owner, name);
        allPRs.push(...prs);
        
        // Also fetch check runs for each PR's branch
        for (const pr of prs) {
          if (pr.branch) {
            const checks = await githubClient.getCheckRuns(owner, name, pr.branch);
            // Update the checks summary on the PR
            pr.checks = {
              passed: checks.filter(c => c.status === "success").length,
              failed: checks.filter(c => c.status === "failure").length,
              pending: checks.filter(c => c.status === "pending" || c.status === "skipped").length,
            };
          }
        }
      } catch (err) {
        console.error(`SyncService: failed to sync repo ${repoSlug}:`, err);
        // Continue with other repos on error
      }
    }

    // Merge fetched PRs into project — replace existing PR list
    const updatedProject = { 
      ...project, 
      prs: allPRs,
      updatedAt: new Date().toISOString(),
    };

    // Persist the updated project back to repository
    await this.#repo.upsertProject(updatedProject);

    // Append activity item for the sync event
    const hasToken = configStore.isGitHubConnected();
    if (hasToken) {
      const activity: ActivityItem = {
        id: `sync_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        kind: "summary",
        text: `Synced ${allPRs.length} open PR(s) from ${project.repos.join(", ")}`,
        ts: new Date().toISOString(),
      };
      await this.#repo.appendActivity(projectId, activity);
    } else {
      // Note that sync was attempted but no GitHub token configured
      const activity: ActivityItem = {
        id: `sync_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        kind: "summary",
        text: "Sync attempted — connect GitHub to fetch PR data",
        ts: new Date().toISOString(),
      };
      await this.#repo.appendActivity(projectId, activity);
    }

    // Return the fresh copy from repository (with derived fields already applied by read handler)
    return updatedProject;
  }
}

/** Default singleton instance — wired via IpcModule. */
export let syncService: SyncService | null = null;

/** Set the active sync service instance. Called during module init. */
export function setSyncService(instance: SyncService): void {
  syncService = instance;
}
