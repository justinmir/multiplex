# Workstream C — Git: invisible per-repo worktrees + real diffs

> **Hand this whole file to the implementing agent.** It is self-contained.
> Companion docs: `docs/plans/implementation-plan.md` (Phase 3 is the source of
> these milestones), `AGENTS.md`, `docs/plans/workstream-a-agent-harness.md`.

---

## Prompt to the agent

You are giving Multiplex sessions a **real working directory** — and making
**git worktrees a pure implementation detail the engineer never sees or picks**.

The model (read this twice, the whole workstream depends on it):

- **Every session always runs in worktrees.** A session is never pointed at a
  bare repo checkout; it works in managed, throwaway worktrees on a per-session
  branch.
- **A session may touch many repos. Each touched repo gets its own worktree.**
  This is a **many-to-one** relationship: *many repos, each with its own
  worktree → one session.*
- **The engineer does not choose repos.** There is **no repo/branch picker** in
  the composer. Repos are **agent-declared and lazily materialized**: the agent,
  in the course of working, declares "I need to work in repo X"; at that moment
  (first touch) the system creates a worktree for X on the session's branch,
  under the session's workspace root, and hands the path back. Repos the agent
  never touches never get a worktree, a branch, or a PR.

So a session has a **workspace root directory** (`cwd` for the harness), and
under it, **zero or more per-repo worktrees** that appear as the agent declares
them. The user sees none of this plumbing — they see streamed work and, later,
real diffs grouped by repo.

Today the harness (Workstream A) runs with an abstract `cwd`, the composer's
"repos & branches" button is dead, and the Changes rail shows seed mock diffs.
There is a `GitService` in `packages/core/src/git.ts` with a `LocalGitService`
impl — but it is **read-only** (branches/status/latest-commit) and **completely
unwired** (no IPC handler references it; it is effectively dead code).

Your job: extend git into a worktree-capable service, register a **catalog** of
local repos the agent may draw from, give each session a workspace root, let the
agent **declare** repos so each materializes its own worktree on first touch, and
show real diffs (across every materialized worktree) in the Changes rail.

**Hard rules (from `AGENTS.md`):**
- Gate after every milestone: `npm run validate` + `npm run screenshot`.
- No new code in `packages/renderer/src/app/**` (Figma-synced). The `ChangesRail`
  already exists — back it from `src/lib`/`src/shell`.
- **Do NOT wire a composer repo/branch picker.** Worktrees and repo selection are
  plumbing; the engineer must not need to know which repos a session touches.
  If anything, the composer's dead "repos & branches" affordance is **removed**,
  not wired.
- New IPC channels typed in `packages/core/src/ipc.ts`. Only non-interactive git
  plumbing (no `-i` flags — unsupported in this environment).
- This workstream **extends the Workstream A `Harness` interface** (host-executed
  tools + an available-repo catalog on `HarnessRunInput`). Those additions are
  called out in M-C3 — coordinate with whoever owns Workstream A; the interface
  lives in `packages/core/src/harness/types.ts`.

**Current relevant state (read before starting):**
- `packages/core/src/git.ts` — `GitService` is read-only
  (`getBranches`, `status`, latest commit). `LocalGitService`
  (`packages/main/src/git/LocalGitService.ts`) implements it via `spawnSync` but
  is unwired. **Extend this**, don't start from scratch.
- `AppSettingsData.repoRoots: { name; root }[]` already exists in
  `packages/core/src/ipc.ts` and persists via `packages/main/src/settings/AppSettings.ts`;
  `SettingsPanel.tsx` lists/removes roots but there's no add/validate flow.
- `Workspace` (`{ repo; branch; worktree? }`) and `FileChange`
  (`{ path; additions; deletions; hunk; kind }`) live in
  `packages/core/src/domain.ts` — map into these exactly. In the new model
  `Session.workspaces` is populated **by the system as repos materialize**, not by
  the user; treat `worktree` as set once materialized.
- Session start lives in `SessionRuntime` (Workstream A); it currently passes a
  `cwd`. `StartSessionReq.workspaces` (from Workstream A, M-A4) is **no longer
  supplied by the composer** — drop it from the request or ignore it; workspaces
  come from declaration, not selection.

Work the milestones in order.

---

## M-C1 — Worktree-capable `GitService` + `LocalGitService` (was M3.1)

**Goal.** Add worktree create/remove, status, diff, and base-branch resolution to
the git service.

**Files**
- `~ packages/core/src/git.ts` (extend the interface)
- `~ packages/main/src/git/LocalGitService.ts` (implement the new methods)
- `+ packages/main/src/git/exec.ts` (promisified `execFile("git", …)` with
  timeout + stderr capture; migrate `LocalGitService` off `spawnSync` for the
  async ops)
- `+ packages/main/src/git/LocalGitService.test.ts` (`node --test`)

**Interface additions (implement verbatim):**
```ts
export interface GitService {
  // existing read-only methods stay…
  createWorktree(repoRoot: string, branch: string, baseBranch?: string): Promise<{ worktreePath: string }>;
  removeWorktree(worktreePath: string): Promise<void>;
  diff(worktreePath: string): Promise<FileChange[]>; // git diff → FileChange[]
  currentBranch(worktreePath: string): Promise<string>;
  defaultBranch(repoRoot: string): Promise<string>;   // base for new session branches
  hasChanges(worktreePath: string): Promise<boolean>; // any tracked/untracked changes
  listBranches(repoRoot: string): Promise<string[]>;
}
```

**Steps**
1. `createWorktree` → `git worktree add <path> -b <branch> [<base>]`. The caller
   (M-C3) supplies `<path>` under the session workspace root and a session branch
   name; `<base>` defaults to `defaultBranch(repoRoot)` when omitted.
2. `removeWorktree` → `git worktree remove --force` (and prune).
3. `diff` → `git diff --numstat` (+ untracked via `--no-index`/`status`) and
   per-file `git diff` hunks, mapped to `FileChange` (`kind` from status letters
   A/M/D/R).
4. `defaultBranch` → resolve `origin/HEAD` (fallback to `main`/`master`/current
   HEAD) so a session branch always has a sane base.
5. `hasChanges` → cheap `git status --porcelain` check (drives "which repos get a
   PR" in Workstream B).
6. Handle defensively: repos with no commits, detached HEAD, dirty worktrees.

**Acceptance** — unit test against a temp git repo: create a worktree on a new
branch, write a file, `diff()` returns the change in `FileChange` shape and
`hasChanges()` is true.

**Validate** — `npm --workspace @app/main run test` + `npm run typecheck`.

---

## M-C2 — Repo catalog (registry of available repos — **no picker**) (was M3.2)

**Goal.** Maintain a validated **catalog** of local repos the agent may draw
from. This is *not* a per-session picker — it is the set of repos that exist on
this machine, registered once in Settings, that a session's agent can later
**declare** (M-C3).

**Files**
- `~ packages/core/src/ipc.ts` (`repos:list`, `repos:add`, `repos:remove`)
- `+ packages/main/src/git/RepoRegistry.ts` (persist roots in settings; validate
  each is a git repo via `git rev-parse` on add; resolve a repo identifier → root)
- `+ packages/main/src/ipc/handlers/repos.ts` (`registerRepoHandlers`)
- `~ packages/main/src/modules/IpcModule.ts` (register it)
- `+ packages/renderer/src/lib/repos/useRepos.ts`
- `~ packages/renderer/src/shell/SettingsPanel.tsx` (add a **validated add-root**
  flow; keep list/remove)
- **Removed, not added:** any composer "repos & branches" picker. If the dead
  affordance is still present in a synced component, leave the component alone but
  do **not** wire a handler to it.

**Steps**
1. `repos:add` validates the path is a git repo before persisting to
   `settings.repoRoots`. `repos:list` returns the roots. `repos:remove` drops one.
2. `RepoRegistry.resolve(repo)` maps a repo identifier (the `Workspace.repo`
   string / `Project.repos[]` entry) to a local root, so M-C3 can materialize a
   worktree from a declared repo. Define the identifier convention here (e.g. the
   registered `name`, or `owner/name`) and use it consistently.
3. Settings is the **only** place repos are registered. Sessions never present
   this list to the engineer as a choice.

**Acceptance** — add a repo root (validated); it appears in Settings and is
resolvable by identifier. No session-creation UI references repos.

**Validate** — `npm start`: add a repo in Settings, see it listed; confirm the
composer has **no** repo/branch selection.

---

## M-C3 — Session workspace + lazy, agent-declared per-repo worktrees (was M3.3)

**Goal.** Every session gets a workspace root; the harness runs there; and the
agent **declares** repos as it works, each declaration materializing a worktree
on first touch. This is the core of the rework.

**Files**
- `~ packages/core/src/harness/types.ts` (**Workstream A interface** — extend it;
  see below)
- `+ packages/main/src/session/WorkspaceManager.ts` (owns the session workspace
  root + per-repo worktree materialization via `GitService`)
- `~ packages/main/src/session/SessionRuntime.ts` (create the workspace root;
  set `cwd` to it; provide the `open_repo` host tool + the available-repo catalog;
  persist `Workspace`s as they materialize)
- `~ packages/main/src/harness/opencode/OpencodeHarness.ts` (run scoped to the
  workspace root; surface host tools to opencode; route their invocation back to
  the handler)
- `~ packages/main/src/harness/MockHarness.ts` (call a host tool in its scripted
  run so the path is testable without opencode)

**Interface additions (extends Workstream A's `HarnessRunInput`):**
```ts
/** A tool the agent can invoke whose execution is handled in main (the host),
 *  not by the model. The result is returned to the agent AND surfaced as a
 *  tool_use/tool_result pair in the transcript. */
export interface HostTool {
  name: string;                          // e.g. "open_repo"
  description: string;                   // shown to the agent
  inputSchema: Record<string, unknown>;  // JSON schema for the args
  handler: (input: unknown) => Promise<{ content: string; isError?: boolean }>;
}

export interface HarnessRunInput {
  // …existing fields…
  cwd: string;                 // now the SESSION WORKSPACE ROOT (not a worktree)
  availableRepos: string[];    // repo identifiers the agent may declare (the catalog)
  tools?: HostTool[];          // host-executed tools surfaced to the agent
}
```

**Steps**
1. **Workspace root.** On `startSession`, `WorkspaceManager` creates a managed
   root dir keyed by session (e.g. `<userData>/multiplex/sessions/<sessionId>/`).
   `HarnessRunInput.cwd = <that root>`. `workspaces` starts **empty**.
2. **Catalog in.** Populate `availableRepos` from `RepoRegistry` (all registered
   repos; for a project-scoped session, you may order/limit to `Project.repos`
   first as a hint — but the agent may still declare any registered repo).
3. **Declare → materialize (first touch).** Provide an `open_repo` host tool:
   ```
   open_repo({ repo: string }) →
     1. resolve root via RepoRegistry; if unknown → { isError, "unknown repo" }
     2. if already materialized for this session → return existing worktree path (idempotent)
     3. else git.createWorktree(root, sessionBranch, defaultBranch) under <root>/<repo>/
     4. record Workspace { repo, branch: sessionBranch, worktree } on the session (repo.upsertSession)
     5. emit a `workspace` HarnessEvent (runtime already persists/forwards it)
     6. return the worktree path as the tool result
   ```
   The agent calls this the first time it needs a repo; the worktree exists only
   from that point. `sessionBranch` is deterministic (e.g.
   `multiplex/<short-session-id>`), shared across that session's repos.
4. **Opencode wiring (spike-gated).** The opencode adapter must surface
   `HarnessRunInput.tools` to the running agent and route invocations back to
   `handler`. **Spike first** (extend `harness/opencode/SPIKE.md`): confirm how
   opencode registers a host/custom tool and delivers its result. **Fallback if
   host tools aren't supported:** intercept opencode's file/bash tool calls and,
   the first time the agent accesses a path under `<root>/<knownRepo>/`,
   materialize that repo's worktree then — same "first touch" semantics without an
   explicit tool. Pick whichever the spike proves; document the choice.
5. **MockHarness** calls `open_repo` in its scripted run (so M-C4 and tests see a
   materialized worktree without opencode).
6. **Cleanup.** On archive/delete, `WorkspaceManager` may `removeWorktree` each
   materialized worktree and drop the session branch — gated by a setting, **keep
   by default** so users can inspect / open PRs.

**Acceptance** — starting a session creates only a workspace root (no worktrees).
When the agent declares a repo, a branch + worktree appear under the root, its
edits land there, and `Session.workspaces` gains exactly that repo. A second
declared repo adds a second worktree; an undeclared repo gets nothing.

**Validate** — `npm start`: run a task that edits one registered repo; confirm a
single worktree on the session branch exists on disk with the change, and the
session shows one workspace. Run a task spanning two repos; confirm two worktrees,
two entries, one shared branch name.

---

## M-C4 — Changes rail: real diffs across every materialized worktree (was M3.4)

**Goal.** The session's Changes rail shows actual file diffs from **all** of the
session's materialized worktrees, grouped by repo, with working +/− and
expandable hunks. Empty until the agent has touched a repo.

**Files**
- `~ packages/core/src/ipc.ts` (`session:changes` → per-repo `FileChange[]`)
- `+ packages/main/src/ipc/handlers/changes.ts` (`git.diff` per materialized workspace)
- `~ packages/main/src/modules/IpcModule.ts` (register it)
- `+ packages/renderer/src/lib/session/useChanges.ts`
- (No `ChangesRail` edits — it already renders `FileChange[]` grouped by repo.)

**Steps**
1. Handler iterates the session's `workspaces` (the materialized ones), returns
   `git.diff(worktree)` for each, tagged by repo, in `FileChange` shape. Before
   any repo is declared, it returns empty (the rail shows its existing empty
   state).
2. Renderer fetches when the Changes tab opens and after agent turns (subscribe to
   the session event topic from Workstream A — including the `workspace` event so
   a newly materialized repo appears); refresh on file-changing events.

**Acceptance** — after the agent edits files in one or more repos, the Changes tab
lists them grouped by repo with diffs matching `git -C <worktree> diff` for each.

**Validate** — `npm start`: run a multi-repo edit task, open Changes, compare each
repo group to terminal `git diff` in the corresponding worktree.

---

## Definition of done (Workstream C)
- [ ] Every session runs in a workspace root; worktrees are created **only** for
      repos the agent declares (lazy, first-touch), each on the session branch.
- [ ] Repos are a registered **catalog**, not a per-session choice; the composer
      has **no** repo/branch picker.
- [ ] `Session.workspaces` is populated by the system as repos materialize; the
      Changes rail shows real diffs from every materialized worktree.
- [ ] The old read-only `LocalGitService` is extended (not left as dead code).
- [ ] The `Harness` interface gains host tools + an available-repo catalog
      (coordinated with Workstream A); MockHarness exercises the path.
- [ ] `npm run validate` + `npm run screenshot` pass; new IPC typed in `core`.

## Dependencies
- **After Workstream A** (`SessionRuntime` + `HarnessRunInput`; this workstream
  extends that interface with host tools + the repo catalog).
- **Feeds Workstream B** (M-B5 pushes each materialized worktree's branch — which
  already exists from the moment the agent declared the repo — to open one draft
  PR per touched repo).
