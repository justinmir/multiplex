# Workstream B — Finish the Forge (live PRs, reviews, checks, actions)

> **Hand this whole file to the implementing agent.** It is self-contained.
> Companion docs: `docs/plans/implementation-plan.md` (Phase 4 is the source of
> these milestones), `AGENTS.md`, `docs/plans/workstream-a-agent-harness.md`.

---

## Prompt to the agent

You are completing the **GitHub forge integration** for Multiplex. A read/sync/
merge slice already exists, but the session's **Changes / Reviews / Checks rails
are still fed by seed mock data** — the GitHub sync only maps PR *summaries*, and
the PR action buttons either do nothing or feed the agent instead of GitHub.

Your job: put a `ForgeService` interface in front of the existing GitHub code,
make PR detail (files, review comments, check runs) **live**, and make the PR
action affordances real — reply, ask-agent / address-all, re-run checks, merge,
and open draft PRs from a session.

**Multi-repo, behind the scenes.** A session can touch many repos (Workstream C:
each touched repo gets its own worktree on the session branch, materialized
lazily when the agent declares it — the engineer never picks repos). So "open a
PR from a session" is inherently **fan-out**: one draft PR per *touched* repo that
has changes, all linked back to the one session. `Session.linkedPRs` is already an
array; treat the worktree/branch as already existing (Workstream C created it when
the agent first touched the repo) — you only push and open.

**Hard rules (from `AGENTS.md`):**
- Gate after every milestone: `npm run validate` + `npm run screenshot`.
- No new code in `packages/renderer/src/app/**` (Figma-synced). The rails already
  render `FileChange[]`, `ReviewComment[]`, `CheckRun[]`, and the PR action
  buttons — wire them from `src/lib`/`src/shell`, don't fork them.
- New IPC channels are typed in `packages/core/src/ipc.ts`. Secrets (GitHub
  token) stay in main, never logged, never sent to the renderer.

**Current relevant state (read before starting):**
- GitHub client: `packages/main/src/git/GitHubClient.ts` (octokit), auth in
  `GitHubAuth.ts`, token/connection state in `ConfigStore.ts`.
- Mapper: `packages/main/src/git/GitHubMapper.ts` — **only maps PR summary
  fields** (`additions`, `deletions`, `mergeable`, status). It does **NOT**
  populate `files`, `comments`, or `checkRuns`. This is the core gap.
- Sync: `packages/main/src/git/SyncService.ts` (`syncProject` pulls PRs per
  configured repo into the store).
- Existing channels (`packages/core/src/ipc.ts`): `prs:list`, `checks:get`,
  `projects:sync`, `prs:merge`, `github:get-token|connect|get-status`,
  `app:open-url`.
- Rails: `packages/renderer/src/app/components/SessionDetail.tsx`
  (`OverviewRail`/`ChangesRail`/`ReviewsRail`/`ChecksRail`) consume
  `session.linkedPRs[].files|comments|checkRuns`.
- Dead/incorrect actions today: **"Reply"**, **"Address all"**, **"Ask agent"**
  call `onSendMessage` (→ the agent), not GitHub; **"Re-run"** checks button has
  no handler; **Merge** works via `prs:merge`.
- `PullRequest`, `FileChange`, `ReviewComment`, `CheckRun` shapes live in
  `packages/core/src/domain.ts` — map into these exactly.

Work the milestones in order.

---

## M-B1 — `ForgeService` interface + refactor GitHub behind it (was M4.1)

**Goal.** Abstract the forge so GitHub is swappable and the rest of the app
depends on an interface, not octokit.

**Files**
- `+ packages/core/src/forge.ts` (interface + input types)
- `~ packages/core/src/index.ts` (export it)
- `~ packages/main/src/git/GitHubClient.ts` (implement the interface, or wrap it
  in `+ packages/main/src/forge/GitHubForgeService.ts`)
- `~ packages/main/src/git/GitHubMapper.ts` (extend to full PR detail — see M-B2)

**Interface (implement verbatim):**
```ts
import type { PullRequest, FileChange, ReviewComment, CheckRun } from "./domain.js";

export interface OpenPRInput {
  repo: string; title: string; head: string; base?: string; body?: string; draft?: boolean;
}
export interface ForgeService {
  openDraftPR(p: OpenPRInput): Promise<PullRequest>;
  getPR(repo: string, number: number): Promise<PullRequest>;
  listPRFiles(repo: string, number: number): Promise<FileChange[]>;
  listReviewComments(repo: string, number: number): Promise<ReviewComment[]>;
  listCheckRuns(repo: string, number: number): Promise<CheckRun[]>;
  replyToComment(repo: string, number: number, commentId: string, body: string): Promise<void>;
  rerunChecks(repo: string, number: number): Promise<void>;
  merge(repo: string, number: number): Promise<void>;
}
```
Auth: reuse `ConfigStore` token; fall back to `gh auth token` if the CLI is
present. Never log tokens.

**Validate** — `npm run typecheck`; existing `prs:list`/`prs:merge` still work.

---

## M-B2 — Map full PR detail (files, comments, checks) (was M4.3, mapper half)

**Goal.** Make `GitHubMapper` + the forge populate `files`, `comments`, and
`checkRuns` on `PullRequest`, so the rails show real data instead of seed mock.

**Files**
- `~ packages/main/src/git/GitHubMapper.ts`
- `~ packages/main/src/git/SyncService.ts` (call the new list endpoints during sync)

**Steps**
1. `listPRFiles` → octokit `pulls.listFiles` → `FileChange[]`
   (`path, additions, deletions, hunk` from `patch`, `kind` from `status`).
2. `listReviewComments` → combine `pulls.listReviewComments` (inline) +
   `issues.listComments` (general) + `pulls.listReviews` (verdicts) → `ReviewComment[]`
   (`author, kind, verdict, body, path, line, ts, resolved, replies`).
3. `listCheckRuns` → `checks.listForRef` (+ optionally commit statuses) →
   `CheckRun[]` (`name, status, conclusion, durationSec, detail`). Map GitHub
   conclusions to the `CheckRun.status` union precisely.
4. `getPR` returns the full bundle; `SyncService.syncProject` persists files/
   comments/checkRuns onto each `linkedPR`.

**Acceptance** — after a sync, opening Changes/Reviews/Checks for a session with a
real PR shows live files, comments, and CI runs (not seed data).

**Validate** — `npm start` against a throwaway repo with an open PR; sync; confirm
the rails match GitHub.

---

## M-B3 — PR detail IPC + on-demand/poll refresh (was M4.3, wiring half)

**Goal.** Expose PR detail to the renderer and keep it fresh.

**Files**
- `~ packages/core/src/ipc.ts` (`pr:get` bundle, or `pr:files`/`pr:comments`/`pr:checks`)
- `+ packages/main/src/ipc/handlers/pr.ts` (`registerPrHandlers`, delegate to forge)
- `~ packages/main/src/modules/IpcModule.ts` (register it; construct the forge)
- `+ packages/renderer/src/lib/pr/usePr.ts` (fetch on rail open; refresh on events)
- `+ packages/main/src/forge/poll.ts` (poll open PRs ~30s; `emit("pr:"+repo+"#"+n+":changed")`)

**Steps**
1. Handlers delegate to `ForgeService`; cache + poll while a PR is open, emitting
   a change topic so rails refresh (reuse the `emit`/`on` pattern from
   Workstream A / `DataProvider`).
2. `usePr` fetches when the Changes/Reviews/Checks tab opens and on the change
   topic; feeds the aggregated arrays the rails already render.

**Acceptance** — review comments / CI added on GitHub appear in the app without a
manual refresh.

**Validate** — `npm start`: add a review comment on GitHub, watch it appear; let
CI run, watch checks update.

---

## M-B4 — PR actions: reply, ask-agent/address-all, re-run, merge (was M4.4)

**Goal.** The action affordances already in the UI do real things.

**Files**
- `~ packages/core/src/ipc.ts` (`pr:reply`, `pr:rerun`; `prs:merge` exists;
  `session:addressComments`)
- `~ packages/main/src/ipc/handlers/pr.ts`
- `~ packages/renderer/src/shell/AppShell.tsx` + `src/lib` (re-wire the rail
  callbacks; **stop** routing Reply/Address-all to the agent by default)
- `~ packages/main/src/session/SessionRuntime.ts` (from Workstream A) for
  `session:addressComments` — re-enter the harness with comment context

**Steps**
1. `pr:reply` → `forge.replyToComment`; `pr:rerun` → `forge.rerunChecks`;
   `pr:merge` keeps the existing `canMerge` gate (clean + approved + checks green
   + not merged).
2. **Ask agent / Address all:** package the selected review comment(s) into a new
   harness turn (`session:addressComments` → `SessionRuntime.sendMessage` with the
   comments as context); refresh the PR after the agent pushes follow-up changes.
   Keep these distinct from a plain GitHub "Reply".

**Acceptance** — Reply posts to GitHub; Re-run triggers CI; Merge merges (gated);
"Address all" produces agent follow-up commits on the PR branch.

**Validate** — `npm start` against a throwaway repo: exercise each action; verify
on GitHub.

---

## M-B5 — Open draft PR(s) from a session — fan-out across touched repos (was M4.2)

**Goal.** A single "Open PR" action pushes **each touched repo's** session branch
and opens one draft PR per repo that has changes; `linkedPRs` (an array) persists
all of them, linked to the one session.

> The worktrees and the session branch already exist — Workstream C created a
> worktree per repo the agent declared, on a shared session branch. This milestone
> only **pushes and opens**. Repos the agent never touched have no worktree and so
> produce no PR; touched repos with no diff are skipped (`git.hasChanges` is
> false).

**Files**
- `~ packages/core/src/ipc.ts` (`session:openPR` → returns the list of opened PRs)
- `+ packages/main/src/git/push.ts` (token-authenticated `git push`)
- `~ packages/main/src/session/SessionRuntime.ts` (iterate the session's
  materialized `workspaces`; push + `forge.openDraftPR` per repo with changes)
- `~ packages/renderer/src/shell/...` (wire a single "Open PR" affordance in
  OverviewRail; it represents the whole session, not a per-repo choice)

**Steps**
1. For each materialized `Workspace` on the session where `git.hasChanges` is true:
   push its session branch to origin (token remote or `gh`), then
   `forge.openDraftPR({ repo, head: sessionBranch, base: defaultBranch, draft: true })`.
2. Append every opened PR to `session.linkedPRs`; emit a `pr` activity item per PR.
   The Overview rail lists all of them under the session (the engineer sees "this
   session opened N PRs", not the worktrees behind them).
3. Skip repos with no changes; surface a clear result if **no** repo had changes
   ("nothing to open a PR for yet").
4. Cross-PR relationships (a session spanning dependent repos) are informational
   for now — record them as activity, don't try to order merges.

**Acceptance** — for a session that edited two repos, "Open PR" pushes both
session branches and creates two draft PRs visible on GitHub and listed together
in the Overview rail; a session that edited one repo opens exactly one.

**Validate** — `npm start` against throwaway repo(s): run a task that touches one
repo, open a PR, confirm on GitHub and in the rail; then a task that touches two,
confirm two PRs under the one session.

---

## Definition of done (Workstream B)
- [ ] Changes/Reviews/Checks rails show **live** GitHub data (no seed fallback).
- [ ] Reply / Re-run / Merge act on GitHub; Address-all re-enters the agent.
- [ ] A session can fan out draft PRs — one per *touched* repo with changes — all
      linked to the one session; `linkedPRs` persists and drives status.
- [ ] GitHub is behind `ForgeService` (swappable).
- [ ] `npm run validate` + `npm run screenshot` pass; new IPC typed in `core`.

## Dependencies
- **After Workstream A** (PR-driven status & "address comments" re-enter the
  runtime).
- **M-B5 needs Workstream C** — it pushes each materialized worktree's session
  branch (one per repo the agent touched) to open a PR. M-B1–M-B4 do not.
- Live PR detail here makes M6.1 `deriveSessionStatus` operate on real signals
  aggregated across **all** of a session's PRs.
