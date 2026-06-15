import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";

/** Register all repository write IPC handlers against a shared JsonRepository. */
export function registerRepoWriteHandlers(repo: JsonRepository) {
  // Notes
  handle("notes:upsert", async (req) => {
    const note = await repo.upsertNote(req.projectId, req.note);
    emit("data:changed", { kind: "note", projectId: req.projectId });
    return note;
  });

  handle("notes:delete", async (req) => {
    await repo.deleteNote(req.projectId, req.noteId);
    emit("data:changed", { kind: "note", projectId: req.projectId });
  });

  // References
  handle("refs:upsert", async (req) => {
    const ref = await repo.upsertReference(req.scope, req.reference);
    emit("data:changed", { kind: "reference" });
    return ref;
  });

  handle("refs:delete", async (req) => {
    await repo.deleteReference(req.scope, req.refId);
    emit("data:changed", { kind: "reference" });
  });

  // Session archive
  handle("sessions:archive", async (req) => {
    await repo.archiveSession(req.sessionId);
    emit("data:changed", { kind: "session" });
  });
}
