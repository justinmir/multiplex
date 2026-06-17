import type { ForgeService, PullRequest, Repository } from "@app/core";

const key = (repo: string, number: number) => `${repo}#${number}`;

/** A PR is worth polling while it's neither merged nor closed. */
function isOpenPR(pr: PullRequest): boolean {
  return pr.status !== "merged" && pr.status !== "closed";
}

interface CacheEntry {
  pr: PullRequest;
  fetchedAtMs: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000; // background refresh cadence
const MIN_INTERVAL_MS = 30_000; // floor so a tiny setting can't hammer GitHub
const BASE_BACKOFF_MS = 30_000; // first wait after a failed/empty fetch
const MAX_BACKOFF_MS = 15 * 60_000; // backoff ceiling

/**
 * Cache + background refresher for live PR detail.
 *
 * Switching sessions reads PR detail from this cache (synchronous, no network),
 * so navigation never blocks on GitHub. A timer refreshes every open,
 * non-merged linked PR across all sessions on an interval; a manual "sync now"
 * forces an immediate refresh. Failed/rate-limited PRs back off exponentially
 * (per PR) so they aren't hammered every tick, and concurrent refreshes of the
 * same PR are de-duped.
 */
export class PrPoller {
  private cache = new Map<string, CacheEntry>();
  private failures = new Map<string, number>(); // consecutive failures per PR
  private nextAttemptMs = new Map<string, number>(); // earliest next attempt per PR
  private inFlight = new Map<string, Promise<PullRequest | null>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly repo: Repository,
    private readonly forge: ForgeService,
    private readonly emit: (topic: string, payload: unknown) => void,
    private readonly isConnected: () => boolean,
    /** Configured cadence (ms). Read each cycle so a settings change takes
     *  effect on the next tick without a restart. */
    private readonly getIntervalMs: () => number = () => DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Self-rescheduling (vs. setInterval) so the cadence can change at runtime
    // and a slow tick never overlaps the next one.
    void this.tick().finally(() => this.schedule());
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (!this.running) return;
    const delay = Math.max(MIN_INTERVAL_MS, this.getIntervalMs());
    this.timer = setTimeout(() => void this.tick().finally(() => this.schedule()), delay);
    // Don't keep the process alive solely for polling.
    this.timer.unref?.();
  }

  /** Cached PR detail, or null if it hasn't been fetched yet. No network. */
  get(repo: string, number: number): PullRequest | null {
    return this.cache.get(key(repo, number))?.pr ?? null;
  }

  /**
   * Force-refresh a session's open PRs right now (the manual "Sync" button),
   * bypassing the backoff window. Returns the freshest PRs available (cache,
   * falling back to the session's stored PR when a fetch turns up nothing).
   */
  async refreshSession(sessionId: string): Promise<PullRequest[]> {
    const session = await this.repo.getSession(sessionId);
    const linked = (session?.linkedPRs ?? []).filter(isOpenPR);
    await Promise.all(linked.map((pr) => this.refresh(pr.repo, pr.number, true)));
    return linked.map((pr) => this.get(pr.repo, pr.number) ?? pr);
  }

  /** One background sweep over every open PR not currently backing off. */
  private async tick(): Promise<void> {
    if (!this.isConnected()) return;
    const now = Date.now();
    for (const { repo, number } of await this.collectOpenPRs()) {
      if (now < (this.nextAttemptMs.get(key(repo, number)) ?? 0)) continue;
      await this.refresh(repo, number);
    }
  }

  /** Distinct open (non-merged) linked PRs across all sessions. */
  private async collectOpenPRs(): Promise<Array<{ repo: string; number: number }>> {
    const sessions = await this.repo.listSessions();
    const seen = new Map<string, { repo: string; number: number }>();
    for (const s of sessions) {
      for (const pr of s.linkedPRs ?? []) {
        if (isOpenPR(pr)) seen.set(key(pr.repo, pr.number), { repo: pr.repo, number: pr.number });
      }
    }
    return [...seen.values()];
  }

  /**
   * Refresh one PR into the cache, de-duping concurrent refreshes and applying
   * exponential backoff when the fetch fails or returns nothing. Emits a change
   * event when fresh detail lands so the open session re-reads from cache.
   */
  private refresh(repo: string, number: number, force = false): Promise<PullRequest | null> {
    const k = key(repo, number);
    const existing = this.inFlight.get(k);
    if (existing) return existing;
    const p = (async () => {
      try {
        const full = await this.forge.getPR(repo, number);
        if (full) {
          this.cache.set(k, { pr: full, fetchedAtMs: Date.now() });
          this.failures.delete(k);
          this.nextAttemptMs.delete(k);
          this.emit(`pr:${repo}#${number}:changed`, {});
          return full;
        }
        this.backoff(k);
        return null;
      } catch (err) {
        console.error(`[PrPoller] refresh ${k} failed:`, err);
        this.backoff(k);
        return null;
      } finally {
        this.inFlight.delete(k);
      }
    })();
    // A forced (manual) refresh shouldn't be skipped by a prior backoff window;
    // clearing it lets the next background tick resume normally on success.
    if (force) this.nextAttemptMs.delete(k);
    this.inFlight.set(k, p);
    return p;
  }

  /** Schedule the next eligible attempt for a PR with exponential backoff + jitter. */
  private backoff(k: string): void {
    const n = (this.failures.get(k) ?? 0) + 1;
    this.failures.set(k, n);
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
    const jitter = Math.random() * 0.3 * delay;
    this.nextAttemptMs.set(k, Date.now() + delay + jitter);
  }
}
