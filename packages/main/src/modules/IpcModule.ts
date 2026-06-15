import type { AppModule } from "../AppModule.js";
import type { ModuleContext } from "../ModuleContext.js";
import { handle } from "../ipc/router.js";
import { JsonRepository } from "../repo/JsonRepository.js";
import { registerRepoReadHandlers } from "../ipc/handlers/repo.js";
import { registerRepoWriteHandlers } from "../ipc/handlers/writes.js";
import { registerProjectWriteHandlers } from "../ipc/handlers/project-writes.js";
import { registerGitHubAuthHandlers } from "../ipc/handlers/github-auth.js";
import { registerGitHubHandlers } from "../ipc/handlers/github.js";
import { SyncService, setSyncService } from "../git/SyncService.js";
import { registerSyncHandlers } from "../ipc/handlers/sync.js";
import { registerSessionWriteHandlers } from "../ipc/handlers/session-writes.js";

export function createIpcModule(): AppModule {
  return {
    async enable(_ctx: ModuleContext) {
      // M0.4: app:ping handler
      handle("app:ping", (req) => ({ value: req.value, ts: Date.now() }));

      // M1.3: Repository read handlers — single JsonRepository instance wired via IPC
      const repo = new JsonRepository();
      registerRepoReadHandlers(repo);

      // M1.5: Repository write handlers (persist to disk)
      registerRepoWriteHandlers(repo);

      // M2.5: Project-level write handlers (create/update projects)
      registerProjectWriteHandlers(repo);

      // M2.2: GitHub OAuth + token management handlers
      registerGitHubAuthHandlers();

      // M2.3: GitHub API client (Octokit) — PRs, checks, reviews
      registerGitHubHandlers();

      // M2.4: Wire SyncService with repository instance and register sync handler
      const syncSvc = new SyncService(repo);
      setSyncService(syncSvc);
      registerSyncHandlers();

      // M3.1: Session CRUD handlers (create + status update)
      registerSessionWriteHandlers(repo);
    },
  };
}
