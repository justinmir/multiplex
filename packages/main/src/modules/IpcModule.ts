import type { AppModule } from "../AppModule.js";
import type { ModuleContext } from "../ModuleContext.js";
import type { Repository } from "@app/core";
import { handle } from "../ipc/router.js";
import { JsonRepository } from "../repo/JsonRepository.js";
import { registerRepoReadHandlers } from "../ipc/handlers/repo.js";
import { registerAnalyticsHandlers } from "../ipc/handlers/analytics.js";
import { setTokenRepo } from "../analytics/tokenTracker.js";
import { registerRepoWriteHandlers } from "../ipc/handlers/writes.js";
import { registerProjectWriteHandlers } from "../ipc/handlers/project-writes.js";
import { registerGitHubAuthHandlers } from "../ipc/handlers/github-auth.js";
import { registerGitHubHandlers } from "../ipc/handlers/github.js";
import { SyncService, setSyncService } from "../git/SyncService.js";
import { registerSyncHandlers } from "../ipc/handlers/sync.js";
import { registerSessionWriteHandlers } from "../ipc/handlers/session-writes.js";
import { registerAppHandlers } from "../ipc/handlers/app.js";
import { registerSettingsHandlers } from "../ipc/handlers/settings.js";
import { registerRepoHandlers } from "../ipc/handlers/repos.js";
import { registerSearchHandlers } from "../ipc/handlers/search.js";
import { registerIntelligenceHandlers } from "../ipc/handlers/intelligence.js";
import { OpencodeIntelligence } from "../intelligence/OpencodeIntelligence.js";
import { IntelligenceService } from "../intelligence/IntelligenceService.js";
import { setIntelligenceService } from "../intelligence/service.js";
import { registerChangesHandlers } from "../ipc/handlers/changes.js";
import { registerPrHandlers } from "../ipc/handlers/pr.js";
import { WorkspaceManager } from "../session/WorkspaceManager.js";
import { gitService } from "../git/LocalGitService.js";
import { repoRegistry } from "../git/RepoRegistry.js";
import { githubForge } from "../forge/GitHubForgeService.js";
import { PrPoller } from "../forge/PrPoller.js";
import { configStore } from "../git/ConfigStore.js";
import { sessionsDir } from "../repo/paths.js";
import { SessionRuntime } from "../session/SessionRuntime.js";
import { setSessionRuntime } from "../session/runtime.js";
import { registerSessionRuntimeHandlers } from "../ipc/handlers/session.js";
import { getAppSettings } from "../settings/AppSettings.js";
import { emit } from "../ipc/emit.js";
import { registerBuiltInHarnesses } from "../harness/index.js";

export function createIpcModule(): AppModule {
  return {
    async enable(_ctx: ModuleContext) {
      // app:ping handler
      handle("app:ping", (req) => ({ value: req.value, ts: Date.now() }));

      // Repository — select the persistence backend. SQLite is
      // opt-in (Settings or MULTIPLEX_DB=sqlite); the module (and its native
      // dependency) is only loaded when chosen, so the default JSON path and
      // boot never touch better-sqlite3.
      const settings = getAppSettings();
      const backend = process.env.MULTIPLEX_DB ?? settings.get().repoBackend ?? "json";
      let repo: Repository;
      if (backend === "sqlite") {
        try {
          const { SqliteRepository } = await import("../repo/SqliteRepository.js");
          const { SQLITE_PATH, DB_PATH } = await import("../repo/paths.js");
          repo = new SqliteRepository(SQLITE_PATH, DB_PATH);
          console.log("[IpcModule] using SQLite repository");
        } catch (err) {
          console.error("[IpcModule] SQLite backend failed to load, falling back to JSON:", err);
          repo = new JsonRepository();
        }
      } else {
        repo = new JsonRepository();
      }
      registerRepoReadHandlers(repo);
      setTokenRepo(repo); // route token-usage events to the repo
      registerAnalyticsHandlers(repo);

      // Repository write handlers (persist to disk)
      registerRepoWriteHandlers(repo);

      // Project-level write handlers (create/update projects)
      registerProjectWriteHandlers(repo);

      // GitHub OAuth + token management handlers
      registerGitHubAuthHandlers();

      // GitHub API client (Octokit) — PRs, checks, reviews
      registerGitHubHandlers();

      // Wire SyncService with repository instance and register sync handler
      const syncSvc = new SyncService(repo);
      setSyncService(syncSvc);
      registerSyncHandlers();

      // Session CRUD handlers (create + status update)
      registerSessionWriteHandlers(repo);

      // Register built-in harnesses and create the session runtime
      registerBuiltInHarnesses();
      const workspaceManager = new WorkspaceManager(gitService, repoRegistry, sessionsDir());
      const runtime = new SessionRuntime(
        repo,
        () => settings.get(),
        emit,
        workspaceManager,
        { forge: githubForge, git: gitService },
      );
      setSessionRuntime(runtime);
      registerSessionRuntimeHandlers(runtime);

      // Real diffs across a session's materialized worktrees
      registerChangesHandlers(runtime);

      // live PR detail, PR actions, and PR fan-out.
      // A background poller keeps PR detail cached so switching sessions never
      // blocks on GitHub; pr:get reads the cache and a manual sync forces a
      // refresh. Open, non-merged PRs are refreshed on an interval with
      // per-PR exponential backoff.
      const prPoller = new PrPoller(
        repo,
        githubForge,
        emit,
        () => configStore.isGitHubConnected(),
        () => (settings.get().prPollIntervalMinutes ?? 5) * 60_000,
      );
      prPoller.start();
      registerPrHandlers(githubForge, runtime, prPoller);

      // Recover sessions left in "running" state from a previous crash
      (async () => {
        try {
          const recovered = await runtime.recoverStaleSessions();
          if (recovered.length > 0) {
            console.log(`Recovered ${recovered.length} stale session(s):`, recovered);
          }
        } catch (err) {
          console.error("Failed to recover stale sessions:", err);
        }
      })();

      // Application-level handlers (open URL in system browser)
      registerAppHandlers();

      // Settings surface (consolidate) — harness, tokens, repos, intelligence
      registerSettingsHandlers();

      // Repo catalog (registry of available repos the agent may declare)
      registerRepoHandlers();

      // Global search over real projects, sessions, and PRs
      registerSearchHandlers(repo);

      // Project intelligence via opencode
      const intelligence = new IntelligenceService(
        repo,
        new OpencodeIntelligence(() => settings.get().defaultModel),
        () => settings.get(),
        emit,
      );
      setIntelligenceService(intelligence);
      registerIntelligenceHandlers(intelligence);
      intelligence.startDaily();
    },
  };
}
