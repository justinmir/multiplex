import { handle } from "../router.js";
import type { SessionRuntime } from "../../session/SessionRuntime.js";
import type { HarnessConfig } from "@app/core";
import { createHarness } from "@app/core";

/**
 * Harness health/models come from spawning the harness binary (e.g. `opencode
 * --version` / `opencode models`), which is slow. They're global per harness
 * and change rarely, but the renderer re-queries them on every session view, so
 * cache per harnessId with a TTL and de-dupe concurrent calls. This keeps
 * session switching instant instead of re-spawning the binary each time.
 */
const HARNESS_INFO_TTL_MS = 5 * 60_000;

interface CacheSlot<T> { value?: T; ts: number; inflight?: Promise<T>; }

function memoize<T>(
  store: Map<string, CacheSlot<T>>,
  key: string,
  accept: (value: T) => boolean,
  produce: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const slot = store.get(key);
  if (slot?.value !== undefined && now - slot.ts < HARNESS_INFO_TTL_MS) return Promise.resolve(slot.value);
  if (slot?.inflight) return slot.inflight;
  const inflight = produce()
    .then((value) => {
      // Only cache "good" results so a transient failure (binary missing,
      // not yet authenticated) is retried on the next call rather than stuck.
      if (accept(value)) store.set(key, { value, ts: Date.now() });
      else store.delete(key);
      return value;
    })
    .catch((err) => { store.delete(key); throw err; });
  store.set(key, { ts: now, inflight });
  return inflight;
}

type HealthResult = { ok: boolean; version?: string; detail?: string };
type ModelsResult = Array<{ id: string; label?: string; provider?: string }>;
const healthCache = new Map<string, CacheSlot<HealthResult>>();
const modelsCache = new Map<string, CacheSlot<ModelsResult>>();

/** Register session runtime IPC handlers. */
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

  // harness health check (cached per harnessId; see memoize above)
  handle("harness:health", async (req) => {
    return memoize(healthCache, req.harnessId, (v) => v.ok, async () => {
      const harness = createHarness({ id: req.harnessId } as HarnessConfig);
      if (!harness) return { ok: false, detail: `No harness registered for "${req.harnessId}"` };
      return harness.health();
    });
  });

  // list models for a given harness (cached per harnessId)
  handle("harness:models", async (req) => {
    return memoize(modelsCache, req.harnessId, (v) => v.length > 0, async () => {
      const harness = createHarness({ id: req.harnessId } as HarnessConfig);
      if (!harness) return [];
      return harness.listModels();
    });
  });
}
