import { useCallback, useEffect, useState } from "react";
import { call, on } from "../ipc/client.js";

export interface RegisteredRepo {
  name: string;
  root: string;
}

/** Load + manage the catalog of registered local repos (Settings only). */
export function useRepos() {
  const [repos, setRepos] = useState<RegisteredRepo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setRepos(await call("repos:list", undefined as never));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = on("settings:changed", () => refresh());
    return () => unsub();
  }, [refresh]);

  const add = useCallback(async (root: string, name?: string) => {
    const result = await call("repos:add", { root, name });
    await refresh();
    return result;
  }, [refresh]);

  const remove = useCallback(async (name: string) => {
    await call("repos:remove", { name });
    await refresh();
  }, [refresh]);

  return { repos, loading, add, remove, refresh };
}
