import type { AppSettingsData, IntelligenceProvider, ProjectSummaryResult, Reference, RefScope, Repository } from "@app/core";

const ACTIVITY_DEBOUNCE_MS = 3 * 60_000;   // coalesce bursts of activity
const MAX_PER_HOUR = 6;                      // cost guardrail per project
const DAILY_MS = 24 * 60 * 60_000;

/**
 * Wires the IntelligenceProvider to the repository: on-demand resynthesis,
 * reference ingestion, and the activity-debounced / daily auto-synthesis
 * scheduler (gated by Settings).
 */
export class IntelligenceService {
  private debounce = new Map<string, ReturnType<typeof setTimeout>>();
  private recent = new Map<string, number[]>(); // projectId → recent synth timestamps
  private dailyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repo: Repository,
    private readonly provider: IntelligenceProvider,
    private readonly getSettings: () => AppSettingsData,
    private readonly emit: (topic: string, payload: unknown) => void,
  ) {}

  /** On-demand (manual) resynthesis — always runs, ignores the auto toggle. */
  async resynthesize(projectId: string): Promise<ProjectSummaryResult | null> {
    const project = await this.repo.getProject(projectId);
    if (!project) return null;

    const result = await this.provider.summarizeProject({
      project,
      sessions: project.sessions,
      prs: project.prs,
      notes: project.notes,
      references: project.references,
      recentActivity: project.activity.slice(-10),
    });

    await this.repo.upsertProject({
      ...project,
      summary: result.summary,
      nextSteps: result.nextSteps,
      summarySynthesizedAtMs: result.synthesizedAtMs,
    });
    this.recordRun(projectId);
    this.emit("data:changed", { kind: "project", projectId });
    return result;
  }

  /** Derive a one-line summary for a freshly-added reference (M5.5). */
  async ingestReference(scope: RefScope, ref: Reference): Promise<void> {
    if (!this.getSettings().intelligenceEnabled) return;
    if (ref.summary) return; // already summarized
    try {
      const summary = await this.provider.summarizeReference({ title: ref.title, url: ref.url });
      if (!summary) return;
      await this.repo.upsertReference(scope, { ...ref, summary });
      this.emit("data:changed", { kind: "reference" });
    } catch (err) {
      console.error("[intelligence] reference ingestion failed:", err);
    }
  }

  /** Notify of project activity; debounce an auto-resynthesis if enabled (M5.4). */
  notifyActivity(projectId: string): void {
    const s = this.getSettings();
    if (!s.intelligenceEnabled || !s.autoSynthesizeOnActivity) return;
    const existing = this.debounce.get(projectId);
    if (existing) clearTimeout(existing);
    this.debounce.set(projectId, setTimeout(() => {
      this.debounce.delete(projectId);
      if (this.underRateLimit(projectId)) {
        this.resynthesize(projectId).catch((e) => console.error("[intelligence] auto-resynth failed:", e));
      }
    }, ACTIVITY_DEBOUNCE_MS));
  }

  /** Start the once-a-day synthesis tick (gated at fire time). */
  startDaily(): void {
    if (this.dailyTimer) return;
    this.dailyTimer = setInterval(() => {
      const s = this.getSettings();
      if (!s.intelligenceEnabled) return;
      this.repo.listProjects()
        .then((projects) => {
          for (const p of projects) {
            if (p.status === "active" && this.underRateLimit(p.id)) {
              this.resynthesize(p.id).catch(() => {});
            }
          }
        })
        .catch(() => {});
    }, DAILY_MS);
  }

  stop(): void {
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    if (this.dailyTimer) { clearInterval(this.dailyTimer); this.dailyTimer = null; }
  }

  private recordRun(projectId: string): void {
    const arr = this.recent.get(projectId) ?? [];
    arr.push(Date.now());
    this.recent.set(projectId, arr);
  }

  private underRateLimit(projectId: string): boolean {
    const cutoff = Date.now() - 60 * 60_000;
    const arr = (this.recent.get(projectId) ?? []).filter((t) => t > cutoff);
    this.recent.set(projectId, arr);
    return arr.length < MAX_PER_HOUR;
  }
}
