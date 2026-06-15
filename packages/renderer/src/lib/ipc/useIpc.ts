import { useState, useEffect, useCallback } from "react";
import { call, on } from "./client.js";
import type { IpcChannel, IpcReq, IpcRes } from "@app/core";

export function useInvoke<C extends IpcChannel>(
  channel: C,
  req: IpcReq<C>,
): { data: IpcRes<C> | null; loading: boolean; error: Error | null; execute: () => void } {
  const [data, setData] = useState<IpcRes<C> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await call(channel, req));
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [channel, req]);

  // Runs on mount and whenever the request changes. Inline `req` objects from
  // call sites are memoized by React Compiler, so a stable request keeps
  // `execute` stable and the effect fires once — the previous version forced a
  // variable-shaped dependency array which both broke the Rules of Hooks and
  // looped on every render.
  useEffect(() => {
    execute();
  }, [execute]);

  return { data, loading, error, execute };
}

export function useSubscribe(topic: string, cb: (payload: unknown) => void): void {
  useEffect(() => {
    const unsub = on(topic, cb);
    return unsub;
  }, [topic, cb]);
}
