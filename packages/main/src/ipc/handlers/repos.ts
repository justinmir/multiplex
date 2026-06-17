import { handle } from "../router.js";
import { emit } from "../emit.js";
import { repoRegistry } from "../../git/RepoRegistry.js";

/** Register repo-catalog IPC handlers. */
export function registerRepoHandlers() {
  handle("repos:list", () => repoRegistry.list());

  handle("repos:add", async (req) => {
    const result = await repoRegistry.add(req.root, req.name);
    if (result.ok) emit("settings:changed", {});
    return result;
  });

  handle("repos:remove", (req) => {
    repoRegistry.remove(req.name);
    emit("settings:changed", {});
  });
}
