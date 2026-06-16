# Workstream D — Project intelligence (opencode-backed LLM synthesis)

> **Hand this whole file to the implementing agent.** It is self-contained.
> Companion docs: `docs/plans/implementation-plan.md` (Phase 5 is the source of
> these milestones), `AGENTS.md`, `docs/plans/workstream-a-agent-harness.md`.

---

## Prompt to the agent

You are building Multiplex's **project intelligence layer** — the product
differentiator: LLM-synthesized project summaries, ordered next-steps, reference
one-liners, and the promise that "the agent reads the notes + references on every
run." Today this is entirely faked: the Overview's *"Agent summary · synthesized
14m ago"*, the summary text, and the next-steps list are **hardcoded seed
strings**; the Settings toggles `intelligenceEnabled` / `autoSynthesizeOnActivity`
are inert; there is no LLM call anywhere (`grep` for "Anthropic"/"intelligence" in
`packages/main/src` returns nothing).

**Provider decision: use opencode, not a model SDK.** The intelligence layer
drives the **same opencode backend as the agent harness** (Workstream A) via a
**tool-less, one-shot prompt**, so providers/models/keys are configured in one
place (opencode's own config) and there's one process supervisor. Keep everything
behind an `IntelligenceProvider` interface so a future direct-SDK impl
(`AnthropicIntelligence`, etc.) is a one-file swap.

**Hard rules (from `AGENTS.md`):**
- Gate after every milestone: `npm run validate` + `npm run screenshot`.
- No new code in `packages/renderer/src/app/**` (Figma-synced). The Overview
  already renders the summary, the "synthesized Xm ago" stamp, and the next-steps
  list — bind those to real data from `src/lib`/`src/shell`.
- New IPC channels typed in `packages/core/src/ipc.ts`. Provider credentials live
  in opencode/main, never logged, never sent to the renderer.

**Current relevant state (read before starting):**
- Settings already carry `intelligenceEnabled`, `autoSynthesizeOnActivity`,
  `defaultModel` (`AppSettingsData` in `packages/core/src/ipc.ts`); persisted by
  `packages/main/src/settings/AppSettings.ts`.
- The Overview component is `packages/renderer/src/app/components/tabs/OverviewTab.tsx`
  — line ~25 hardcodes "Agent summary · synthesized 14m ago"; `project.summary`
  and `project.nextSteps` come straight from seed
  (`packages/main/src/repo/seed.ts`).
- opencode infra to reuse comes from Workstream A:
  `packages/main/src/harness/opencode/server.ts` (server/SDK client) and
  `SPIKE.md` (pinned API surface, model id format `provider/model`).
- `Project`, `Note`, `Reference`, `ActivityItem`, `PullRequest` shapes are in
  `packages/core/src/domain.ts`. Reference summaries surface in
  `ReferencesTab.tsx` (`reference.summary`).

> **Prerequisite: Workstream A must land first** — this layer reuses its opencode
> server/SDK helper. Until then, develop against a small fake provider.

Work the milestones in order.

---

## M-D1 — `IntelligenceProvider` interface + `OpencodeIntelligence` (was M5.1)

**Goal.** Abstract LLM synthesis; implement it by driving opencode with a
tool-less one-shot prompt.

**Files**
- `+ packages/core/src/intelligence.ts` (interface + result types)
- `~ packages/core/src/index.ts` (export it)
- `+ packages/main/src/intelligence/OpencodeIntelligence.ts`
- `+ packages/main/src/intelligence/prompts.ts` (system prompts)
- `~ packages/main/src/harness/opencode/server.ts` (expose a `runOpencodePrompt`
  helper: transient session, `tools: false`, returns final text)
- `+ packages/main/src/intelligence/OpencodeIntelligence.test.ts` (guarded)

**Interfaces (implement verbatim):**
```ts
import type { Project, Session, PullRequest, Note, Reference, ActivityItem } from "./domain.js";

export interface ProjectSummaryInput {
  project: Project; sessions: Session[]; prs: PullRequest[];
  notes: Note[]; references: Reference[]; recentActivity: ActivityItem[];
}
export interface ProjectSummaryResult {
  summary: string; nextSteps: string[]; synthesizedAtMs: number;
}
export interface IntelligenceProvider {
  summarizeProject(input: ProjectSummaryInput): Promise<ProjectSummaryResult>;
  summarizeReference(input: { title: string; url?: string; body?: string }): Promise<string>;
}
```

**Steps**
1. `runOpencodePrompt({ model, system, prompt, tools:false })` — drive a transient
   opencode session through the Workstream A client (preferred) or shell out to
   `opencode run --model <provider/model>` as a fallback; **stream** and return the
   final assistant text. Disable tools so synthesis can't touch the filesystem.
2. `OpencodeIntelligence.summarizeProject` — assemble the bundle (M-D2) into the
   prompt; instruct strict JSON `{ summary, nextSteps[] }`; extract the first JSON
   object; best-effort fallback if parsing fails. Model id = `opts.model ??
   settings.defaultModel` (`provider/model`). Map process/opencode failures to a
   typed `IntelligenceError`.
3. `summarizeReference` — one-shot prompt returning a single line.

**Acceptance** — given a project bundle, returns a coherent summary + ordered
steps via opencode.

**Validate** — `npm --workspace @app/main run test`, guarded on opencode being
present + a provider configured (skip otherwise), asserting non-empty
`summary`/`nextSteps`. `npm run typecheck`.

---

## M-D2 — Context assembly (the R-INTEL-5 contract) (was M5.2)

**Goal.** One assembler that turns a project's notes + references + state into
prompt context — reused for **both** summaries and **harness runs**, so every
agent run inherits notes/refs.

**Files**
- `+ packages/main/src/intelligence/assembleContext.ts`
- `~ packages/main/src/session/SessionRuntime.ts` (Workstream A — populate
  `HarnessRunInput.notes`/`references` from this assembler for project sessions)

**Steps**
1. `assembleProjectContext(project)` → `{ notes[], references[], stateDigest }`
   with token-budget-aware truncation (summarize long reference bodies; cap the
   digest). Deterministic ordering.
2. On `startSession` for a project-scoped session, fill
   `HarnessRunInput.notes`/`references` from the same assembler.

**Acceptance** — a project session's run input includes the project's notes/refs;
the summary call uses the identical assembler.

**Validate** — unit-test the assembler; `npm start` and confirm (via a logged
input or a mock-harness echo) that notes/refs reach the run.

---

## M-D3 — Generate + persist summary, next steps, freshness stamp (was M5.3)

**Goal.** Wire the provider to a project; persist `summary`, `nextSteps`, and
`summarySynthesizedAtMs`; bind the Overview to real data.

**Files**
- `~ packages/core/src/ipc.ts` (`project:resynthesize`)
- `~ packages/core/src/domain.ts` (add `summarySynthesizedAtMs?: number` to `Project`)
- `+ packages/main/src/ipc/handlers/intelligence.ts` (`registerIntelligenceHandlers`)
- `~ packages/main/src/modules/IpcModule.ts` (register; construct the provider)
- `~ packages/main/src/repo/JsonRepository.ts` (persist the new field)
- `~ packages/renderer/src/lib/...` + `src/shell/...` (bind Overview summary /
  next-steps to persisted values; compute "synthesized Xm ago" from
  `summarySynthesizedAtMs` using the existing `lib/format/time.ts` helper; add a
  manual "Re-synthesize" trigger). Pass the data through props — do **not** edit
  `OverviewTab.tsx`'s hardcoded string in place beyond reading a prop.

**Steps**
1. `project:resynthesize` → `assembleProjectContext` → `summarizeProject` →
   persist summary/steps/timestamp → `emit("data:changed", …)` (and a granular
   `project:<id>:changed` if you add one).
2. Bind the Overview to the persisted values + relative stamp.

**Acceptance** — clicking re-synthesize updates the summary + steps + stamp and
persists across restart.

**Validate** — `npm start` (opencode configured): re-synthesize a project, confirm
the narrative + timestamp change; restart to confirm persistence.

---

## M-D4 — Triggers: on-demand, on-activity debounce, daily (was M5.4)

**Goal.** Keep summaries current automatically without hammering the provider.

**Files**
- `+ packages/main/src/intelligence/Scheduler.ts`
- `~ packages/main/src/ipc/handlers/writes.ts` (notify scheduler on activity)

**Steps**
1. Debounced re-synthesis: on project activity (session done, PR opened, note
   changed), schedule after a quiet period (2–5 min), coalescing bursts.
2. Daily synthesis: a timer re-synthesizes active projects once/day and appends a
   `summary` activity item ("Daily summary generated — …").
3. Respect the `autoSynthesizeOnActivity` / `intelligenceEnabled` toggles
   (currently inert) + a cost guardrail (max re-syntheses/hour).

**Acceptance** — finishing a session triggers a debounced re-synthesis; the daily
tick produces a summary activity entry; toggles actually gate the behavior.

**Validate** — `npm start`: complete a session, wait for the debounce, see the
summary refresh + activity entry; force the daily path via a dev trigger.

---

## M-D5 — Reference ingestion + one-line summaries (was M5.5)

**Goal.** Adding a reference derives a one-line summary — the "indexed by the
agent" promise (currently cosmetic).

**Files**
- `~ packages/core/src/ipc.ts` (`refs:ingest`)
- `+ packages/main/src/intelligence/ingestReference.ts`
- `~ packages/main/src/ipc/handlers/writes.ts` (on `refs:upsert`, kick ingestion)
- (Optional) `+ packages/main/src/forge/fetchUrl.ts` (fetch URL/PR/doc snippet;
  reuse the Workstream B forge for PR URLs)

**Steps**
1. On reference add, infer `kind` from the URL (pr/doc/link/issue), fetch a
   snippet where feasible (octokit for PRs; a guarded fetch for docs/links), then
   `summarizeReference` → store the one-line `summary`.
2. Emit change so the References tab updates (it already renders
   `reference.summary`).

**Acceptance** — pasting a PR/doc URL yields a kind badge + a persisted one-line
summary.

**Validate** — `npm start`: add a GitHub PR URL and a doc URL; confirm kind +
summary appear and persist.

---

## Definition of done (Workstream D)
- [ ] Project summaries + next-steps are LLM-generated via opencode and persisted.
- [ ] The Overview shows a real freshness stamp; "Re-synthesize" works.
- [ ] Notes + references flow into every agent run via the shared assembler.
- [ ] References get real one-line summaries; the Settings toggles gate behavior.
- [ ] `IntelligenceProvider` is the only synthesis seam (SDK swap stays one file).
- [ ] `npm run validate` + `npm run screenshot` pass; new IPC typed in `core`.

## Dependencies
- **After Workstream A** (reuses the opencode server/SDK helper + supervisor).
- Pairs with Workstream B (reference ingestion can reuse the forge for PR URLs).
- The shared context assembler (M-D2) is what fulfills "agents inherit notes/refs."
