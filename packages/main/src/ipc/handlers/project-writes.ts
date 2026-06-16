import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { Repository } from "@app/core";

/** Register project-level write IPC handlers. */
export function registerProjectWriteHandlers(repo: Repository) {
  // Create or update a project
  handle("projects:upsert", async (req) => {
    const project = await repo.upsertProject(req.project);
    emit("data:changed", { kind: "project" });
    return project;
  });
}
