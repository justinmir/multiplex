import type { AppModule } from "../AppModule.js";
import type { ModuleContext } from "../ModuleContext.js";
import { getSessionRuntime } from "../session/runtime.js";

/** Gracefully shut down all active sessions before app quit. */
export function createShutdownModule(): AppModule {
  return {
    async enable({ app }: ModuleContext) {
      // Intercept before-quit to gracefully stop all sessions
      app.on("before-quit", async () => {
        const runtime = getSessionRuntime();
        if (runtime) {
          try {
            await runtime.shutdown();
          } catch { /* ignore shutdown errors — we're quitting anyway */ }
        }
      });

      // Also handle uncaught exceptions to prevent silent crashes
      process.on("uncaughtException", (err) => {
        console.error("[M-A7] Uncaught exception:", err.message);
        const runtime = getSessionRuntime();
        if (runtime) {
          try { runtime.disposeAll(); } catch { /* ignore */ }
        }
      });

      process.on("unhandledRejection", (reason) => {
        console.error("[M-A7] Unhandled rejection:", reason);
      });
    },
  };
}
