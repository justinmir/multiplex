import type { Project, ProjectSummaryInput } from "@app/core";

const MAX_NOTE_BODY = 800;
const MAX_REF_SUMMARY = 200;
const MAX_REF_CONTENT = 1200; // indexed reference content is richer than a one-liner
const MAX_ITEMS = 20;

function truncate(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export interface AssembledContext {
  notes: { title: string; body: string }[];
  references: { title: string; url?: string; body?: string }[];
  stateDigest: string;
}

/**
 * Assemble a project's notes + references + state into a compact, token-bounded
 * context. Reused for both LLM summaries and harness runs (so every agent run
 * inherits the project's notes/refs — the R-INTEL-5 contract).
 */
export function assembleProjectContext(project: Project): AssembledContext {
  const notes = (project.notes ?? []).slice(0, MAX_ITEMS).map((n) => ({
    title: n.title,
    body: truncate(n.body, MAX_NOTE_BODY),
  }));
  const references = (project.references ?? []).slice(0, MAX_ITEMS).map((r) => ({
    title: r.title,
    url: r.url,
    // Prefer the indexed content (pulled once via the harness) so synthesis and
    // agent runs reuse it without re-fetching; fall back to the one-line summary.
    body: r.indexedContent
      ? truncate(r.indexedContent, MAX_REF_CONTENT)
      : r.summary ? truncate(r.summary, MAX_REF_SUMMARY) : undefined,
  }));

  const sessions = project.sessions ?? [];
  const prs = project.prs ?? [];
  const statusCounts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});
  const stateDigest = [
    `Project: ${project.name} (${project.status})`,
    project.description ? `Description: ${project.description}` : "",
    `Repos: ${(project.repos ?? []).join(", ") || "none"}`,
    `Sessions: ${sessions.length} (${Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`).join(", ") || "none"})`,
    `Open PRs: ${prs.filter((p) => p.status === "open" || p.status === "draft" || p.status === "review").length}`,
  ].filter(Boolean).join("\n");

  return { notes, references, stateDigest };
}

/** Build the user-message text for a project summary synthesis. */
export function buildSummaryPrompt(input: ProjectSummaryInput): string {
  const ctx = assembleProjectContext(input.project);
  const lines: string[] = [ctx.stateDigest, ""];

  if (input.sessions.length) {
    lines.push("Sessions:");
    for (const s of input.sessions.slice(0, MAX_ITEMS)) {
      lines.push(`- [${s.status}] ${s.title}${s.model ? ` (${s.model})` : ""}`);
    }
    lines.push("");
  }
  if (input.prs.length) {
    lines.push("Pull requests:");
    for (const p of input.prs.slice(0, MAX_ITEMS)) {
      lines.push(`- ${p.repo}#${p.number} [${p.status}${p.reviewVerdict ? `, ${p.reviewVerdict}` : ""}] ${p.title}`);
    }
    lines.push("");
  }
  if (ctx.notes.length) {
    lines.push("Notes:");
    for (const n of ctx.notes) lines.push(`- ${n.title}: ${n.body}`);
    lines.push("");
  }
  if (ctx.references.length) {
    lines.push("References:");
    for (const r of ctx.references) lines.push(`- ${r.title}${r.body ? ` — ${r.body}` : ""}`);
    lines.push("");
  }
  if (input.recentActivity.length) {
    lines.push("Recent activity:");
    for (const a of input.recentActivity.slice(0, 10)) lines.push(`- ${a.text}`);
  }
  return lines.join("\n").trim();
}
