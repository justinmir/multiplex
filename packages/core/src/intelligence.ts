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
export interface IntelligenceProvider {
  summarizeProject(input: ProjectSummaryInput): Promise<ProjectSummaryResult>;
  summarizeReference(input: { title: string; url?: string; body?: string }): Promise<string>;
  /** 4 actionable session prompts derived from an overall-context overview
   *  (used for the project-less "new session" suggestions). */
  suggestGlobalPrompts(overview: string): Promise<string[]>;
}
