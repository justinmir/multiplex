import type { Note, Project, Reference, Session, SessionMsg, PullRequest, ActivityItem } from "@app/core";

const NOW = Date.now();
const min = 60_000, hr = 3_600_000, day = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/**
 * Whether to populate a fresh/empty store with the demo projects + sessions
 * below. Off by default so a clean install (or a cleared database) starts
 * empty and ready for real use; set MULTIPLEX_SEED=1 to load the demo data
 * (handy for screenshots / first-run walkthroughs).
 */
export function seedEnabled(): boolean {
  const v = process.env.MULTIPLEX_SEED;
  return v === "1" || v === "true";
}

/* ----------------------------- session transcript ----------------------------- */

/** A realistic agent transcript so the session view shows thinking, tool calls,
 *  and a final reply — not an empty pane. */
const replayInvestigationTranscript: SessionMsg[] = [
  {
    role: "user",
    content:
      "Our p99 ingest latency spikes to ~4s whenever we replay a backlog. Find the bottleneck and propose a fix. The replay path is in acme/ingest.",
    ts: iso(12 * min),
  },
  {
    role: "thinking",
    content:
      "Replays differ from live traffic in one way: they arrive in tight bursts with no natural backpressure. I should look at the writer's batching and the dedupe layer — a per-event lookup against the dedupe store would explain a latency cliff under burst load.",
    ts: iso(11.6 * min),
  },
  {
    role: "tool",
    content:
      "src/replay/Replayer.ts\nsrc/write/BatchWriter.ts\nsrc/dedupe/DedupeStore.ts\nsrc/dedupe/BloomFilter.ts",
    ts: iso(11.5 * min),
    tool: { name: "bash", input: { command: "git ls-files src | grep -E 'replay|write|dedupe'" }, callId: "t1", status: "ok" },
  },
  {
    role: "tool",
    content:
      "DedupeStore.has() issues one Redis round-trip per event. BatchWriter flushes every 500 events, but dedupe runs *before* batching, so a 50k-event replay = 50k sequential round-trips.",
    ts: iso(11.2 * min),
    tool: { name: "read_file", input: { path: "src/dedupe/DedupeStore.ts" }, callId: "t2", status: "ok" },
  },
  {
    role: "thinking",
    content:
      "Confirmed. The fix is to dedupe in batches: pipeline the Redis lookups (MGET) for each 500-event batch instead of one GET per event. That collapses 50k round-trips into ~100. The bloom filter already front-runs most negatives, so the MGET only fires for likely-duplicates.",
    ts: iso(10.8 * min),
  },
  {
    role: "tool",
    content: "Patched DedupeStore.hasBatch() + wired it into BatchWriter. 2 files changed, +63 −14.",
    ts: iso(10.4 * min),
    tool: { name: "apply_patch", input: { path: "src/dedupe/DedupeStore.ts" }, callId: "t3", status: "ok" },
  },
  {
    role: "tool",
    content: "PASS  replay.bench.ts › 50k backlog replay\n  p99 4,120ms → 280ms (−93%)\n  throughput 12k/s → 144k/s",
    ts: iso(9.5 * min),
    tool: { name: "bash", input: { command: "npm run bench -- replay" }, callId: "t4", status: "ok" },
  },
  {
    role: "agent",
    content:
      "**Root cause:** the dedupe layer did one Redis round-trip *per event*, and it ran before batching — so a 50k-event replay became 50k sequential lookups. Live traffic never hit this because events trickle in.\n\n**Fix:** added `DedupeStore.hasBatch()` which pipelines lookups with `MGET` per 500-event batch (the bloom filter still short-circuits clear negatives), and wired `BatchWriter` to dedupe a whole batch at once.\n\n**Result (replay bench, 50k backlog):**\n- p99 latency **4,120ms → 280ms** (−93%)\n- throughput **12k/s → 144k/s**\n\nI opened a draft PR with the change and the new benchmark. Want me to add a metrics counter for the bloom-filter hit rate before you review?",
    ts: iso(9.2 * min),
  },
];

const replayPR: PullRequest = {
  id: "pr_ingest_312",
  number: 312,
  title: "Batch dedupe lookups on the replay path",
  repo: "acme/ingest",
  branch: "agent/replay-investigate",
  baseBranch: "main",
  status: "open",
  mergeable: "clean",
  reviewVerdict: "changes_requested",
  author: "multiplex-agent",
  additions: 63,
  deletions: 14,
  updatedAt: iso(9 * min),
  checks: { passed: 7, failed: 1, pending: 0 },
  files: [
    {
      path: "src/dedupe/DedupeStore.ts",
      additions: 41,
      deletions: 9,
      kind: "modified",
      hunk:
        "@@ -42,6 +42,38 @@ export class DedupeStore {\n   async has(key: string): Promise<boolean> {\n     return (await this.redis.get(this.k(key))) !== null;\n   }\n+\n+  /** Batched existence check — one MGET per batch instead of one GET per key. */\n+  async hasBatch(keys: string[]): Promise<boolean[]> {\n+    const maybe = keys.filter((k) => this.bloom.mightContain(k));\n+    if (maybe.length === 0) return keys.map(() => false);\n+    const hits = await this.redis.mget(maybe.map(this.k));\n+    const present = new Set(maybe.filter((_, i) => hits[i] !== null));\n+    return keys.map((k) => present.has(k));\n+  }",
    },
    {
      path: "src/write/BatchWriter.ts",
      additions: 22,
      deletions: 5,
      kind: "modified",
      hunk:
        "@@ -88,9 +88,26 @@ export class BatchWriter {\n-    for (const e of batch) {\n-      if (await this.dedupe.has(e.key)) continue;\n-      out.push(e);\n-    }\n+    const seen = await this.dedupe.hasBatch(batch.map((e) => e.key));\n+    const out = batch.filter((_, i) => !seen[i]);",
    },
  ],
  comments: [
    {
      id: "rc_1",
      author: "ana",
      kind: "review",
      verdict: "changes_requested",
      body: "Love the speedup. Can we add a metric for bloom-filter hit rate so we can watch this in prod? Otherwise LGTM.",
      ts: iso(20 * min),
      resolved: false,
    },
    {
      id: "rc_2",
      author: "ana",
      kind: "inline",
      path: "src/dedupe/DedupeStore.ts",
      line: 49,
      body: "Nit: `mget` with an empty array throws on older redis clients — the early return above covers it, just leave a comment.",
      ts: iso(19 * min),
      resolved: false,
    },
  ],
  checkRuns: [
    { id: "ck_1", name: "lint", status: "success", durationSec: 28, workflow: "ci" },
    { id: "ck_2", name: "unit", status: "success", durationSec: 96, workflow: "ci" },
    { id: "ck_3", name: "integration", status: "failure", durationSec: 140, workflow: "ci", detail: "redis-cluster suite timed out waiting for failover" },
    { id: "ck_4", name: "bench (replay)", status: "success", durationSec: 71, workflow: "ci" },
  ],
};

/* --------------------------------- projects --------------------------------- */

export const seedProjects: Project[] = [
  {
    id: "p_ingest",
    name: "Ingest Pipeline v2",
    slug: "ingest-v2",
    description: "Rewriting the event ingestion pipeline for 10x throughput and exactly-once semantics.",
    repos: ["acme/ingest", "acme/shared-utils"],
    status: "active",
    color: "#d4a574",
    progress: 62,
    openPRs: 3,
    activeSessions: 2,
    lastActivity: iso(9 * min),
    agentInstructions:
      "Focus my status on what's in flight for review and anything blocking the cutover. Call out failing checks explicitly.",
    prs: [
      replayPR,
      {
        id: "pr_ingest_308",
        number: 308,
        title: "Backpressure-aware writer",
        repo: "acme/ingest",
        branch: "agent/backpressure-writer",
        baseBranch: "main",
        status: "merged",
        mergeable: "clean",
        reviewVerdict: "approved",
        author: "multiplex-agent",
        additions: 214,
        deletions: 56,
        updatedAt: iso(2 * day),
        checks: { passed: 8, failed: 0, pending: 0 },
      },
      {
        id: "pr_ingest_315",
        number: 315,
        title: "Metrics exporter for dedupe hit rate",
        repo: "acme/ingest",
        branch: "agent/metrics-export",
        baseBranch: "main",
        status: "draft",
        mergeable: "behind",
        reviewVerdict: "pending",
        author: "multiplex-agent",
        additions: 88,
        deletions: 2,
        updatedAt: iso(26 * hr),
        checks: { passed: 3, failed: 0, pending: 2 },
      },
    ],
    sessions: [
      {
        id: "s_ingest_1",
        title: "Investigate p99 spike under replay load",
        prompt: replayInvestigationTranscript[0].content,
        status: "changes_requested",
        model: "claude-opus-4-8",
        workspaces: [{ repo: "acme/ingest", branch: "agent/replay-investigate" }],
        linkedPRs: [replayPR],
        startedAt: iso(12 * min),
        createdAtMs: NOW - 12 * min,
        durationMin: 12,
        tokens: 184_220,
        cost: 2.41,
        branch: "agent/replay-investigate",
        messages: replayInvestigationTranscript,
      },
      {
        id: "s_ingest_2",
        title: "Draft metrics exporter for dedupe hit rate",
        prompt: "Export a Prometheus counter for the dedupe bloom-filter hit rate.",
        status: "review_pending",
        model: "claude-sonnet-4-6",
        workspaces: [{ repo: "acme/ingest", branch: "agent/metrics-export" }],
        startedAt: iso(day),
        createdAtMs: NOW - day,
        durationMin: 48,
        tokens: 92_104,
        cost: 0.84,
        messages: [],
      },
      {
        id: "s_ingest_3",
        title: "Document the two-phase cutover plan",
        prompt: "Turn the cutover runbook note into a step-by-step doc with rollback points.",
        status: "completed",
        model: "claude-haiku-4-5-20251001",
        workspaces: [{ repo: "acme/ingest", branch: "agent/cutover-doc" }],
        startedAt: iso(3 * day),
        createdAtMs: NOW - 3 * day,
        durationMin: 21,
        tokens: 31_900,
        cost: 0.12,
        messages: [],
      },
    ],
    notes: [
      {
        id: "n_ingest_1",
        title: "Cutover runbook",
        body:
          "Two-phase cutover:\n1. Dual-write to v1 + v2, v1 remains source of truth.\n2. Shadow-read v2 and diff for 48h.\n3. Flip read path to v2; keep v1 dual-write for 1 week as rollback.\n\nRollback = flip read path back; no data migration needed.",
        author: "ana",
        updatedAt: iso(2 * day),
        tags: ["runbook", "cutover"],
      },
      {
        id: "n_ingest_2",
        title: "Exactly-once semantics — decisions",
        body:
          "Dedupe key = (source_id, event_id, partition). TTL 7d (matches max replay window). Bloom filter sized for 0.1% FP at 200M keys. Open question: do we need cross-region dedupe? Deferred until multi-region.",
        author: "you",
        updatedAt: iso(4 * hr),
        tags: ["design", "open-question"],
      },
    ],
    references: [
      {
        id: "r_ingest_1",
        kind: "issue",
        title: "p99 latency spikes during backlog replay",
        source: "github.com/acme/ingest#298",
        url: "https://github.com/acme/ingest/issues/298",
        summary: "Replays cause a 4s p99 cliff; suspected dedupe round-trips.",
        addedAt: iso(2 * day),
        addedBy: "ana",
      },
      {
        id: "r_ingest_2",
        kind: "doc",
        title: "Exactly-once design doc",
        source: "Notion",
        url: "https://www.notion.so/acme/exactly-once",
        summary: "Source of truth for dedupe keys, TTLs, and the cutover plan.",
        addedAt: iso(5 * day),
        addedBy: "you",
      },
    ],
    activity: [
      { id: "a_ingest_1", kind: "pr", text: "PR #308 “Backpressure-aware writer” merged", ts: iso(2 * day) },
      { id: "a_ingest_2", kind: "session", text: "Session started — Investigate p99 spike under replay load", ts: iso(12 * min) },
      { id: "a_ingest_3", kind: "pr", text: "PR #312 opened — Batch dedupe lookups on the replay path", ts: iso(9 * min) },
      { id: "a_ingest_4", kind: "summary", text: "Project status re-synthesized", ts: iso(8 * min) },
    ],
    summary:
      "The replay p99 cliff is root-caused and fixed: PR #312 batches dedupe lookups (4.1s → 280ms p99) and is awaiting changes from review. The backpressure-aware writer landed; the dedupe metrics exporter is the last piece before the two-phase cutover.",
    summarySynthesizedAtMs: NOW - 8 * min,
    nextSteps: [
      "Add a bloom-filter hit-rate metric to PR #312 and re-request review",
      "Fix the flaky redis-cluster failover in the integration check",
      "Rebase PR #315 (metrics exporter) onto main — it's behind",
      "Schedule the SRE cutover dry-run",
    ],
    nextStepPrompts: [
      "On PR #312, add a Prometheus counter for the dedupe bloom-filter hit rate, then re-request review from ana.",
      "Investigate why the redis-cluster integration suite times out on failover and make it deterministic.",
      "Rebase the metrics-exporter branch (PR #315) onto the latest main and resolve any conflicts.",
      "Draft an SRE cutover dry-run checklist from the cutover runbook note.",
    ],
    suggestedPrompts: [
      "Add a bloom-filter hit-rate metric to the dedupe path and expose it via Prometheus.",
      "Make the redis-cluster failover integration test deterministic.",
      "Write the shadow-read diff tooling for phase 2 of the cutover.",
      "Audit the dedupe TTL against the max replay window and document the result.",
    ],
  },
  {
    id: "p_billing",
    name: "Billing Migration",
    slug: "billing-mig",
    description: "Move legacy billing off the monolith onto the new ledger service.",
    repos: ["acme/ledger", "acme/web"],
    status: "active",
    color: "#7ec699",
    progress: 28,
    openPRs: 1,
    activeSessions: 1,
    lastActivity: iso(hr),
    prs: [
      {
        id: "pr_ledger_77",
        number: 77,
        title: "Tax calculation parity test suite",
        repo: "acme/ledger",
        branch: "agent/tax-parity",
        baseBranch: "main",
        status: "open",
        mergeable: "blocked",
        reviewVerdict: "pending",
        author: "multiplex-agent",
        additions: 312,
        deletions: 4,
        updatedAt: iso(hr),
        checks: { passed: 11, failed: 3, pending: 0 },
      },
    ],
    sessions: [
      {
        id: "s_billing_1",
        title: "Build parity test suite for tax calc",
        prompt: "Generate a parity test suite comparing legacy tax calc against the ledger service.",
        status: "checks_failing",
        model: "claude-sonnet-4-6",
        workspaces: [{ repo: "acme/ledger", branch: "agent/tax-parity" }],
        startedAt: iso(hr),
        createdAtMs: NOW - hr,
        durationMin: 64,
        tokens: 218_400,
        cost: 1.92,
        messages: [],
      },
    ],
    notes: [
      {
        id: "n_billing_1",
        title: "Proration spec — open with finance",
        body: "Mid-cycle plan changes: legacy prorates by day, ledger prorates by second. Need finance sign-off on which is canonical before we lock parity tests.",
        author: "you",
        updatedAt: iso(6 * hr),
        tags: ["open-question", "finance"],
      },
    ],
    references: [],
    activity: [
      { id: "a_billing_1", kind: "session", text: "Session started — Build parity test suite", ts: iso(hr) },
      { id: "a_billing_2", kind: "pr", text: "PR #77 opened — Tax calculation parity test suite", ts: iso(58 * min) },
    ],
    summary:
      "Schema audit is complete and the parity test scaffold is up, but 3 tax-calc checks fail on mid-cycle proration — blocked on a canonical-rounding decision from finance.",
    summarySynthesizedAtMs: NOW - 40 * min,
    nextSteps: ["Lock the proration spec with finance", "Triage the 3 failing parity cases"],
    nextStepPrompts: [
      "Summarize the proration discrepancy (day vs. second) into a one-pager for finance with a recommendation.",
      "Triage the 3 failing tax-calc parity tests and group them by root cause.",
    ],
    suggestedPrompts: [
      "Group the failing parity tests by root cause and propose fixes.",
      "Draft the finance one-pager on proration rounding.",
    ],
  },
];

/* --------------------------- standalone sessions --------------------------- */

export const seedStandaloneSessions: Session[] = [
  {
    id: "ss_changelog",
    title: "Draft changelog for v2.4 release",
    prompt: "Write a customer-facing changelog for v2.4 covering SSO, dashboard filters, and webhook retries.",
    status: "running",
    model: "claude-sonnet-4-6",
    workspaces: [{ repo: "acme/web", branch: "agent/changelog-v2.4" }],
    startedAt: iso(18 * min),
    createdAtMs: NOW - 18 * min,
    durationMin: 18,
    tokens: 42_100,
    cost: 0.38,
    messages: [
      { role: "user", content: "Write a customer-facing changelog for v2.4 covering SSO, dashboard filters, and webhook retries.", ts: iso(18 * min) },
      { role: "thinking", content: "I'll pull the merged PRs since the v2.3 tag and group them by user-facing theme rather than by repo.", ts: iso(17 * min) },
    ],
  },
  {
    id: "ss_rename",
    title: "Rename getCwd to getCurrentWorkingDirectory",
    prompt: "Rename getCwd across the repo and update call sites.",
    status: "mergeable",
    model: "claude-haiku-4-5-20251001",
    workspaces: [{ repo: "acme/utils", branch: "agent/rename-getcwd" }],
    linkedPRs: [
      {
        id: "pr_utils_1421",
        number: 1421,
        title: "Rename getCwd to getCurrentWorkingDirectory",
        repo: "acme/utils",
        branch: "agent/rename-getcwd",
        baseBranch: "main",
        status: "open",
        mergeable: "clean",
        reviewVerdict: "approved",
        author: "multiplex-agent",
        additions: 47,
        deletions: 23,
        updatedAt: iso(hr),
        checks: { passed: 5, failed: 0, pending: 0 },
        checkRuns: [{ id: "ck_seed_1", name: "ci", status: "success", durationSec: 54 }],
      },
    ],
    startedAt: iso(2 * hr),
    createdAtMs: NOW - 2 * hr,
    durationMin: 4,
    tokens: 18_400,
    cost: 0.06,
    messages: [],
  },
  {
    id: "ss_flaky",
    title: "Quarantine the flaky auth e2e test",
    prompt: "The login e2e test fails ~1 in 5 runs. Find out why and quarantine it with a tracking issue.",
    status: "awaiting_input",
    model: "claude-opus-4-8",
    workspaces: [{ repo: "acme/web", branch: "agent/flaky-auth" }],
    startedAt: iso(40 * min),
    createdAtMs: NOW - 40 * min,
    durationMin: 9,
    tokens: 57_800,
    cost: 0.51,
    messages: [],
  },
];
