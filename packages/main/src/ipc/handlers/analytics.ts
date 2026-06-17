import { handle } from "../router.js";
import type { Repository } from "@app/core";

/** Token-usage analytics IPC handler. */
export function registerAnalyticsHandlers(repo: Repository) {
  handle("analytics:tokens", async (req) => {
    return repo.listTokenUsage(req.sinceMs ?? 0);
  });
}
