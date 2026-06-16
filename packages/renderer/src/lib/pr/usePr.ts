import { useEffect, useState } from "react";
import type { PullRequest } from "@app/core";
import { call, on } from "../ipc/client.js";

/**
 * Enrich a session's linked PRs with live GitHub detail (files / comments /
 * checks). Falls back to the stored PR when the fetch returns nothing (e.g. no
 * token). Refetches when a `pr:<repo>#<n>:changed` event fires.
 */
export function usePrDetails(linkedPRs: PullRequest[], enabled: boolean): PullRequest[] {
  const [detailed, setDetailed] = useState<PullRequest[]>(linkedPRs);
  // Stable key of the linked PRs so the effect only re-subscribes when they change.
  const key = linkedPRs.map((p) => `${p.repo}#${p.number}`).join(",");

  useEffect(() => {
    if (!enabled || linkedPRs.length === 0) {
      setDetailed(linkedPRs);
      return;
    }
    let cancelled = false;
    const fetchAll = async () => {
      const results = await Promise.all(
        linkedPRs.map(async (pr) => {
          try {
            const full = await call("pr:get", { repo: pr.repo, number: pr.number });
            return full ?? pr;
          } catch {
            return pr;
          }
        }),
      );
      if (!cancelled) setDetailed(results);
    };
    fetchAll();

    const unsubs = linkedPRs.map((pr) =>
      on(`pr:${pr.repo}#${pr.number}:changed`, () => fetchAll()),
    );
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return detailed;
}
