import { shell } from "electron";
import { handle } from "../router.js";

/** Register application-level IPC handlers (URL opening, etc.). */
export function registerAppHandlers() {
  // M4.3 — Open URL in system browser
  handle("app:open-url", async (req) => {
    await shell.openExternal(req.url);
  });
}
