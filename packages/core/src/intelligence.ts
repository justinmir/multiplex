import type { ActivityItem, Note, Project, PullRequest, Reference, Session } from "./domain.js";

/** Everything the model needs to synthesize a project status update. */
export interface ProjectSummaryInput {
  project: Project;
  sessions: Session[];
  prs: PullRequest[];
  notes: Note[];
  references: Reference[];
  recentActivity: ActivityItem[];
}

export interface ProjectSummaryResult {
  /** Narrative status update (R-INTEL-1). */
  summary: string;
  /** Ordered next steps (R-INTEL-2). */
  nextSteps: string[];
  /** A ready-to-run session prompt for each next step (aligned by index). */
  nextStepPrompts: string[];
  /** 4 actionable, specific session prompts a user could start next. */
  suggestedPrompts: string[];
  synthesizedAtMs: number;
}

/**
 * LLM synthesis behind an interface so the provider/model is swappable. The
 * first implementation drives opencode (the same backend as the agent harness);
 * a direct-SDK impl (AnthropicIntelligence, …) remains a one-file swap.
 */
/** What the harness extracted (or failed to extract) for a single reference. */
export interface ReferenceIndexResult {
  /** Extracted internal representation the intelligence layer can reuse. */
  content?: string;
  /** One-line summary (same role as `summarizeReference`). */
  summary?: string;
  /** Clear, user-facing reason the resource couldn't be accessed, if any. */
  error?: string;
}

export interface IntelligenceProvider {
  summarizeProject(input: ProjectSummaryInput): Promise<ProjectSummaryResult>;
  summarizeReference(input: { title: string; url?: string; body?: string }): Promise<string>;
  /** 4 actionable session prompts derived from an overall-context overview
   *  (used for the project-less "new session" suggestions). */
  suggestGlobalPrompts(overview: string): Promise<string[]>;
  /**
   * Pull a reference's content ONCE using the harness's tools (web fetch/search
   * + any configured MCP servers for wikis/docs/Google Docs) and return an
   * internal representation. Optional: a provider that can't reach external
   * resources omits it and the caller degrades to `summarizeReference`.
   */
  indexReference?(input: { title: string; url?: string; kind?: string }): Promise<ReferenceIndexResult>;
}
