import { handle } from "../router.js";
import { emit } from "../emit.js";
import { syncService } from "../../git/SyncService.js";

/** Register project sync IPC handlers. */
export function registerSyncHandlers() {
  // Sync a single project's PRs from GitHub repos  
  handle("projects:sync", async (req) => {
    if (!syncService) {
      console.warn("projects:sync called before SyncService initialized");
      return null;
    }
    
    const project = await syncService.syncProject(req.projectId);
    
    // Emit change event so renderer can refresh  
    emit("data:changed", { kind: "project", projectId: req.projectId });
    
    return project;
  });
}
