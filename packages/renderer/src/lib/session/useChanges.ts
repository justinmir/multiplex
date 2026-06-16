import { useCallback, useEffect, useState } from "react";
import type { FileChange, HarnessEvent } from "@app/core";
import { call, on } from "../ipc/client.js";

export interface RepoChanges {
  repo: string;
  files: FileChange[];
}

/**
 * Live file diffs for a session, grouped by repo (one entry per materialized
 * worktree). Refetches when the session emits a workspace/done event so a newly
 * touched repo or fresh edits appear without a manual refresh.
 */
export function useChanges(sessionId: string | null, enabled: boolean) {
  const [changes, setChanges] = useState<RepoChanges[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      setChanges(await call("session:changes", { sessionId }));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    refresh();
    const unsub = on(`session:${sessionId}:event`, (payload: unknown) => {
      const e = payload as HarnessEvent;
      if (e.type === "workspace" || e.type === "done" || e.type === "tool_result") {
        refresh();
      }
    });
    return () => unsub();
  }, [sessionId, enabled, refresh]);

  return { changes, loading, refresh };
}
