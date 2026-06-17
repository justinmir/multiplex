import { handle } from "../router.js";
import type { IntelligenceService } from "../../intelligence/IntelligenceService.js";

/** Register project-intelligence IPC handlers (M5.3). */
export function registerIntelligenceHandlers(service: IntelligenceService) {
  handle("project:resynthesize", async (req) => {
    return service.resynthesize(req.projectId);
  });

  handle("refs:index", async (req) => {
    await service.indexProjectReferences(req.projectId);
  });

  handle("suggestions:global", async () => {
    return service.getGlobalSuggestions();
  });
}
