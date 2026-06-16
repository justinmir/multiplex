import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";
import type { Session, SessionMsg } from "@app/core";
import { deriveSessionStatus } from "../../session/deriveStatus.js";
import { getSessionRuntime } from "../../session/runtime.js";

/** Apply derived status after a session upsert; patch + emit granular event if it changed. */
async function applyDerived(repo: JsonRepository, updated: Session): Promise<Session | null> {
  const derived = deriveSessionStatus(updated);
  if (derived !== updated.status) {
    const patched: Session = { ...updated, status: derived };
    await repo.upsertSession(patched, null);
    emit("session-status-changed", { sessionId: patched.id, status: derived });
    return patched;
  }
  return null;
}

/** Register session message + agent workflow IPC handlers (M3.4).
 * agents:start and agents:stop now delegate to the runtime when available,
 * falling back to the legacy stub behavior for backwards compatibility. */
export function registerSessionMessageHandlers(repo: JsonRepository) {
  // Persist a user/agent/tool message to a session's conversation
  handle("sessions:add-message", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    let updated: Session = { ...existing, messages: [...existing.messages, req.message] };
    await repo.upsertSession(updated, null);
    await applyDerived(repo, updated);

    emit("data:changed", { kind: "session" });
  });

  // Start agent execution — delegates to runtime or falls back to stub
  handle("agents:start", async (req) => {
    const runtime = getSessionRuntime();
    if (runtime) {
      // Find the session's prompt from the repo, then start via runtime
      const existing = await repo.getSession(req.sessionId);
      if (existing && existing.prompt) {
        await runtime.startSession({
          sessionId: req.sessionId,
          prompt: existing.prompt,
          model: existing.model,
        });
        return;
      }
    }

    // Legacy fallback — set status to running with stub response
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    let updated: Session = { ...existing, status: "running" };
    await repo.upsertSession(updated, null);
    await applyDerived(repo, updated);
    emit("data:changed", { kind: "session" });
  });

  // Stop agent execution — delegates to runtime or falls back to legacy behavior
  handle("agents:stop", async (req) => {
    const runtime = getSessionRuntime();
    if (runtime) {
      await runtime.stopSession(req.sessionId);
      return;
    }

    // Legacy fallback
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    let updated: Session = { ...existing, status: "completed" };
    await repo.upsertSession(updated, null);
    await applyDerived(repo, updated);

    emit("data:changed", { kind: "session" });
  });
}
