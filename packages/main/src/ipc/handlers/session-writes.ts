import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";
import type { ActivityItem, Session } from "@app/core";

/** Generate a unique activity item ID. */
function activityId(): string {
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Find the project that contains a given session (by checking each project's sessions array). */
async function findSessionProject(repo: JsonRepository, sessionId: string): Promise<string | null> {
  const projects = await repo.listProjects();
  for (const p of projects) {
    if (p.sessions.some((s: Session) => s.id === sessionId)) {
      return p.id;
    }
  }
  return null;
}

/** Register session CRUD IPC handlers (create + status update). */
export function registerSessionWriteHandlers(repo: JsonRepository) {
  // Create a new standalone session — persisted via upsertSession with null projectId
  handle("sessions:create", async (req) => {
    const session = await repo.upsertSession(req.session, req.projectId ?? null);

    if (req.projectId) {
      const activity: ActivityItem = {
        id: activityId(),
        kind: "session",
        text: `"${req.session.title}" session created`,
        ts: new Date().toISOString(),
      };
      await repo.appendActivity(req.projectId, activity);
    }

    emit("data:changed", { kind: "session" });
    return session;
  });

  // Update a session's status — works for both standalone and project-linked sessions
  handle("sessions:update-status", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    // Check if this session is linked to a project for activity logging and upsert scoping
    const projectId = await findSessionProject(repo, req.sessionId);

    const updated: Session = { ...existing, status: req.status };
    await repo.upsertSession(updated, projectId);

    if (projectId) {
      const activity: ActivityItem = {
        id: activityId(),
        kind: "session",
        text: `"${existing.title}" status changed to ${req.status}`,
        ts: new Date().toISOString(),
      };
      await repo.appendActivity(projectId, activity);
    }

    emit("data:changed", { kind: "session" });
  });
}
