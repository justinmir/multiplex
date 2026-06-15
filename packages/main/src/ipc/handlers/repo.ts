import { handle } from "../router.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";

/** Register all repository read IPC handlers against a shared JsonRepository. */
export function registerRepoReadHandlers(repo: JsonRepository) {
  handle("projects:list", () => repo.listProjects());

  handle("projects:get", (req) => repo.getProject(req.id));

  // When projectId is undefined (renderer sends nothing), pass no filter → all sessions.
  // When projectId is a string, filter to that project's sessions only.
  handle("sessions:list", (req) => {
    if (req.projectId === undefined) {
      return repo.listSessions();
    }
    return repo.listSessions({ projectId: req.projectId });
  });

  handle("sessions:get", (req) => repo.getSession(req.id));
}
