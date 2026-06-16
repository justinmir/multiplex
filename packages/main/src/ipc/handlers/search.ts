import { handle } from "../router.js";
import type { JsonRepository } from "../../repo/JsonRepository.js";
import type { IpcRes } from "@app/core";

type SearchResult = IpcRes<"search:query">[number];

/** Register the global search handler over real projects, sessions, and PRs (M6.3). */
export function registerSearchHandlers(repo: JsonRepository) {
  handle("search:query", async (req) => {
    const q = req.q.trim().toLowerCase();
    if (!q) return [];
    const has = (s: string | undefined) => (s ?? "").toLowerCase().includes(q);

    const [projects, standalone] = await Promise.all([
      repo.listProjects(),
      repo.listSessions({ projectId: null }),
    ]);
    const out: SearchResult[] = [];

    for (const p of projects) {
      if (has(p.name) || has(p.description)) {
        out.push({ kind: "project", id: p.id, title: p.name, subtitle: p.description, projectId: p.id });
      }
      for (const s of p.sessions) {
        if (has(s.title) || has(s.prompt)) {
          out.push({ kind: "session", id: s.id, title: s.title || "Untitled session", status: s.status, projectId: p.id });
        }
      }
      for (const pr of p.prs ?? []) {
        if (has(pr.title) || has(pr.repo) || `#${pr.number}`.includes(q)) {
          out.push({ kind: "pr", id: pr.id, title: pr.title, subtitle: `${pr.repo} #${pr.number}`, projectId: p.id });
        }
      }
    }

    for (const s of standalone) {
      if (has(s.title) || has(s.prompt)) {
        out.push({ kind: "session", id: s.id, title: s.title || "Untitled session", status: s.status });
      }
      for (const pr of s.linkedPRs ?? []) {
        if (has(pr.title) || has(pr.repo) || `#${pr.number}`.includes(q)) {
          out.push({ kind: "pr", id: pr.id, title: pr.title, subtitle: `${pr.repo} #${pr.number}` });
        }
      }
    }

    return out;
  });
}
