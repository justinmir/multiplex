import { handle } from "../router.js";
import { emit } from "../emit.js";
import { getAppSettings } from "../../settings/AppSettings.js";

/** Register settings IPC handlers. */
export function registerSettingsHandlers() {
  const settings = getAppSettings();

  // Return full settings snapshot
  handle("settings:get", () => settings.get());

  // Upsert partial settings and return the merged result
  handle("settings:set", (req) => {
    const updated = settings.set(req);
    emit("settings:changed", {});
    return updated;
  });
}
