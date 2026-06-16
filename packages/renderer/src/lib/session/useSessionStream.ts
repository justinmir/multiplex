import { useEffect, useRef } from "react";
import type { HarnessEvent } from "@app/core";
import { on } from "../ipc/client.js";

/** Subscribe to live harness events for a specific session.
 * The callback receives raw HarnessEvent objects as they arrive from the main process. */
export function useSessionStream(
  sessionId: string | null,
  onEvent: (event: HarnessEvent) => void,
) {
  const cbRef = useRef<(event: HarnessEvent) => void>(onEvent);

  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!sessionId) return;
    const unsub = on(`session:${sessionId}:event`, (payload: unknown) => {
      cbRef.current(payload as HarnessEvent);
    });
    return () => {
      unsub();
    };
  }, [sessionId]);
}
