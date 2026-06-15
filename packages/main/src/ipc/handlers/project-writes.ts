import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";

/** Register project-level write IPC handlers. */
export function registerProjectWriteHandlers(repo: JsonRepository) {
  // Create or update a project
  handle("projects:upsert", async (req) => {
    const project = await repo.upsertProject(req.project);
    emit("data:changed", { kind: "project" });
    return project;
  });
}
