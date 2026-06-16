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
  synthesizedAtMs: number;
}

/**
 * LLM synthesis behind an interface so the provider/model is swappable. The
 * first implementation drives opencode (the same backend as the agent harness);
 * a direct-SDK impl (AnthropicIntelligence, …) remains a one-file swap.
 */
export interface IntelligenceProvider {
  summarizeProject(input: ProjectSummaryInput): Promise<ProjectSummaryResult>;
  summarizeReference(input: { title: string; url?: string; body?: string }): Promise<string>;
}
