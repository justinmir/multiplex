# Multiplex — Implementation Plan (Front-end → Complete)

> **Purpose.** This is the build plan for taking Multiplex from a mock-data
> front-end to a working, project-centric AI development environment. It is
> written to be executed by lower-capability models: every milestone names exact
> files, exact signatures, exact steps, and an exact way to validate before
> moving on. **Do the milestones in order. Do not skip the validation step.**
>
> Companion docs: `docs/product-description.md` (what we're building and why),
> `AGENTS.md` (repo conventions and commands).

---

## 0. How to use this document

### 0.1 Reading model
- The plan is grouped into **Phases** (big themes) → **Milestones** (small,
  independently shippable units). Each milestone is sized to be **one PR / one
  sitting** and ends with a concrete **Validation** you can run.
- Every milestone has the same shape:
  - **Goal** — one sentence.
  - **Why** — what it unlocks.
  - **Files** — exact paths to create (`+`) or edit (`~`).
  - **Steps** — numbered, literal instructions.
  - **Interfaces** — TypeScript signatures to implement verbatim where given.
  - **Acceptance** — checklist of observable outcomes.
  - **Validate** — commands to run + manual checks. **Must pass before next.**
  - **Risks / notes** — gotchas specific to this repo.

### 0.2 The universal validation gate
After **every** milestone, run, from the repo root:

```sh
npm run validate      # typecheck + lint (0 errors) + build all 3+ packages
npm run screenshot    # boots the real Electron app headless; fails on console errors
```

`npm run validate` and `npm run screenshot` are the non-negotiable gate
(`AGENTS.md`). `npm run e2e` / `npm run compile` are heavier; run them only where
a milestone explicitly says so. Warnings are acceptable baseline noise; **new
errors are not**.

If a milestone adds backend logic that can't be seen on screen yet, it must add
either a **unit test** (run with the package's `test` script) or a temporary
**dev IPC probe** wired to a button, so "Validate" is always a real check, not a
guess.

### 0.3 Conventions to follow (from `AGENTS.md`)
- Node ≥ 23. `.npmrc` has `legacy-peer-deps=true` — keep it; never run a bare
  `npm install` that drops it.
- The renderer's `src/app/**` is **Figma-synced** and may be overwritten by a
  future re-sync. **All new renderer logic goes outside `src/app/**`** (in
  `src/lib/**` and `src/shell/**`). The only edit we make inside `src/app` is to
  `data/mockData.ts`, and we make it sync-safe (see M0.1).
- Dark theme is default; tokens live in `src/styles/theme.css`.
- Renderer ESLint is relaxed (warnings ok); `tsconfig.app.json` is relaxed.

---

## 1. Target architecture (read once, refer back)

### 1.1 Process / package layout
```
packages/
  core/        ← NEW. Pure-TS shared package: domain types, IPC contracts,
                 the Harness interface, error types. No electron/node-only deps
                 in its public types. Imported by main, preload, and renderer.
  main/        ← Electron main process. Owns: persistence (Repository),
                 harness processes, git, forge (GitHub), intelligence (LLM),
                 and the IPC router that exposes all of it.
  preload/     ← Generic typed bridge: invoke(channel,payload) + event subscribe.
                 Edited ONCE (M0.3), then stable forever.
  renderer/    ← React UI.
    src/app/**     ← Figma-synced presentational components (treat as read-only
                     except data/mockData.ts).
    src/lib/**     ← NEW. IPC client, typed hooks, stores, harness client, format
                     helpers. Owned by us; never overwritten.
    src/shell/**   ← NEW. The real application shell that wires presentational
                     components to live data (replaces the mock App.tsx wiring).
    src/main.tsx   ← renderer entry (NOT synced); mounts <AppShell/> in providers.
```

### 1.2 The dependency rule (keep it clean)
```
renderer ──imports──▶ core         (types, contracts, harness interface)
preload  ──imports──▶ core         (channel names + payload types only)
main     ──imports──▶ core         (everything)
renderer ─NEVER────▶ main          (only via preload IPC)
core     ──imports──▶ (nothing app-specific; no electron, no node fs in public API)
```
Anything heavy (git, octokit, anthropic, child_process, db) lives **only in
main**. The renderer reaches it through typed IPC. This is what makes the harness
(and everything else) pluggable and testable.

### 1.3 The four main-process services (all behind interfaces)
| Service | Interface (in `core`) | First impl (in `main`) | Swappable later |
| --- | --- | --- | --- |
| Persistence | `Repository` | `JsonRepository` | `SqliteRepository` |
| Agent harness | `Harness` + `HarnessFactory` | `MockHarness`, then `OpencodeHarness` | `ClaudeHarness`, `CodexHarness` |
| Git / worktrees | `GitService` | `LocalGitService` (spawns `git`) | isomorphic-git, etc. |
| Forge (PRs/reviews/checks) | `ForgeService` | `GitHubForgeService` (octokit) | GitLab, etc. |
| Intelligence (summaries) | `IntelligenceProvider` | `AnthropicIntelligence` | any LLM |

> **The harness is the keystone.** Build the interface (M2.1) and a `MockHarness`
> (M2.2) **before** touching opencode, so the whole session pipeline can be
> validated deterministically. Real harnesses (opencode first, then claude/codex)
> are drop-in implementations selected by config.

### 1.4 IPC shape (one pattern for everything)
- **Request/response:** `invoke<C>(channel, payload) → Promise<result>` (Electron
  `ipcRenderer.invoke` / `ipcMain.handle`).
- **Server→client streaming:** main emits topic'd events on a single channel
  `multiplex:event`; renderer subscribes by topic (e.g. `session:<id>:delta`).
- Channels + payload/return types are declared **once** in `core` so renderer and
  main can't drift.

### 1.5 Data model source of truth
The domain types already exist in `packages/renderer/src/app/data/mockData.ts`
(`Project`, `Session`, `SessionStatus`, `Note`, `Reference`, `PullRequest`,
`FileChange`, `ReviewComment`, `CheckRun`, `Workspace`, `SessionMsg`,
`ActivityItem`, `Reference`, `bucketForSession`, `sessionWindowLabels`). **M0.1
moves these type definitions into `@app/core` and re-exports them from
`mockData.ts`** so existing components keep compiling unchanged. The mock arrays
stay in `mockData.ts` and become the **first-run seed**.

---

## 2. Milestone map (the whole plan at a glance)

```
PHASE 0  Foundations & seams (no behavior change)
  M0.1  Create @app/core; move domain types there; mockData re-exports
  M0.2  Define IPC channel contracts in core (no handlers yet)
  M0.3  Generic typed preload bridge (invoke + subscribe) — edit preload ONCE
  M0.4  Main-side IPC router skeleton + ping handler
  M0.5  Renderer IPC client + useIpc hook + ping smoke button
  M0.6  Renderer data layer seam: DataProvider backed by mock (UI unchanged)
  M0.7  AppShell in src/shell wired from DataProvider; main.tsx mounts it

PHASE 1  Persistence (read, then write)
  M1.1  Repository interface in core + in-memory ref impl
  M1.2  JsonRepository in main (userData), seeded from mock on first run
  M1.3  IPC read handlers (projects/sessions/notes/refs) + wire JsonRepository
  M1.4  DataProvider reads from IPC (replace mock import); loading states
  M1.5  Write path: create/update/archive note, reference, session metadata
  M1.6  Activity log writes + project lastActivity recompute

PHASE 2  Harness abstraction (the keystone)
  M2.1  Harness interface + event/types + registry/factory + config (no impl)
  M2.2  MockHarness (deterministic streaming) + unit test
  M2.3  SessionRuntime service in main: create→stream→persist→emit
  M2.4  IPC for sessions: start, sendMessage, stop, subscribe to deltas
  M2.5  Renderer: live session view + composer wired to runtime (MockHarness)
  M2.6  OpenCode harness: spike, process supervisor, adapter, event mapping
  M2.7  Concurrency, lifecycle, crash recovery for harness processes
  M2.8  Harness selection in Settings (opencode default; mock for dev)

PHASE 3  Workspaces & Git
  M3.1  GitService interface + LocalGitService (clone-aware, worktrees)
  M3.2  Repo registry (configured repo roots) + repo/branch picker data
  M3.3  Session→workspace creation; harness runs in the worktree
  M3.4  Changes rail: real diffs from the worktree

PHASE 4  Forge: PRs, reviews, checks
  M4.1  ForgeService interface + GitHubForgeService (auth, rate-limit safe)
  M4.2  Open draft PR(s) from a session; persist linkedPRs
  M4.3  PR sync: files, review comments, check runs → rails
  M4.4  PR actions: reply, ask-agent/address-all, re-run checks, merge

PHASE 5  Project intelligence (LLM)
  M5.1  IntelligenceProvider interface + AnthropicIntelligence (streaming)
  M5.2  Context assembly (notes + refs + state) — the R-INTEL-5 contract
  M5.3  Generate summary + next steps; persist with freshness stamp
  M5.4  Triggers: on-demand button, on-activity debounce, daily synthesis
  M5.5  Reference ingestion + one-line summaries

PHASE 6  Status model, triage, realtime, search, settings
  M6.1  Derive SessionStatus from real signals (review/checks/mergeable/input)
  M6.2  Realtime fan-out so Home/Project update live; triage ordering on live data
  M6.3  Global search (⌘K) over real data
  M6.4  Settings surface (harness, tokens, model defaults, repo roots)

PHASE 7  Hardening & ship
  M7.1  Error/empty/reconnect states across surfaces
  M7.2  SqliteRepository behind Repository (optional swap) + migration
  M7.3  e2e (Playwright) for core flows; packaging smoke; auto-update sanity
```

Roughly 45 fine-grained milestones. Each is independently validatable.

---

# PHASE 0 — Foundations & seams

Goal of the phase: introduce the shared package, the IPC pipe, and a clean
renderer data seam **without changing what the user sees**. After Phase 0 the app
looks identical but is wired to flow data through real boundaries.

---

## M0.1 — Create `@app/core`; move domain types; make `mockData` a re-export

**Goal.** A new pure-TS workspace package holding the domain model, importable by
all three existing packages.

**Why.** Main (backend) and renderer (frontend) must share one type definition of
`Project`, `Session`, etc., serialized across IPC.

**Files**
- `+ packages/core/package.json`
- `+ packages/core/tsconfig.json`
- `+ packages/core/vite.config.ts`
- `+ packages/core/src/index.ts` (barrel)
- `+ packages/core/src/domain.ts` (the moved types)
- `~ packages/renderer/src/app/data/mockData.ts` (re-export types from core; keep seed arrays)
- `~ package.json` (root: nothing required—workspaces already globs `packages/*`)
- `~ packages/renderer/package.json` (add `"@app/core": "*"` to dependencies)
- `~ packages/main/package.json` (add `"@app/core": "*"` to dependencies)
- `~ packages/preload/package.json` (add `"@app/core": "*"` to devDependencies)

**Steps**
1. Create `packages/core/package.json` mirroring the preload package's resolution
   pattern so types resolve to source and runtime to built output:
   ```json
   {
     "name": "@app/core",
     "type": "module",
     "scripts": { "build": "vite build", "typecheck": "tsc --noEmit" },
     "exports": {
       ".": { "types": "./src/index.ts", "default": "./dist/index.js" }
     },
     "devDependencies": { "typescript": "6.0.2", "vite": "8.0.3" }
   }
   ```
2. `packages/core/vite.config.ts`: library build emitting `dist/index.js` (ESM),
   `lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' }`,
   `build.target: 'es2022'`. No externals needed (pure types + a few constants).
3. Move the **type/interface/`type` declarations and the pure helpers**
   (`SessionWindow`, `bucketForSession`, `sessionWindowLabels`, `ago` if you want
   it shared) from `mockData.ts` into `packages/core/src/domain.ts`. Export them.
   Keep `ago`/seed arrays in `mockData.ts` if they reference `Date.now()` at
   module load (seed concern, not a shared concern).
4. `packages/core/src/index.ts`: `export * from './domain.js';`
5. Rewrite the **top** of `mockData.ts` so component imports stay valid:
   ```ts
   export type {
     ProjectStatus, PRStatus, SessionStatus, ReferenceKind, Reference,
     FileChange, ReviewComment, CheckRun, PullRequest, Workspace, SessionMsg,
     Session, Note, ActivityItem, Project, SessionWindow,
   } from "@app/core";
   export { bucketForSession, sessionWindowLabels } from "@app/core";
   ```
   Leave the `projects`, `standaloneSessions` arrays below as-is. Components that
   do `import { Project } from "../data/mockData"` keep working untouched.
6. Add `@app/core` to the three packages' manifests (see Files). Run
   `npm install --legacy-peer-deps` once to link the workspace.

**Acceptance**
- `npm run typecheck` passes across core, main, preload, renderer.
- No renderer component file other than `mockData.ts` changed.

**Validate**
```sh
npm install --legacy-peer-deps
npm run validate
npm run screenshot   # UI must be byte-identical to before
```

**Risks / notes**
- Don't put `electron`, `node:fs`, etc. into `core`'s public types — it's imported
  by the browser renderer. Keep it pure.
- If Vite can't resolve `@app/core` source in the renderer dev build, confirm the
  `exports.types` points at `./src/index.ts` (matches preload's working pattern).

---

## M0.2 — Declare IPC channel contracts in `core`

**Goal.** One typed catalog of every IPC channel, its request payload, and its
response — shared by preload, main, and renderer.

**Why.** Prevents drift; lets low-thinking edits be "fill in the handler for this
typed channel."

**Files**
- `+ packages/core/src/ipc.ts`
- `~ packages/core/src/index.ts` (export `./ipc.js`)

**Steps**
1. Define a channel map and a topic'd-event map:
   ```ts
   // packages/core/src/ipc.ts
   export const EVENT_CHANNEL = "multiplex:event" as const;

   /** Request/response channels. Add one entry per feature. */
   export interface IpcContract {
     "app:ping": { req: { value: string }; res: { value: string; ts: number } };
     // Phase 1+ entries appended here as we go, e.g.:
     // "projects:list": { req: void; res: Project[] };
   }
   export type IpcChannel = keyof IpcContract;
   export type IpcReq<C extends IpcChannel> = IpcContract[C]["req"];
   export type IpcRes<C extends IpcChannel> = IpcContract[C]["res"];

   /** Server→client push events. Topic is a runtime string; payloads typed by prefix. */
   export interface AppEvent<T = unknown> { topic: string; payload: T; ts: number; }
   ```
2. Export from the barrel.

**Acceptance** — types compile; nothing wired yet.

**Validate** — `npm run typecheck`. (No screenshot change.)

**Notes** — Every later phase **appends** entries to `IpcContract`. That is the
single place to look for "what can the renderer call."

---

## M0.3 — Generic typed preload bridge (edit preload ONCE)

**Goal.** Expose exactly two capabilities to the renderer: `invoke` and event
`subscribe`. After this, preload never needs editing again.

**Why.** The current preload exposes ad-hoc functions via `btoa(name)`. A single
generic bridge means new features only touch `core` (contract) + `main` (handler)
+ `renderer` (call site).

**Files**
- `~ packages/preload/src/index.ts`
- `~ packages/preload/package.json` (already added `@app/core` in M0.1)

**Steps**
1. Replace the preload exports with a single `ipc` object (keep existing
   `sha256sum`/`versions` if other code relies on them; they're harmless):
   ```ts
   // packages/preload/src/index.ts
   import { ipcRenderer } from "electron";
   import { EVENT_CHANNEL } from "@app/core";

   function invoke(channel: string, payload: unknown): Promise<unknown> {
     return ipcRenderer.invoke(channel, payload);
   }

   /** Subscribe to a topic. Returns an unsubscribe fn. */
   function subscribe(topic: string, cb: (payload: unknown) => void): () => void {
     const listener = (_e: unknown, evt: { topic: string; payload: unknown }) => {
       if (evt.topic === topic || topic === "*") cb(evt.payload);
     };
     ipcRenderer.on(EVENT_CHANNEL, listener as any);
     return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener as any);
   }

   export const ipc = { invoke, subscribe };
   ```
2. The existing `exposed.ts` enumerates exports and calls
   `contextBridge.exposeInMainWorld(btoa(key), value)`. `ipc` becomes available in
   the renderer via `import { ipc } from "@app/preload"` (the template rewires
   imports through the bridge). Keep that mechanism.

**Acceptance** — preload builds; `ipc.invoke` and `ipc.subscribe` are importable.

**Validate**
```sh
npm run build      # preload + main + renderer build
npm run screenshot # still boots
```

**Risks / notes**
- `sandbox:false` is already set in `WindowManager.ts`, so preload may use
  `ipcRenderer`. Do **not** flip `nodeIntegration` on.
- Only **serializable** data crosses IPC (structured clone). No functions, class
  instances, Dates-as-objects → use ISO strings / numbers.

---

## M0.4 — Main-side IPC router skeleton + `app:ping`

**Goal.** A tiny router in main that registers `ipcMain.handle` for typed
channels, plus an event emitter helper. Implement `app:ping`.

**Files**
- `+ packages/main/src/ipc/router.ts`
- `+ packages/main/src/ipc/emit.ts`
- `+ packages/main/src/modules/IpcModule.ts`
- `~ packages/main/src/index.ts` (register the module)

**Steps**
1. `router.ts`: a `registerHandler<C>(channel, fn)` wrapper and a `registerAll()`
   that wires every handler. Type it against `IpcContract`:
   ```ts
   import { ipcMain } from "electron";
   import type { IpcChannel, IpcReq, IpcRes } from "@app/core";
   export function handle<C extends IpcChannel>(
     channel: C, fn: (req: IpcReq<C>) => Promise<IpcRes<C>> | IpcRes<C>,
   ) {
     ipcMain.handle(channel, (_e, payload) => fn(payload as IpcReq<C>));
   }
   ```
2. `emit.ts`: broadcast an `AppEvent` to all windows:
   ```ts
   import { BrowserWindow } from "electron";
   import { EVENT_CHANNEL } from "@app/core";
   export function emit(topic: string, payload: unknown) {
     const evt = { topic, payload, ts: Date.now() };
     for (const w of BrowserWindow.getAllWindows())
       if (!w.isDestroyed()) w.webContents.send(EVENT_CHANNEL, evt);
   }
   ```
3. `IpcModule.ts`: an `AppModule` (implements `enable(ctx)`) that calls
   `handle("app:ping", (req) => ({ value: req.value, ts: Date.now() }))` plus a
   `registerAllHandlers()` you'll grow each phase.
4. In `packages/main/src/index.ts`, add `.init(createIpcModule())` to the module
   runner chain (follow the existing `.init(...)` style).

**Acceptance** — app boots; `app:ping` handler registered.

**Validate** — `npm run screenshot` (boot, no console errors). Real ping check
happens in M0.5.

**Notes** — Keep `IpcModule` the single registration point; later milestones add
`repo.registerHandlers()`, `sessions.registerHandlers()`, etc., called from here.

---

## M0.5 — Renderer IPC client + `useIpc` + a dev ping button

**Goal.** Typed renderer wrapper over `ipc.invoke`/`subscribe`, proven with a
round-trip.

**Files**
- `+ packages/renderer/src/lib/ipc/client.ts`
- `+ packages/renderer/src/lib/ipc/useIpc.ts`
- `+ packages/renderer/src/lib/dev/PingProbe.tsx` (temporary; removed in M0.7)
- `~ packages/renderer/src/main.tsx` (mount `<PingProbe/>` temporarily)

**Steps**
1. `client.ts`:
   ```ts
   import { ipc } from "@app/preload";
   import type { IpcChannel, IpcReq, IpcRes } from "@app/core";
   export function call<C extends IpcChannel>(c: C, req: IpcReq<C>): Promise<IpcRes<C>> {
     return ipc.invoke(c, req) as Promise<IpcRes<C>>;
   }
   export function on(topic: string, cb: (p: unknown) => void) {
     return ipc.subscribe(topic, cb);
   }
   ```
2. `useIpc.ts`: small hooks — `useInvoke(channel, req, deps)` returning
   `{data, loading, error}` and `useSubscribe(topic, cb)` cleaning up on unmount.
3. `PingProbe.tsx`: a button that calls `call("app:ping", {value:"hi"})` and
   renders the echoed value+ts. Mount it in `main.tsx` for now.

**Acceptance** — clicking the probe shows the echoed payload from main.

**Validate**
```sh
npm start   # dev mode; click the ping button; confirm round-trip
npm run validate
```

**Notes** — `@app/preload` import in the renderer is the supported pattern; if TS
can't find `ipc`, ensure preload's `exports` exposes the type (it points at
`src/index.ts`).

---

## M0.6 — Renderer data layer seam (`DataProvider`, mock-backed)

**Goal.** A React context that supplies all app data through a `DataSource`
interface, initially backed by the existing mock arrays. UI unchanged.

**Why.** Decouples components from `mockData` imports so M1.4 can swap the source
to IPC with zero component edits.

**Files**
- `+ packages/renderer/src/lib/data/types.ts` (the `DataSource` interface)
- `+ packages/renderer/src/lib/data/MockDataSource.ts`
- `+ packages/renderer/src/lib/data/DataProvider.tsx` (context + hooks)

**Steps**
1. `types.ts` — read-only surface for now (writes added in M1.5):
   ```ts
   import type { Project, Session } from "@app/core";
   export interface DataSource {
     listProjects(): Promise<Project[]>;
     getProject(id: string): Promise<Project | null>;
     listStandaloneSessions(): Promise<Session[]>;
     getSession(id: string): Promise<Session | null>;
   }
   ```
2. `MockDataSource.ts` — implement `DataSource` by reading the arrays from
   `../../app/data/mockData` (allowed: lib may import from app, not vice-versa).
3. `DataProvider.tsx` — a context exposing the loaded `projects` and
   `standaloneSessions` plus `refresh()`. Hooks: `useProjects()`,
   `useProject(id)`, `useStandaloneSessions()`, `useSession(id)`. Accept the
   `DataSource` as a prop (`<DataProvider source={...}>`), default to MockDataSource.

**Acceptance** — provider compiles and returns the same data the mock arrays held.

**Validate** — `npm run typecheck`. (Visible only after M0.7.)

---

## M0.7 — `AppShell` (real wiring) replaces mock `App.tsx`; remove ping probe

**Goal.** A non-synced shell that renders the presentational components
(`ProjectsSidebar`, `HomeView`, `ProjectView`, `SessionDetail`/`TaskView`) using
`DataProvider` hooks. `main.tsx` mounts `<DataProvider><AppShell/></DataProvider>`.

**Why.** Moves the integration root out of the Figma-synced `src/app` so we can
evolve wiring freely; the app now renders from the data seam.

**Files**
- `+ packages/renderer/src/shell/AppShell.tsx`
- `~ packages/renderer/src/main.tsx` (mount AppShell in providers; drop PingProbe)
- `- packages/renderer/src/lib/dev/PingProbe.tsx` (delete)

**Steps**
1. Port the view-switching logic from `src/app/App.tsx` into
   `shell/AppShell.tsx`, but source data from `useProjects()/useStandaloneSessions()`
   instead of importing mock arrays. Reuse the existing components and their props
   exactly (they already accept `projects`, `project`, `session`, `prs`, etc.).
2. Keep `src/app/App.tsx` on disk (unused) so a future Figma re-sync still has a
   reference; AppShell is what runs.
3. `main.tsx`: wrap with providers (later phases add more providers around it).

**Acceptance**
- App renders Home/Project/Session exactly as the mock did, now via DataProvider.
- `src/app` is unchanged except `data/mockData.ts`.

**Validate**
```sh
npm run validate
npm run screenshot     # compare against the original 7 mockups; parity expected
```

**Phase 0 exit criteria** — identical UX, but data flows: component → DataProvider
→ DataSource; renderer ↔ main IPC pipe proven. Nothing real persists yet.

---

# PHASE 1 — Persistence

Goal: data comes from disk in `main`, survives restart, and is editable.

---

## M1.1 — `Repository` interface + in-memory reference impl

**Goal.** Define the storage contract once; provide an in-memory impl for tests.

**Files**
- `+ packages/core/src/repository.ts`
- `~ packages/core/src/index.ts`
- `+ packages/main/src/repo/InMemoryRepository.ts`

**Steps**
1. `repository.ts` — CRUD covering the model (start read + the writes Phase 1
   needs; extend later):
   ```ts
   import type { Project, Session, Note, Reference, ActivityItem } from "./domain.js";
   export interface Repository {
     // projects
     listProjects(): Promise<Project[]>;
     getProject(id: string): Promise<Project | null>;
     upsertProject(p: Project): Promise<Project>;
     // sessions (standalone = projectId null)
     listSessions(opts?: { projectId?: string | null }): Promise<Session[]>;
     getSession(id: string): Promise<Session | null>;
     upsertSession(s: Session, projectId: string | null): Promise<Session>;
     // notes / references scoped to a project
     upsertNote(projectId: string, n: Note): Promise<Note>;
     deleteNote(projectId: string, noteId: string): Promise<void>;
     upsertReference(scope: RefScope, r: Reference): Promise<Reference>;
     deleteReference(scope: RefScope, refId: string): Promise<void>;
     // activity
     appendActivity(projectId: string, a: ActivityItem): Promise<void>;
   }
   export type RefScope = { projectId: string } | { sessionId: string };
   ```
2. `InMemoryRepository.ts` — Map-backed impl, used by unit tests and as the base
   class JsonRepository can wrap (load → mutate maps → persist).

**Acceptance** — compiles; a unit test can exercise CRUD.

**Validate**
```sh
npm run typecheck
# add packages/main test runner if absent (node:test is fine) and run it
```

---

## M1.2 — `JsonRepository` (userData-backed), first-run seed

**Goal.** Durable JSON store under Electron `userData`, seeded from the mock data
on first launch.

**Files**
- `+ packages/main/src/repo/JsonRepository.ts`
- `+ packages/main/src/repo/seed.ts`
- `+ packages/main/src/repo/paths.ts`

**Steps**
1. `paths.ts` — resolve `app.getPath("userData")/multiplex/db.json`.
2. `JsonRepository.ts` — load JSON into in-memory maps on construct; every
   mutating method writes the whole file (atomic: write temp + rename). Good
   enough at this scale; M7.2 swaps to SQLite behind the same interface.
3. `seed.ts` — on first run (file missing), import the seed arrays. **Important:**
   the seed currently lives in the renderer's `mockData.ts`. Copy the seed JSON
   into `packages/main/src/repo/seed.ts` as a plain data module (main must not
   import from renderer). One-time copy; keep them in sync only until real data
   exists.
4. Normalize relative timestamps (`"2h ago"`) into stored absolute fields where
   the model needs them (`createdAtMs` already exists; add `updatedAtMs` if
   needed). Keep display-string fields as the repository returns them for now;
   M6 can compute relative strings in the renderer.

**Acceptance** — on first boot, `db.json` is created with seed content.

**Validate**
```sh
npm start
# confirm <userData>/multiplex/db.json exists with projects/sessions
```

**Risks** — write-whole-file is fine now; never block the main thread on a huge
file (the seed is small). Guard against corrupt JSON (try/parse → fall back to
seed + back up the bad file).

---

## M1.3 — IPC read handlers + wire `JsonRepository`

**Goal.** Expose repository reads over IPC.

**Files**
- `~ packages/core/src/ipc.ts` (add read channels)
- `+ packages/main/src/ipc/handlers/repo.ts`
- `~ packages/main/src/modules/IpcModule.ts` (register repo handlers, construct repo)

**Steps**
1. Add to `IpcContract`:
   ```ts
   "projects:list": { req: void; res: Project[] };
   "projects:get": { req: { id: string }; res: Project | null };
   "sessions:list": { req: { projectId?: string | null }; res: Session[] };
   "sessions:get": { req: { id: string }; res: Session | null };
   ```
   (Import `Project`/`Session` into `ipc.ts`.)
2. Construct a single `JsonRepository` instance in `IpcModule` (or a small
   `Services` container) and register handlers delegating to it.

**Acceptance** — calling `projects:list` from the renderer returns seeded data.

**Validate** — temporary: log results from a dev call, or jump straight to M1.4
and verify visually.

---

## M1.4 — `IpcDataSource` replaces mock in `DataProvider`

**Goal.** UI now renders data fetched from disk via IPC; add loading/empty states.

**Files**
- `+ packages/renderer/src/lib/data/IpcDataSource.ts`
- `~ packages/renderer/src/main.tsx` (pass `IpcDataSource` to `DataProvider`)
- `~ packages/renderer/src/lib/data/DataProvider.tsx` (expose `loading`/`error`)

**Steps**
1. `IpcDataSource` implements `DataSource` via `call("projects:list", ...)` etc.
2. Swap the provider's source. Add minimal loading skeletons (reuse the existing
   `ui/skeleton.tsx`) and error fallback text. Empty-state copy already exists in
   the components.

**Acceptance**
- App shows the same content as before, now sourced from `db.json`.
- Edit `db.json` by hand (change a project name) → restart → change appears.

**Validate**
```sh
npm run validate
npm run screenshot
npm start   # hand-edit db.json, restart, confirm change
```

---

## M1.5 — Write path: notes, references, session metadata

**Goal.** Create/update/delete notes & references, archive sessions — persisted.

**Files**
- `~ packages/core/src/ipc.ts` (write channels)
- `~ packages/core/src/repository.ts` (already has the methods)
- `+ packages/main/src/ipc/handlers/writes.ts`
- `~ packages/renderer/src/lib/data/types.ts` + `IpcDataSource.ts` (write methods)
- `~ packages/renderer/src/lib/data/DataProvider.tsx` (mutations + optimistic update + refresh)
- `~ packages/renderer/src/shell/AppShell.tsx` (pass handlers into components where they already expect them — e.g. `onAddReference`, note create)

**Steps**
1. Add channels: `notes:upsert`, `notes:delete`, `refs:upsert`, `refs:delete`,
   `sessions:archive`, each `{req,res}` typed.
2. Handlers delegate to repo and then `emit("data:changed", {kind, id})`.
3. Renderer mutation hooks call the channel, optimistically update context state,
   then `refresh()` on confirmation; on error, roll back and toast (sonner is
   available).
4. Wire to existing component props: the Figma components already render
   "+ New note", "+ Add reference", archive affordances and accept callbacks.

**Acceptance**
- Create a note in the UI → restart → it persists.
- Add a reference → persists. Archive a session → it moves to Archived bucket and
  persists.

**Validate**
```sh
npm run validate && npm run screenshot
npm start   # create note, add ref, archive session; restart; verify persistence
```

---

## M1.6 — Activity log writes + `lastActivity` recompute

**Goal.** Mutations append `ActivityItem`s; project `lastActivity`/counters reflect
reality.

**Files**
- `~ packages/main/src/ipc/handlers/writes.ts` (append activity on each write)
- `+ packages/main/src/repo/derive.ts` (recompute `openPRs`, `activeSessions`, `lastActivity`)
- `~ packages/main/src/repo/JsonRepository.ts` (call derive on read or write)

**Steps**
1. On note/ref/session writes, append an `ActivityItem` to the project.
2. `derive.ts` computes `activeSessions` (running/attention sessions), `openPRs`,
   and `lastActivity` from session/PR timestamps; apply when returning a project.

**Acceptance** — Overview "Recent activity" shows new events; counters update.

**Validate** — `npm start`, perform writes, observe the Overview activity feed and
project row counters change; restart to confirm persistence.

**Phase 1 exit criteria** — full read/write persistence behind `Repository`,
surfaced through typed IPC and the data seam. Still no agent.

---

# PHASE 2 — Harness abstraction (the keystone)

Goal: a pluggable agent backend. Build the interface + a MockHarness, prove the
entire session pipeline, then drop in opencode.

---

## M2.1 — `Harness` interface, event types, registry/factory, config

**Goal.** Define the pluggable agent contract and a factory that selects an
implementation by id (`"mock" | "opencode" | "claude" | "codex"`).

**Why.** Everything agent-related depends on this; getting it right makes
opencode/claude/codex interchangeable.

**Files**
- `+ packages/core/src/harness/types.ts`
- `+ packages/core/src/harness/registry.ts`
- `~ packages/core/src/index.ts`

**Steps**
1. `types.ts` — the contract. Design it around *capabilities the UI needs*: start
   a run from a prompt, stream typed events, send a follow-up, stop, report
   status, expose workspaces/PRs it touched.
   ```ts
   import type { SessionMsg, Workspace } from "../domain.js";

   export type HarnessId = string; // "mock" | "opencode" | "claude" | "codex"

   export interface HarnessRunInput {
     sessionId: string;            // our id, used to correlate events
     prompt: string;
     model?: string;               // harness-specific model id; optional
     cwd: string;                  // working directory / worktree root
     workspaces: Workspace[];      // repos+branches in scope
     references?: { title: string; url?: string; body?: string }[]; // context
     notes?: { title: string; body: string }[];                    // context
   }

   /** Normalized stream events every harness must emit. */
   export type HarnessEvent =
     | { type: "status"; status: HarnessStatus }
     | { type: "message"; role: SessionMsg["role"]; content: string; final?: boolean }
     | { type: "message_delta"; role: "agent"; delta: string }
     | { type: "tool_use"; name: string; input: unknown; id: string }
     | { type: "tool_result"; id: string; content: string; isError?: boolean }
     | { type: "usage"; tokens?: number; costUsd?: number; durationMs?: number }
     | { type: "workspace"; workspace: Workspace }                 // discovered/created
     | { type: "pr"; repo: string; number: number; url?: string }  // opened
     | { type: "awaiting_input"; question?: string }
     | { type: "error"; message: string; recoverable?: boolean }
     | { type: "done"; reason: "completed" | "failed" | "stopped" };

   export type HarnessStatus =
     | "starting" | "running" | "awaiting_input" | "completed" | "failed" | "stopped";

   /** A live run. Implementations stream events to onEvent until done. */
   export interface HarnessRun {
     readonly sessionId: string;
     send(message: string): Promise<void>;   // follow-up turn
     stop(): Promise<void>;
     dispose(): void;
   }

   export interface Harness {
     readonly id: HarnessId;
     /** Start a run; events flow to onEvent. Resolves with a handle. */
     start(input: HarnessRunInput, onEvent: (e: HarnessEvent) => void): Promise<HarnessRun>;
     /** Optional: probe availability/version for Settings. */
     health(): Promise<{ ok: boolean; version?: string; detail?: string }>;
   }

   export interface HarnessConfig {
     id: HarnessId;
     /** Free-form per-harness options (binary path, port, model defaults...). */
     options?: Record<string, unknown>;
   }
   export interface HarnessFactory {
     create(config: HarnessConfig): Harness;
     supports(id: HarnessId): boolean;
   }
   ```
2. `registry.ts` — a registry mapping `HarnessId` → constructor, with
   `registerHarness(id, ctor)` and `createHarness(config)`. This is the plug point.

**Acceptance** — types compile; no implementation yet.

**Validate** — `npm run typecheck`.

**Design notes (important for extensibility)**
- The interface is **event-normalized**: opencode, Claude Agent SDK, and Codex all
  produce assistant text, tool calls, and status — we map each into
  `HarnessEvent`. New harnesses implement `Harness` + register; nothing else
  changes.
- Keep harness-specific concepts (opencode session ids, Claude message blocks) out
  of `core`. They live inside each adapter.

---

## M2.2 — `MockHarness` (deterministic streaming) + unit test

**Goal.** A fake harness that simulates a realistic run (status → streamed agent
text → a tool call → usage → done), with timers, so the whole pipeline is
testable without external processes.

**Files**
- `+ packages/main/src/harness/MockHarness.ts`
- `+ packages/main/src/harness/index.ts` (register `"mock"`)
- `+ packages/main/src/harness/MockHarness.test.ts`

**Steps**
1. Implement `Harness` for id `"mock"`. On `start`, emit:
   `status:starting → status:running → message_delta×N (a canned answer) →
   tool_use → tool_result → usage → message(final) → done:completed`, spaced by
   small `setTimeout`s. `send()` emits another short streamed reply. `stop()`
   emits `done:stopped`.
2. Register in `index.ts` via `registerHarness("mock", ...)`.
3. Unit test: collect events into an array, assert ordering and final state.

**Acceptance** — test passes; events arrive in the documented order.

**Validate**
```sh
npm --workspace @app/main run test   # or: node --test on the compiled output
npm run typecheck
```

---

## M2.3 — `SessionRuntime` service: create → stream → persist → emit

**Goal.** The main-process orchestrator that owns live runs: creates a harness
run, persists messages/usage as events arrive, and forwards normalized events to
the renderer over IPC.

**Files**
- `+ packages/main/src/session/SessionRuntime.ts`
- `+ packages/main/src/session/statusMap.ts` (HarnessStatus → SessionStatus)
- `~ packages/main/src/modules/IpcModule.ts` (construct runtime with repo+factory)

**Steps**
1. `SessionRuntime` holds `Map<sessionId, HarnessRun>` and exposes:
   `startSession(input) → sessionId`, `sendMessage(sessionId, text)`,
   `stopSession(sessionId)`.
2. On each `HarnessEvent`:
   - persist: append to `session.messages`, update `tokens`/`cost`/`durationMin`,
     update `status` (via `statusMap`), set `workspaces`/`linkedPRs` when reported.
   - emit topic'd events: `emit("session:"+id+":event", harnessEvent)` and a
     coarse `emit("session:"+id+":status", status)`.
3. `statusMap.ts`: `running→running`, `awaiting_input→awaiting_input`,
   `completed→completed`, `failed→failed`, `stopped→idle` (or `completed`). Later
   (M6.1) status is refined by PR/check signals.

**Acceptance** — starting a mock session persists a transcript and emits events.

**Validate** — unit test the runtime against MockHarness (assert repo gets the
final transcript; assert events were emitted via a stubbed `emit`).

---

## M2.4 — IPC for sessions: start / send / stop / subscribe

**Goal.** Expose `SessionRuntime` to the renderer.

**Files**
- `~ packages/core/src/ipc.ts`
- `+ packages/main/src/ipc/handlers/session.ts`
- `~ packages/main/src/modules/IpcModule.ts`

**Steps**
1. Channels:
   ```ts
   "session:start": { req: StartSessionReq; res: { sessionId: string } };
   "session:send":  { req: { sessionId: string; message: string }; res: void };
   "session:stop":  { req: { sessionId: string }; res: void };
   ```
   where `StartSessionReq = { prompt: string; projectId?: string|null; model?: string; workspaces?: Workspace[] }`.
2. Handlers delegate to runtime. Event topics already emitted in M2.3
   (`session:<id>:event`).

**Acceptance** — renderer can start a session and receive its event stream.

**Validate** — temporary dev probe or proceed to M2.5 for the visual check.

---

## M2.5 — Renderer: live session view + composer wired to runtime

**Goal.** "Start session" and "Send" actually run an agent (MockHarness), and the
conversation streams into `SessionDetail`/`TaskView` live.

**Files**
- `+ packages/renderer/src/lib/session/useSessionStream.ts`
- `~ packages/renderer/src/shell/AppShell.tsx` (replace mock `createSession`)
- (No edits inside `src/app` components: they already render `session.messages`,
  the "agent is thinking…" state, the composer, and the Stop button.)

**Steps**
1. `useSessionStream(sessionId)` — subscribes to `session:<id>:event`, accumulates
   `message_delta` into the latest agent message, flips status, and exposes the
   live `Session` shape the components expect.
2. In `AppShell`, `createSession(prompt)` now calls `call("session:start", ...)`,
   opens the session view, and feeds it via `useSessionStream`. Composer "Send"
   calls `session:send`; the Stop button calls `session:stop`.
3. **Stream-first ordering:** subscribe to the topic *before* invoking
   `session:start` (mirrors the SSE stream-first rule) so no early events are lost.

**Acceptance**
- Click a starter prompt → session opens → tokens stream in → status transitions
  to completed → transcript persists (visible after restart).
- "Needs Input" path: MockHarness can emit `awaiting_input`; the session shows the
  warning state and a reply re-runs it.

**Validate**
```sh
npm run validate && npm run screenshot
npm start   # start a session, watch streaming, stop, restart to confirm persistence
```

**Risks** — accumulate deltas idempotently; dedupe if both `message_delta` and a
final `message` arrive (use the `final` flag to replace the accumulated text).

---

## M2.6 — OpenCode harness: spike, supervisor, adapter, event mapping

**Goal.** Implement `Harness` for id `"opencode"` by driving a local opencode
server, mapped into `HarnessEvent`s.

**Files**
- `+ packages/main/src/harness/opencode/OpencodeHarness.ts`
- `+ packages/main/src/harness/opencode/server.ts` (spawn/supervise the process)
- `+ packages/main/src/harness/opencode/map.ts` (opencode events → HarnessEvent)
- `+ packages/main/src/harness/opencode/SPIKE.md` (record verified API surface)
- `~ packages/main/src/harness/index.ts` (register `"opencode"`)
- `~ packages/main/package.json` (add the opencode SDK dep if used)

**Steps**
1. **Spike first (do not skip).** Install/locate opencode. Start its headless
   server (`opencode serve`-style) and confirm, with a throwaway script, the exact
   surface for: create session, send a prompt, subscribe to the event stream, and
   abort. Write the verified method names, event payload shapes, and the
   model-selection mechanism into `SPIKE.md`. **The adapter is written against
   what you verify here, not from memory.**
   - Prefer the official SDK (`@opencode-ai/sdk`, `createOpencodeClient({baseUrl})`
     and/or a `createOpencodeServer` helper) if present in the installed version;
     otherwise spawn the binary and talk to its HTTP/SSE endpoints. Pin the
     opencode version in `SPIKE.md`.
2. `server.ts` — start `opencode serve` on an ephemeral port scoped to `cwd`,
   parse the chosen port/URL, health-check it, expose `stop()`. One server may be
   reused across sessions or one-per-session; start with **one per session** for
   isolation (revisit in M2.7).
3. `map.ts` — translate opencode's stream (assistant message parts, tool calls,
   tool results, session-idle/done, errors, usage) into `HarnessEvent`s. Map
   opencode "session idle awaiting user" → `awaiting_input`; terminal → `done`.
4. `OpencodeHarness.ts` — implement `start/send/stop/health` using server.ts +
   map.ts. `health()` checks the binary/SDK is present and returns its version.
5. Register `"opencode"`.

**Acceptance**
- With the harness id set to `"opencode"`, starting a session runs a **real**
  opencode agent and streams its output into the UI; stop aborts it.
- `health()` reports the installed opencode version.

**Validate**
```sh
npm run validate
npm start   # set harness=opencode (M2.8 adds the UI; until then set via config/env),
            # start a trivial task ("create a file hello.txt with 'hi'"), watch it stream,
            # confirm the working dir shows the change
```

**Risks / notes**
- Treat exact opencode endpoint/method names as **unverified until the spike** —
  the adapter must be the only place that knows them, so version drift is a
  one-file fix.
- Process hygiene: kill the server on app quit and on session dispose; never leak
  child processes (register in M2.7's supervisor).
- Provider keys/models: opencode manages its own provider config; surface the
  model id through `HarnessRunInput.model` and document required env/config in
  `SPIKE.md`.

---

## M2.7 — Concurrency, lifecycle, crash recovery

**Goal.** Run multiple sessions at once; clean up processes; recover gracefully.

**Files**
- `+ packages/main/src/harness/Supervisor.ts` (tracks child processes/runs)
- `~ packages/main/src/session/SessionRuntime.ts` (use supervisor; mark orphans)
- `~ packages/main/src/index.ts` (kill all on `before-quit`)

**Steps**
1. `Supervisor` registers every spawned process/run and force-kills on app quit
   and on dispose; caps concurrent runs (configurable) and queues beyond the cap.
2. On startup, any session left in `running` in the repo (from a crash) is marked
   `failed`/`idle` with a note ("interrupted — restart the session"). No
   resurrection of dead child processes.
3. Surface harness errors as `error` events → session status `failed` with the
   message preserved in the transcript.

**Acceptance** — start 3 sessions; all stream; quitting the app kills every child
process (verify no orphaned `opencode` processes). A simulated crash leaves no
session stuck "running" after restart.

**Validate**
```sh
npm start   # launch 3 sessions, check process list, quit, re-check no orphans
```

---

## M2.8 — Harness selection in Settings

**Goal.** Choose the active harness (and per-harness options) at runtime; default
`opencode`, with `mock` available for dev.

**Files**
- `~ packages/core/src/ipc.ts` (`settings:get`, `settings:set`)
- `+ packages/main/src/settings/Settings.ts` (persisted via Repository or a small settings file)
- `+ packages/renderer/src/lib/settings/useSettings.ts`
- `+ packages/renderer/src/shell/SettingsPanel.tsx` (mounted from the sidebar footer gear, which already exists)

**Steps**
1. Persist `{ harness: HarnessConfig, modelDefaults, repoRoots, tokens... }`.
   `SessionRuntime` reads the active `HarnessConfig` from settings when starting.
2. Settings panel: a harness dropdown (mock/opencode; claude/codex appear as they
   land), a "Test connection" button calling `harness.health()`, and model
   defaults.

**Acceptance** — switching harness in Settings changes which backend new sessions
use; "Test connection" reports health.

**Validate** — `npm start`: toggle mock↔opencode, start a session under each.

**Phase 2 exit criteria** — sessions are real and pluggable. opencode is the
default; mock remains for tests. Adding `claude`/`codex` later = one adapter file
+ one `registerHarness` call + a dropdown entry.

---

# PHASE 3 — Workspaces & Git

Goal: sessions operate in real repos/worktrees; the Changes rail shows real diffs.

---

## M3.1 — `GitService` interface + `LocalGitService`

**Goal.** Abstract git operations (worktree create/remove, branch, status, diff)
behind an interface; implement by spawning `git`.

**Files**
- `+ packages/core/src/git.ts` (interface + types)
- `+ packages/main/src/git/LocalGitService.ts`
- `+ packages/main/src/git/exec.ts` (spawn helper)

**Steps**
1. Interface:
   ```ts
   export interface GitService {
     createWorktree(repoRoot: string, branch: string, baseBranch?: string): Promise<{ worktreePath: string }>;
     removeWorktree(worktreePath: string): Promise<void>;
     status(worktreePath: string): Promise<GitFileStatus[]>;
     diff(worktreePath: string): Promise<GitFileDiff[]>; // maps to FileChange[]
     currentBranch(worktreePath: string): Promise<string>;
     listBranches(repoRoot: string): Promise<string[]>;
   }
   ```
2. `exec.ts` — promisified `child_process.execFile("git", args, {cwd})` with
   timeouts and stderr capture.
3. `LocalGitService` — implement using `git worktree add/remove`, `git status
   --porcelain`, `git diff --numstat` + per-file hunks, mapped to the existing
   `FileChange` shape (`path, additions, deletions, hunk, kind`).

**Acceptance** — unit test against a temp git repo: create worktree, write a file,
`diff()` returns the change in `FileChange` shape.

**Validate**
```sh
npm --workspace @app/main run test   # git integration test on a tmp repo
```

**Risks** — interactive git flags are unavailable in this environment; use only
non-interactive plumbing. Handle repos with no commits, detached HEAD, and dirty
worktrees defensively.

---

## M3.2 — Repo registry + repo/branch picker data

**Goal.** Users register local repo roots; the composer's "repos & branches"
picker is backed by real data.

**Files**
- `~ packages/core/src/ipc.ts` (`repos:list`, `repos:add`, `repos:branches`)
- `+ packages/main/src/git/RepoRegistry.ts` (persist repo roots in settings)
- `+ packages/renderer/src/lib/repos/useRepos.ts`
- `~ packages/renderer/src/shell/...` (wire the existing "repos & branches" button)

**Steps**
1. Persist a list of `{ name, root }` repo roots. Validate each is a git repo on
   add (`git rev-parse`).
2. `repos:branches` returns `listBranches(root)`.
3. The composer already renders a "repos & branches" affordance; back it with a
   small picker populated from `useRepos()`.

**Acceptance** — add a repo root; it appears in the picker with its branches.

**Validate** — `npm start`: add a repo, open the picker, see branches.

---

## M3.3 — Session → workspace creation; harness runs in the worktree

**Goal.** Starting a session with selected workspaces creates a worktree per repo
and runs the harness with `cwd = worktree`.

**Files**
- `~ packages/main/src/session/SessionRuntime.ts` (create worktrees before start; pass cwd)
- `~ packages/main/src/harness/opencode/OpencodeHarness.ts` (honor `cwd`)
- `~ packages/core/src/ipc.ts` (`StartSessionReq.workspaces` already present)

**Steps**
1. On `startSession`, for each requested `Workspace`, call
   `git.createWorktree(repoRoot, branch)`; set `HarnessRunInput.cwd` to the (first)
   worktree and pass all workspaces. Persist `worktree` on each `Workspace`.
2. On session completion or archive, optionally `removeWorktree` (gated by a
   setting — keep worktrees by default so users can inspect/PR them).

**Acceptance** — a session creates a branch+worktree; the agent's file edits land
there; the workspace shows in the Overview rail with repo/branch.

**Validate** — `npm start`: run "create hello.txt" against a registered repo;
confirm the worktree exists on disk with the new file on the agent branch.

---

## M3.4 — Changes rail: real diffs

**Goal.** The session's Changes rail shows actual file diffs from the worktree,
grouped by repo, with working +/− and expandable hunks.

**Files**
- `~ packages/core/src/ipc.ts` (`session:changes` → `FileChange[]` per repo)
- `+ packages/main/src/ipc/handlers/changes.ts` (call `git.diff` per workspace)
- `+ packages/renderer/src/lib/session/useChanges.ts`
- (No `ChangesRail` edits: it already renders `FileChange[]` grouped by repo.)

**Steps**
1. Handler returns `git.diff(worktree)` for each workspace, tagged by repo, in the
   `FileChange` shape the rail consumes.
2. Renderer fetches on demand (when the Changes tab opens) and on session events
   that imply file changes; refresh after agent turns.

**Acceptance** — after the agent edits files, the Changes tab lists them with
diffs that match `git diff` in the worktree.

**Validate** — `npm start`: run an edit task, open Changes, compare to terminal
`git -C <worktree> diff`.

**Phase 3 exit criteria** — agents work in real worktrees; the Changes surface is
real. Still local-only (no PRs).

---

# PHASE 4 — Forge: PRs, reviews, checks

Goal: push branches, open draft PRs, sync review/check state, and act on PRs.

---

## M4.1 — `ForgeService` interface + `GitHubForgeService`

**Goal.** Abstract the code-forge (GitHub first) behind an interface; implement
with octokit.

**Files**
- `+ packages/core/src/forge.ts` (interface + types mapped to `PullRequest`, `ReviewComment`, `CheckRun`)
- `+ packages/main/src/forge/GitHubForgeService.ts`
- `+ packages/main/src/forge/auth.ts` (token from settings or `gh` CLI)
- `~ packages/main/package.json` (add `@octokit/rest`)

**Steps**
1. Interface:
   ```ts
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
2. Auth: read a token from Settings; fall back to `gh auth token` if the CLI is
   present. Never log tokens.
3. Implement with octokit, mapping responses into the existing model shapes.

**Acceptance** — unit/integration (against a scratch repo or recorded fixtures):
`getPR` returns a populated `PullRequest`.

**Validate** — `npm --workspace @app/main run test` with fixtures; or a guarded
live test against a throwaway repo.

**Risks** — rate limits (backoff + cache); private-repo scopes; map GitHub check
conclusions to the `CheckRun.status` union precisely.

---

## M4.2 — Open draft PR(s) from a session

**Goal.** A session can push its branch(es) and open a draft PR per repo;
`linkedPRs` persists.

**Files**
- `~ packages/main/src/session/SessionRuntime.ts` (or a `PrCoordinator`) to push + open
- `~ packages/core/src/ipc.ts` (`session:openPR`)
- `+ packages/main/src/git/push.ts` (git push helper)
- `~ packages/renderer/src/shell/...` (wire an "Open PR" affordance in the Overview rail)

**Steps**
1. `git push` the worktree branch to origin (token-authenticated remote URL or
   `gh`); then `forge.openDraftPR`. Persist `linkedPRs` and emit a `pr` activity.
2. Support multiple repos: open one PR per workspace; record cross-PR ordering
   notes if a setting flags dependencies (R-MULTI-3 is informational for now).

**Acceptance** — clicking "Open PR" pushes the branch and creates a draft PR
visible on GitHub; the PR appears in the Overview rail.

**Validate** — `npm start` against a throwaway GitHub repo: run a task, open a PR,
confirm on GitHub and in the rail.

---

## M4.3 — PR sync: files, reviews, checks → rails

**Goal.** The Changes/Reviews/Checks rails show real PR data, aggregated across
the session's PRs.

**Files**
- `~ packages/core/src/ipc.ts` (`pr:files`, `pr:comments`, `pr:checks`, or one `pr:get` bundle)
- `+ packages/main/src/ipc/handlers/pr.ts`
- `+ packages/renderer/src/lib/pr/usePr.ts`
- `+ packages/main/src/forge/poll.ts` (periodic refresh + `emit` on change)

**Steps**
1. Handlers delegate to `ForgeService`; cache results and poll on an interval
   (e.g. 30s) while a PR is open, emitting `pr:<repo>#<n>:changed` so rails update.
2. Renderer rails consume the aggregated arrays (they already render
   `FileChange[]`, `ReviewComment[]`, `CheckRun[]`).

**Acceptance** — opening Reviews/Checks shows live GitHub review comments and CI
runs; they update when state changes on GitHub.

**Validate** — `npm start`: push a PR, add a review comment on GitHub, see it
appear; let CI run, watch checks update.

---

## M4.4 — PR actions: reply, ask-agent / address-all, re-run, merge

**Goal.** The action affordances already in the UI do real things.

**Files**
- `~ packages/core/src/ipc.ts` (`pr:reply`, `pr:rerun`, `pr:merge`, `session:addressComments`)
- `~ packages/main/src/ipc/handlers/pr.ts`
- `~ packages/main/src/session/SessionRuntime.ts` (re-enter harness with comment context)

**Steps**
1. `pr:reply` → `forge.replyToComment`. `pr:rerun` → `forge.rerunChecks`.
   `pr:merge` → `forge.merge` (only when the existing `canMerge` gate holds: clean
   + approved + checks green + not merged).
2. **Ask agent / Address all:** package the selected review comment(s) into a new
   harness turn (`session:addressComments`) — feed them as context to `send()`, let
   the agent push follow-up changes; refresh the PR after.

**Acceptance** — reply posts to GitHub; re-run triggers CI; merge merges (gated);
"Address all" produces agent follow-up commits on the PR branch.

**Validate** — `npm start` against a throwaway repo: exercise each action; verify
on GitHub.

**Phase 4 exit criteria** — full prompt → PRs → review → checks → merge loop,
without leaving the app. ForgeService is swappable for other forges.

---

# PHASE 5 — Project intelligence (LLM)

Goal: the differentiator — LLM-synthesized summaries, next steps, and context
inheritance.

> **Model defaults (per `claude-api` skill):** use `claude-opus-4-8` unless the
> user picks otherwise; adaptive thinking; **stream** any potentially long call.
> Keep the LLM behind `IntelligenceProvider` so the model/provider is swappable.

---

## M5.1 — `IntelligenceProvider` interface + `AnthropicIntelligence`

**Goal.** Abstract LLM synthesis; implement with the Anthropic SDK (streaming).

**Files**
- `+ packages/core/src/intelligence.ts` (interface + result types)
- `+ packages/main/src/intelligence/AnthropicIntelligence.ts`
- `~ packages/main/package.json` (add `@anthropic-ai/sdk`)

**Steps**
1. Interface:
   ```ts
   export interface ProjectSummaryInput {
     project: Project;            // name, description, status
     sessions: Session[];         // current states
     prs: PullRequest[];          // open/merged, verdicts, checks
     notes: Note[];
     references: Reference[];
     recentActivity: ActivityItem[];
   }
   export interface ProjectSummaryResult {
     summary: string;             // narrative (R-INTEL-1)
     nextSteps: string[];         // ordered (R-INTEL-2)
     synthesizedAtMs: number;
   }
   export interface IntelligenceProvider {
     summarizeProject(input: ProjectSummaryInput): Promise<ProjectSummaryResult>;
     summarizeReference(input: { title: string; url?: string; body?: string }): Promise<string>;
   }
   ```
2. `AnthropicIntelligence` — Node `@anthropic-ai/sdk`, default model
   `claude-opus-4-8`, adaptive thinking, **streaming** via `messages.stream` and
   `.finalMessage()`:
   ```ts
   import Anthropic from "@anthropic-ai/sdk";
   const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env/settings
   const stream = client.messages.stream({
     model: opts.model ?? "claude-opus-4-8",
     max_tokens: 2000,
     thinking: { type: "adaptive" },
     system: SYSTEM_PROMPT,        // "You write sharp engineering status updates…"
     messages: [{ role: "user", content: assembledContext }],
   });
   const msg = await stream.finalMessage();
   ```
   Parse `summary` + `nextSteps` from the response. Prefer structured output
   (`output_config.format` with a small JSON schema: `{summary, nextSteps[]}`) so
   parsing is robust. Use SDK types; handle typed errors
   (`Anthropic.RateLimitError`, `Anthropic.APIError`); the SDK retries 429/5xx.
3. API key comes from Settings (M2.8) or `ANTHROPIC_API_KEY`. Never log it.

**Acceptance** — given a project bundle, returns a coherent summary + steps.

**Validate** — `npm --workspace @app/main run test` with a real key behind an env
guard (skip if absent), asserting non-empty `summary`/`nextSteps`.

**Notes** — Keep the provider thin; routing through it (not raw SDK calls) is what
keeps the intelligence layer swappable.

---

## M5.2 — Context assembly (the R-INTEL-5 contract)

**Goal.** A single function that assembles project notes + references + state into
the prompt context, reused for both summaries and **harness runs** (so every
agent run inherits notes/refs).

**Files**
- `+ packages/main/src/intelligence/assembleContext.ts`
- `~ packages/main/src/session/SessionRuntime.ts` (pass assembled notes/refs into `HarnessRunInput`)

**Steps**
1. `assembleProjectContext(project)` → `{ notes[], references[], stateDigest }`
   with sane truncation (token budget aware; reference bodies summarized).
2. On `startSession` for a project-scoped session, populate
   `HarnessRunInput.notes`/`references` from this assembler → fulfills the
   "agent reads notes + references on every run" requirement.

**Acceptance** — a project session's `HarnessRunInput` includes the project's
notes/refs; the summary call uses the same assembler.

**Validate** — unit test the assembler; `npm start` and confirm (via a logged
input or a mock harness echo) that notes/refs reach the run.

---

## M5.3 — Generate summary + next steps; persist with freshness stamp

**Goal.** Wire the provider to a project; persist `summary`, `nextSteps`, and a
`synthesizedAtMs`; the Overview shows the freshness stamp.

**Files**
- `~ packages/core/src/ipc.ts` (`project:resynthesize`)
- `~ packages/core/src/domain.ts` (add `summarySynthesizedAtMs?: number` to `Project`)
- `+ packages/main/src/ipc/handlers/intelligence.ts`
- `~ packages/main/src/repo/...` (persist the new field)
- `~ packages/renderer/src/shell/...` (Overview "synthesized Xm ago" already rendered; bind to real timestamp + add a manual "Re-synthesize" trigger)

**Steps**
1. `project:resynthesize` → assemble context → `summarizeProject` → persist
   summary/steps/timestamp → `emit("project:"+id+":changed")`.
2. Overview already shows "Agent summary · synthesized 14m ago" and the next-steps
   list; bind these to the persisted values and compute the relative stamp from
   `summarySynthesizedAtMs`.

**Acceptance** — clicking re-synthesize updates the summary + steps + stamp;
persists across restart.

**Validate** — `npm start` (with API key): re-synthesize a project, confirm
updated narrative and timestamp; restart to confirm persistence.

---

## M5.4 — Triggers: on-demand, on-activity debounce, daily synthesis

**Goal.** Keep summaries current automatically (R-INTEL-6) without hammering the
API.

**Files**
- `+ packages/main/src/intelligence/Scheduler.ts`
- `~ packages/main/src/ipc/handlers/writes.ts` (notify scheduler on activity)

**Steps**
1. Debounced re-synthesis: when a project gets activity (session done, PR opened,
   note changed), schedule a re-synthesis after a quiet period (e.g. 2–5 min),
   coalescing bursts.
2. Daily synthesis: a timer that re-synthesizes active projects once/day and
   appends a `summary` activity item ("Daily summary generated — …").
3. Respect a Settings toggle + cost guardrails (max re-syntheses/hour).

**Acceptance** — finishing a session triggers a debounced re-synthesis; a daily
tick produces a summary activity entry.

**Validate** — `npm start`: complete a session, wait for the debounce, see the
summary refresh and an activity entry; force the daily path via a dev trigger.

---

## M5.5 — Reference ingestion + one-line summaries

**Goal.** Adding a reference fetches/derives a one-line agent summary (the
"indexed by the agent" promise).

**Files**
- `~ packages/core/src/ipc.ts` (`refs:ingest`)
- `+ packages/main/src/intelligence/ingestReference.ts`
- `~ packages/main/src/ipc/handlers/writes.ts` (on `refs:upsert`, kick ingestion)
- (Optional) `+ packages/main/src/forge/fetchUrl.ts` (fetch URL/PR/doc text)

**Steps**
1. On reference add, infer `kind` from the URL (PR/doc/link/issue), fetch a snippet
   where feasible (use `WebFetch`-style retrieval in main, or octokit for PRs),
   then `summarizeReference` → store the one-line `summary`.
2. Emit change so the References tab updates.

**Acceptance** — pasting a PR/doc URL yields a kind badge + a one-line summary,
persisted.

**Validate** — `npm start`: add a GitHub PR URL and a doc URL; confirm kind +
summary appear.

**Phase 5 exit criteria** — the intelligence layer is live and swappable; notes
and references genuinely flow into every run; summaries stay current.

---

# PHASE 6 — Status model, triage, realtime, search, settings

Goal: make the triage promise real across the whole app on live data.

---

## M6.1 — Derive `SessionStatus` from real signals

**Goal.** Compute session status (and thus tone/weight) from review verdicts,
check results, mergeability, and awaiting-input — not from harness status alone.

**Files**
- `+ packages/main/src/session/deriveStatus.ts`
- `~ packages/main/src/session/SessionRuntime.ts` (recompute on PR/check events)

**Steps**
1. Implement the precedence from `docs/product-description.md` §6 and the existing
   `SessionStateBadge` weights:
   `awaiting_input > checks_failing > changes_requested > review_pending >
   mergeable > running > merged/completed/idle`. Inputs: harness state + linked PR
   verdicts + check runs + mergeability.
2. Recompute on harness events **and** PR poll updates; persist; emit status.

**Acceptance** — a session whose PR has changes requested shows "Changes
Requested" (danger); one with green checks + approval shows "Ready to Merge".

**Validate** — `npm start` against a throwaway repo: drive a PR through review
states; watch the session status track them in Home/Project lists.

---

## M6.2 — Realtime fan-out + live triage ordering

**Goal.** Home and Project views update live as statuses change; "Needs you" and
project rows reorder by weight on real data.

**Files**
- `+ packages/renderer/src/lib/data/useLiveData.ts` (subscribe to `data:changed`, `project:*:changed`, `session:*:status`)
- `~ packages/renderer/src/lib/data/DataProvider.tsx` (invalidate/refresh on events)
- (Sorting logic already exists in `HomeView`/`OverviewTab` via `sessionWeight`.)

**Steps**
1. Subscribe to the coarse change topics; on event, refresh the affected slice and
   re-render. Keep the existing weight-based sorts.

**Acceptance** — with two sessions running, the Home "Needs you" / "In progress"
sections update without a manual refresh as states change.

**Validate** — `npm start`: trigger status changes; confirm live reordering and
counts on Home and the project rows.

---

## M6.3 — Global search (⌘K)

**Goal.** The sidebar search box searches real projects, sessions, and PRs.

**Files**
- `~ packages/core/src/ipc.ts` (`search:query`)
- `+ packages/main/src/ipc/handlers/search.ts` (substring/fuzzy over repo data)
- `+ packages/renderer/src/lib/search/useSearch.ts`
- `~ packages/renderer/src/shell/...` (wire the existing search input + a results palette; `cmdk` is available)

**Steps**
1. Main-side search across project names/descriptions, session titles/prompts, PR
   titles/numbers; return typed results with a `kind` and a navigation target.
2. Renderer: ⌘K opens a `cmdk` palette; selecting a result navigates.

**Acceptance** — typing a known session/PR/project term returns it; selecting it
navigates.

**Validate** — `npm start`: search for seeded/created entities; confirm results +
navigation.

---

## M6.4 — Settings surface (consolidate)

**Goal.** A single Settings panel: active harness + options, model defaults,
provider/API tokens, GitHub token, repo roots, intelligence toggles.

**Files**
- `~ packages/renderer/src/shell/SettingsPanel.tsx` (extend M2.8)
- `~ packages/main/src/settings/Settings.ts` (all keys)

**Steps**
1. Group settings; mask secrets; "Test connection" for harness, Anthropic, and
   GitHub. Persist via Repository/settings file.

**Acceptance** — all integration credentials/config live in one place and persist.

**Validate** — `npm start`: set each; restart; confirm persistence + health
checks.

**Phase 6 exit criteria** — the triage product thesis is real and live across
surfaces; everything configurable in one panel.

---

# PHASE 7 — Hardening & ship

---

## M7.1 — Error / empty / reconnect states

**Goal.** Every surface degrades gracefully: harness down, API error, no token, no
repos, offline GitHub, stream drop.

**Files**
- `~ renderer hooks` (surface `error` from `useInvoke`/streams; toasts via sonner)
- `~ packages/main/src/session/SessionRuntime.ts` (resilient event handling)
- `+ packages/renderer/src/lib/ipc/reconnect.ts` (re-subscribe after a drop; refetch state to fill gaps — mirror the SSE "history then live, dedupe" pattern)

**Steps**
1. Map known failures to actionable messages ("opencode not found — set its path
   in Settings", "ANTHROPIC_API_KEY missing", "GitHub token lacks `repo` scope").
2. On reconnect/resubscribe, refetch the session transcript/PR state and dedupe so
   no events are lost across a drop.

**Acceptance** — pulling the API key / stopping opencode / revoking the token each
produce a clear, recoverable UI state, not a crash.

**Validate** — `npm start`: induce each failure; confirm graceful handling and
recovery after fixing it.

---

## M7.2 — `SqliteRepository` behind `Repository` (optional swap)

**Goal.** Replace JSON storage with SQLite for scale, behind the same interface,
with a migration from the JSON file.

**Files**
- `+ packages/main/src/repo/SqliteRepository.ts`
- `+ packages/main/src/repo/migrateJsonToSqlite.ts`
- `~ packages/main/package.json` (add `better-sqlite3`)
- `~ electron-builder.mjs` (ensure the native module is unpacked/rebuilt)

**Steps**
1. Implement `Repository` over SQLite (tables: projects, sessions, messages,
   notes, references, prs, activity). Synchronous `better-sqlite3` is simplest.
2. On first SQLite boot, if `db.json` exists, import it then rename it to
   `db.json.bak`.
3. Select repository impl by a Settings/env flag; default can stay JSON until
   proven.

**Acceptance** — with SQLite enabled, all reads/writes behave identically; the
JSON store migrates once.

**Validate**
```sh
npm run compile   # packaged build must include the native module
npm start         # flip to sqlite; verify data intact post-migration
```

**Risks** — native module packaging is the classic Electron pain; verify
`npm run compile` produces a working binary (this is why it's late and optional).

---

## M7.3 — e2e + packaging + auto-update sanity

**Goal.** Automated coverage of the core flow and a clean distributable.

**Files**
- `~ tests/e2e.spec.ts` (extend the Playwright suite)
- (CI workflows already exist under `.github/workflows`.)

**Steps**
1. e2e with the **mock harness** (deterministic, no network): launch app → start a
   session → see streamed transcript → create a note → restart → assert
   persistence. (Use mock harness so CI needs no opencode/keys.)
2. `npm run compile` produces a runnable artifact; smoke-launch it.
3. Sanity-check the existing auto-update path still builds.

**Acceptance** — `npm run e2e` passes; `npm run compile` yields a launchable app.

**Validate**
```sh
npm run e2e
npm run compile
```

**Phase 7 exit criteria** — resilient, tested, packageable. SQLite available for
scale. The app is "complete" per `docs/product-description.md`.

---

## 8. Cross-cutting checklists

### 8.1 Adding a new harness later (the extensibility payoff)
1. `packages/main/src/harness/<name>/<Name>Harness.ts` implements `Harness`.
2. Map its events → `HarnessEvent` in a `map.ts`; record its API in a `SPIKE.md`.
3. `registerHarness("<name>", ctor)` in `harness/index.ts`.
4. Add `"<name>"` to the Settings dropdown. **No other code changes.**
   - **Claude harness:** use the Claude Agent SDK / Managed Agents (see
     `claude-api` skill) — sessions, an SSE event stream, tool-use events; map
     `agent.message`/`message.part` → `message`/`message_delta`,
     `session.status_idle{requires_action}` → `awaiting_input`, terminal → `done`.
   - **Codex harness:** wrap its CLI/SDK equivalently.

### 8.2 Adding a new IPC feature
1. Append a typed entry to `IpcContract` in `core/src/ipc.ts`.
2. Add a handler in `main` and register it in `IpcModule`.
3. Call it from the renderer via `call(channel, req)`. Preload never changes.

### 8.3 Security invariants (keep throughout)
- Renderer stays sandboxed-ish: `nodeIntegration:false`, `contextIsolation:true`.
  All privileged work in main, reached only via the typed IPC pipe.
- Only serializable data crosses IPC. Secrets (API/GitHub tokens) live in main,
  never sent to the renderer, never logged.
- Validate external inputs at the boundary (IPC payloads, git/forge responses).

### 8.4 Per-milestone definition of done
- [ ] Files created/edited exactly as listed.
- [ ] `npm run validate` → 0 errors.
- [ ] `npm run screenshot` → boots clean (or the milestone's named test passes).
- [ ] The milestone's **Acceptance** checks pass by hand.
- [ ] No new code added inside `packages/renderer/src/app/**` (except `mockData.ts`).
- [ ] New IPC has a typed `IpcContract` entry.

---

## 9. Open questions to resolve during the spikes (don't guess)
- **opencode (M2.6):** exact server start command + port discovery; SDK method
  names for session/prompt/stream/abort; event payload shapes; how model + provider
  keys are configured. Record in `SPIKE.md` and pin the version.
- **GitHub auth (M4.1):** PAT scopes vs `gh` CLI token; org SSO; draft-PR
  permissions.
- **Anthropic (M5.1):** confirm structured-output schema support for
  `{summary, nextSteps[]}`; choose `max_tokens`/effort per cost target. Default
  model `claude-opus-4-8`.
- **SQLite (M7.2):** electron-builder native-module unpacking/rebuild for the
  target platforms.

> Build order is deliberate: **seams → persistence → harness (mock then opencode)
> → git → forge → intelligence → triage → hardening.** Each milestone leaves the
> app launchable and the new behavior verifiable. Keep the interfaces in `core`
> the contract of record; keep implementations swappable.
