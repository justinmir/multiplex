import { handle } from "../router.js";
import type { SessionRuntime } from "../../session/SessionRuntime.js";
import type { HarnessConfig } from "@app/core";
import { createHarness } from "@app/core";

/** Register session runtime IPC handlers (M-A4). */
export function registerSessionRuntimeHandlers(runtime: SessionRuntime) {
  handle("session:start", async (req) => {
    return runtime.startSession({
      sessionId: req.sessionId,
      prompt: req.prompt,
      projectId: req.projectId ?? null,
      model: req.model,
    });
  });

  handle("session:send", async (req) => {
    return runtime.sendMessage(req.sessionId, req.message);
  });

  handle("session:stop", async (req) => {
    return runtime.stopSession(req.sessionId);
  });

  handle("session:edit-prompt", async (req) => {
    return runtime.editLastPrompt(req.sessionId, req.prompt);
  });

  handle("session:queue:interrupt", async (req) => {
    return runtime.interruptQueued(req.sessionId, req.index);
  });

  handle("session:queue:remove", async (req) => {
    return runtime.removeQueued(req.sessionId, req.index);
  });

  // M-A8 — harness health check
  handle("harness:health", async (req) => {
    const harness = createHarness({ id: req.harnessId } as HarnessConfig);
    if (!harness) {
      return { ok: false, detail: `No harness registered for "${req.harnessId}"` };
    }
    return harness.health();
  });

  // M-A8 — list models for a given harness
  handle("harness:models", async (req) => {
    const harness = createHarness({ id: req.harnessId } as HarnessConfig);
    if (!harness) return [];
    return harness.listModels();
  });
}
