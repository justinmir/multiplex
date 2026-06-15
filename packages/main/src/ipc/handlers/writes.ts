import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";
import type { ActivityItem } from "@app/core";

/** Generate a unique activity item ID. */
function activityId(): string {
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Register all repository write IPC handlers against a shared JsonRepository. */
export function registerRepoWriteHandlers(repo: JsonRepository) {
  // Notes — append activity on create/update/delete
  handle("notes:upsert", async (req) => {
    const note = await repo.upsertNote(req.projectId, req.note);

    const activity: ActivityItem = {
      id: activityId(),
      kind: "note",
      text: `Note ${req.note.title ? `"${req.note.title}"` : ""} updated`,
      ts: new Date().toISOString(),
    };
    await repo.appendActivity(req.projectId, activity);

    emit("data:changed", { kind: "note", projectId: req.projectId });
    return note;
  });

  handle("notes:delete", async (req) => {
    await repo.deleteNote(req.projectId, req.noteId);

    const activity: ActivityItem = {
      id: activityId(),
      kind: "note",
      text: "Note deleted",
      ts: new Date().toISOString(),
    };
    await repo.appendActivity(req.projectId, activity);

    emit("data:changed", { kind: "note", projectId: req.projectId });
  });

  // References — append activity on create/delete (project-scoped only)
  handle("refs:upsert", async (req) => {
    const ref = await repo.upsertReference(req.scope, req.reference);

    if ("projectId" in req.scope && req.scope.projectId) {
      const activity: ActivityItem = {
        id: activityId(),
        kind: "ref",
        text: `Reference added — ${req.reference.title || "Untitled"}`,
        ts: new Date().toISOString(),
      };
      await repo.appendActivity(req.scope.projectId, activity);
    }

    emit("data:changed", { kind: "reference" });
    return ref;
  });

  handle("refs:delete", async (req) => {
    await repo.deleteReference(req.scope, req.refId);

    if ("projectId" in req.scope && req.scope.projectId) {
      const activity: ActivityItem = {
        id: activityId(),
        kind: "ref",
        text: "Reference removed",
        ts: new Date().toISOString(),
      };
      await repo.appendActivity(req.scope.projectId, activity);
    }

    emit("data:changed", { kind: "reference" });
  });

  // Session archive — standalone sessions have no projectId, so we skip activity append (Phase 2)
  handle("sessions:archive", async (req) => {
    await repo.archiveSession(req.sessionId);
    emit("data:changed", { kind: "session" });
  });
}
