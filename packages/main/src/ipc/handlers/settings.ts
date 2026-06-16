import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { AppSettingsData } from "@app/core";
import { getAppSettings } from "../../settings/AppSettings.js";

/** Strip secrets before settings cross IPC — they live in main; the renderer
 *  only writes them (never reads them back). Connection status is exposed via
 *  github:get-status. */
function redact(s: AppSettingsData): AppSettingsData {
  return { ...s, githubToken: undefined };
}

/** Register settings IPC handlers. */
export function registerSettingsHandlers() {
  const settings = getAppSettings();

  // Return the settings snapshot with secrets redacted
  handle("settings:get", () => redact(settings.get()));

  // Upsert partial settings and return the merged (redacted) result
  handle("settings:set", (req) => {
    const updated = settings.set(req);
    emit("settings:changed", {});
    return redact(updated);
  });
}
