import type { AppModule } from "../AppModule.js";
import type { ModuleContext } from "../ModuleContext.js";
import { handle } from "../ipc/router.js";
import { JsonRepository } from "../repo/JsonRepository.js";
import { registerRepoReadHandlers } from "../ipc/handlers/repo.js";
import { registerRepoWriteHandlers } from "../ipc/handlers/writes.js";

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
    },
  };
}
