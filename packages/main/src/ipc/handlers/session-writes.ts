import { handle } from "../router.js";
import { emit } from "../emit.js";
import type { Repository } from "@app/core";
import type { ActivityItem, Session, SessionStatus } from "@app/core";
import { deriveSessionStatus } from "../../session/deriveStatus.js";

/** Apply derived status after a session upsert; patch + re-upsert if it changed. */
async function applyDerived(repo: Repository, updated: Session, projectId: string | null) {
  const derived = deriveSessionStatus(updated);
  if (derived !== updated.status) {
    const patched = await repo.upsertSession({ ...updated, status: derived }, projectId);
    // M6.2 — emit granular status event for targeted renderer updates
    emit("session-status-changed", { sessionId: patched.id, status: derived });
    return patched;
  }
  return updated;
}

/** Generate a unique activity item ID. */
function activityId(): string {
  return `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Find the project that contains a given session (by checking each project's sessions array). */
async function findSessionProject(repo: Repository, sessionId: string): Promise<string | null> {
  const projects = await repo.listProjects();
  for (const p of projects) {
    if (p.sessions.some((s: Session) => s.id === sessionId)) {
      return p.id;
    }
  }
  return null;
}

/** Register session CRUD IPC handlers (create + status update). */
export function registerSessionWriteHandlers(repo: Repository) {
  // Create a new standalone session — persisted via upsertSession with null projectId
  handle("sessions:create", async (req) => {
    const projectId = req.projectId ?? null;
    let session = await repo.upsertSession(req.session, projectId);

    if (req.projectId) {
      const activity: ActivityItem = {
        id: activityId(),
        kind: "session",
        text: `"${req.session.title}" session created`,
        ts: new Date().toISOString(),
      };
      await repo.appendActivity(req.projectId, activity);
    }

    // Derive status from any linked PR signals
    const derived = deriveSessionStatus(session);
    if (derived !== session.status) {
      session = await repo.upsertSession({ ...session, status: derived }, projectId);
      // M6.2 — emit granular status event for targeted renderer updates
      emit("session-status-changed", { sessionId: session.id, status: derived });
    }

    emit("data:changed", { kind: "session" });
    return session;
  });

  // Rename a session (title only) — standalone or project-linked.
  handle("sessions:rename", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) throw new Error(`Session not found: ${req.sessionId}`);
    const title = req.title.trim();
    if (!title) return;
    const projectId = await repo.getSessionProjectId(req.sessionId);
    await repo.upsertSession({ ...existing, title }, projectId);
    emit("data:changed", { kind: "session" });
  });

  // Update a session's status — works for both standalone and project-linked sessions
  handle("sessions:update-status", async (req) => {
    const existing = await repo.getSession(req.sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${req.sessionId}`);
    }

    // Check if this session is linked to a project for activity logging and upsert scoping
    const projectId = await findSessionProject(repo, req.sessionId);

    let updated: Session = { ...existing, status: req.status };
    updated = await applyDerived(repo, updated, projectId);

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
