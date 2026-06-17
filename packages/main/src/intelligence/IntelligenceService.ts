import type { AppSettingsData, IntelligenceProvider, ProjectSummaryResult, Reference, RefScope, Repository } from "@app/core";

const ACTIVITY_DEBOUNCE_MS = 3 * 60_000;   // coalesce bursts of activity
const MAX_PER_HOUR = 6;                      // cost guardrail per project
const DEFAULT_INTERVAL_MIN = 60;             // resynthesize active projects hourly by default
const SWEEP_CHECK_MS = 5 * 60_000;           // how often to check staleness
const STARTUP_DELAY_MS = 30_000;             // catch-up pass shortly after boot

/**
 * Wires the IntelligenceProvider to the repository: on-demand resynthesis,
 * reference ingestion, and the activity-debounced / daily auto-synthesis
 * scheduler (gated by Settings).
 */
export class IntelligenceService {
  private debounce = new Map<string, ReturnType<typeof setTimeout>>();
  private recent = new Map<string, number[]>(); // projectId → recent synth timestamps
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;

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
      suggestedPrompts: result.suggestedPrompts?.length ? result.suggestedPrompts : project.suggestedPrompts,
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

  /**
   * Resynthesize active projects whose summary is older than a day. Runs on a
   * frequent check rather than a 24h interval, and uses the *persisted*
   * `summarySynthesizedAtMs` to decide staleness — so it catches up across app
   * restarts instead of requiring 24h of continuous uptime.
   */
  startDaily(): void {
    if (this.dailyTimer) return;
    const sweep = () => {
      if (!this.getSettings().intelligenceEnabled) return;
      const intervalMs = Math.max(5, this.getSettings().synthesisIntervalMinutes ?? DEFAULT_INTERVAL_MIN) * 60_000;
      const now = Date.now();
      this.repo.listProjects()
        .then((projects) => {
          for (const p of projects) {
            const last = p.summarySynthesizedAtMs ?? 0;
            if (p.status === "active" && now - last > intervalMs && this.underRateLimit(p.id)) {
              this.resynthesize(p.id).catch(() => {});
            }
          }
        })
        .catch(() => {});
    };
    this.startupTimer = setTimeout(sweep, STARTUP_DELAY_MS); // catch-up after boot
    this.dailyTimer = setInterval(sweep, SWEEP_CHECK_MS);
  }

  /**
   * Suggested session prompts for the project-less "new session" view, derived
   * from an overview of all projects + recent sessions. Cached and regenerated
   * at most once per the configured synthesis interval.
   */
  private globalCache: { prompts: string[]; ts: number } | null = null;
  async getGlobalSuggestions(): Promise<string[]> {
    if (!this.getSettings().intelligenceEnabled) return [];
    const intervalMs = Math.max(5, this.getSettings().synthesisIntervalMinutes ?? DEFAULT_INTERVAL_MIN) * 60_000;
    if (this.globalCache && Date.now() - this.globalCache.ts < intervalMs) return this.globalCache.prompts;
    try {
      const projects = await this.repo.listProjects();
      const standalone = await this.repo.listSessions({ projectId: null });
      const overview = [
        "Projects:",
        ...projects.map((p) => `- ${p.name} (${p.status}): ${p.summary || "no summary"}`),
        "",
        "Recent standalone sessions:",
        ...standalone.slice(-10).map((s) => `- ${s.title}`),
      ].join("\n");
      const prompts = await this.provider.suggestGlobalPrompts(overview);
      if (prompts.length > 0) this.globalCache = { prompts, ts: Date.now() };
      return prompts;
    } catch (err) {
      console.error("[intelligence] global suggestions failed:", err);
      return this.globalCache?.prompts ?? [];
    }
  }

  stop(): void {
    for (const t of this.debounce.values()) clearTimeout(t);
    this.debounce.clear();
    if (this.dailyTimer) { clearInterval(this.dailyTimer); this.dailyTimer = null; }
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null; }
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
