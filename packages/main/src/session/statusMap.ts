import type { HarnessStatus, SessionStatus, HarnessEvent } from "@app/core";

/** Map harness internal status → our persisted session status. */
export const HARNESS_TO_SESSION_STATUS: Record<HarnessStatus, SessionStatus> = {
  starting: "running",
  running: "running",
  awaiting_input: "awaiting_input",
  completed: "completed",
  failed: "failed",
  stopped: "idle",
};

/** Derive session status from a harness event. Returns null if the event doesn't affect status. */
export function deriveSessionStatusFromEvent(event: HarnessEvent): SessionStatus | null {
  switch (event.type) {
    case "status":
      return HARNESS_TO_SESSION_STATUS[event.status] ?? "running";
    case "done":
      switch (event.reason) {
        case "completed": return "completed";
        case "failed": return "failed";
        case "stopped": return "idle";
      }
      return null;
    case "awaiting_input":
      return "awaiting_input";
    default:
      return null;
  }
}
