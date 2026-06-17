import { app, shell } from "electron";
import { handle } from "../router.js";

/** Register application-level IPC handlers (URL opening, etc.). */
export function registerAppHandlers() {
  // Open URL in system browser
  handle("app:open-url", async (req) => {
    await shell.openExternal(req.url);
  });

  // App version + whether this is a packaged (release) build. The UI shows the
  // version for releases and "dev" for unpackaged/dev runs.
  handle("app:version", () => ({ version: app.getVersion(), isPackaged: app.isPackaged }));
}
