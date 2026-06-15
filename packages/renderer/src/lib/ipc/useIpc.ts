import { useState, useEffect, useCallback } from "react";
import { call, on } from "./client.js";
import type { IpcChannel, IpcReq, IpcRes } from "@app/core";

export function useInvoke<C extends IpcChannel>(
  channel: C,
  req: IpcReq<C>,
  deps?: unknown[],
): { data: IpcRes<C> | null; loading: boolean; error: Error | null; execute: () => void } {
  const [data, setData] = useState<IpcRes<C> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call(channel, req);
      setData(result);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [channel, req]);

  useEffect(() => {
    if (!deps) {
      execute();
    }
  }, deps ? [...deps] : [execute]);

  return { data, loading, error, execute };
}

export function useSubscribe(topic: string, cb: (payload: unknown) => void): void {
  useEffect(() => {
    const unsub = on(topic, cb);
    return unsub;
  }, [topic, cb]);
}
