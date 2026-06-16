import { useEffect } from "react";
import { on } from "../ipc/client.js";
import type { SessionStatus } from "@app/core";

/** Subscribe to session status change events for components that need fine-grained reactions. */
export function useSessionStatusChanged(
  sessionId: string | null,
  onChange: (status: SessionStatus) => void,
) {
  useEffect(() => {
    if (!sessionId) return;
    const unsub = on("session-status-changed", (payload) => {
      const evt = payload as { sessionId: string; status: SessionStatus };
      if (evt.sessionId === sessionId) {
        onChange(evt.status);
      }
    });
    return unsub;
  }, [sessionId, onChange]);
}

/** Subscribe to all data change events for components that need to react to any mutation. */
export function useDataChanged(onChange: () => void) {
  useEffect(() => {
    const unsub = on("data:changed", () => onChange());
    return unsub;
  }, [onChange]);
}
