import { ipcRenderer } from "electron";
import { sha256sum } from "./nodeCrypto.js";
import { versions } from "./versions.js";
import { EVENT_CHANNEL } from "@app/core";

function invoke(channel: string, payload: unknown): Promise<unknown> {
  return ipcRenderer.invoke(channel, payload);
}

/** Subscribe to a topic. Returns an unsubscribe fn. */
function subscribe(topic: string, cb: (payload: unknown) => void): () => void {
  const listener = (_e: unknown, evt: { topic: string; payload: unknown }) => {
    if (evt.topic === topic || topic === "*") cb(evt.payload);
  };
  ipcRenderer.on(EVENT_CHANNEL, listener as any);
  return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener as any);
}

export const ipc = { invoke, subscribe };

// Keep existing exports for backwards compatibility
export { sha256sum, versions };
