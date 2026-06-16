import { useCallback, useEffect, useRef, useState } from "react";
import { call } from "../../lib/ipc/client.js";

export interface HarnessInfo {
  id: string;
  label: string;
  health?: { ok: boolean; version?: string; detail?: string };
  models?: Array<{ id: string; label?: string; provider?: string }>;
}

/** Fetch harness info (health + models) for a given harnessId. */
export function useHarnessInfo(harnessId: string | undefined, open: boolean) {
  const [info, setInfo] = useState<HarnessInfo>({ id: harnessId ?? "mock", label: "" });
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  async function load(hid: string) {
    cancelledRef.current = false;
    setLoading(true);
    try {
      const health = await call("harness:health", { harnessId: hid });
      const models = await call("harness:models", { harnessId: hid });
      if (cancelledRef.current) return;

      setInfo({
        id: hid,
        label: hid === "mock" ? "Mock (dev)" : hid.charAt(0).toUpperCase() + hid.slice(1),
        health,
        models,
      });
    } catch {
      if (cancelledRef.current) return;
      setInfo({
        id: hid,
        label: hid === "mock" ? "Mock (dev)" : hid.charAt(0).toUpperCase() + hid.slice(1),
        health: { ok: false, detail: "Failed to connect" },
        models: [],
      });
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !harnessId) return;
    load(harnessId);
    return () => { cancelledRef.current = true; };
  }, [harnessId, open]);

  const refresh = useCallback(async () => {
    if (!harnessId) return;
    await load(harnessId);
  }, [harnessId]);

  return { info, loading, refresh };
}
