import { BrowserWindow } from "electron";
import { EVENT_CHANNEL } from "@app/core";

export function emit(topic: string, payload: unknown) {
  const evt = { topic, payload, ts: Date.now() };
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(EVENT_CHANNEL, evt);
}
