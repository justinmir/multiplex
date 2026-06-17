import { handle } from "../router.js";
import type { SessionRuntime } from "../../session/SessionRuntime.js";

/** Register the session:changes handler — real diffs across materialized worktrees. */
export function registerChangesHandlers(runtime: SessionRuntime) {
  handle("session:changes", async (req) => {
    return runtime.getSessionChanges(req.sessionId);
  });
}
