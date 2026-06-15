import type { AppModule } from "../AppModule.js";
import type { ModuleContext } from "../ModuleContext.js";
import { handle } from "../ipc/router.js";

export function createIpcModule(): AppModule {
  return {
    async enable(_ctx: ModuleContext) {
      // Register all IPC handlers here.
      // Each phase adds new handlers; this is the single registration point.

      // M0.4: app:ping handler
      handle("app:ping", (req) => ({ value: req.value, ts: Date.now() }));
    },
  };
}
