import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";
import type { Session, SessionMsg } from "@app/core";

/** Register session message + agent workflow IPC handlers (M3.4). */
export function registerSessionMessageHandlers(repo: JsonRepository) {
  // Persist a user/agent/tool message to a session's conversation
  handle("sessions:add-message", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    const updated: Session = { ...existing, messages: [...existing.messages, req.message] };
    await repo.upsertSession(updated, null);

    emit("data:changed", { kind: "session" });
  });

  // Start simulated agent execution — sets status to running, then simulates a response
  handle("agents:start", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    // Transition to running
    let updated: Session = { ...existing, status: "running" };
    await repo.upsertSession(updated, null);
    emit("data:changed", { kind: "session" });

    // Simulate agent response after delay (STUB — real agent integration replaces this)
    setTimeout(async () => {
      const current = await repo.getSession(req.sessionId);
      if (!current || current.status === "completed") return;

      const agentMsg: SessionMsg = {
        role: "agent",
        content: "Processing your request...",
        ts: new Date().toISOString(),
      };

      updated = { ...current, messages: [...current.messages, agentMsg], status: "completed" };
      await repo.upsertSession(updated, null);
      emit("data:changed", { kind: "session" });
    }, 1500);
  });

  // Stop agent execution — marks session as completed
  handle("agents:stop", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    const updated: Session = { ...existing, status: "completed" };
    await repo.upsertSession(updated, null);

    emit("data:changed", { kind: "session" });
  });
}
