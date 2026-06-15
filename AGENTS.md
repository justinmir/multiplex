# AGENTS.md

Guidance and tooling for AI agents (and humans) working in this repo.

## What this project is

An Electron desktop app built on the **vite-electron-builder** template. It's an
npm-workspaces monorepo:

| Package | Role |
| --- | --- |
| `packages/main` | Electron main process (window mgmt, security modules). TS → `vite build`. |
| `packages/preload` | Preload bridge exposed to the renderer. TS → `vite build`. |
| `packages/renderer` | **The UI** — React 19 + Vite + Tailwind v4 + shadcn/ui. |
| `packages/entry-point.mjs` | Wires renderer + preload into main at startup. |

The renderer UI is ported from a **Figma Make** export (`~/hub`). The repeatable
sync flow: re-copy `~/hub/src/app` and `~/hub/src/styles` into
`packages/renderer/src/`, then add any new dependency Figma introduces to
`packages/renderer/package.json`. Imports are clean (no `@/` alias, no
`figma:asset`, no version-pinned imports), so no rewrites are needed.

## Commands

Run all of these from the repo root.

| Command | What it does | Needs a display? |
| --- | --- | --- |
| `npm run validate` | **Everyday gate:** typecheck + lint + build. Run before declaring work done. | no |
| `npm run typecheck` | `tsc` across all three workspaces. | no |
| `npm run lint` | ESLint on the renderer (tuned for shadcn/Figma — see below). | no |
| `npm run build` | Build main + preload + renderer (`dist/` in each package). | no |
| `npm run screenshot` | Build, launch the real Electron app headless, write a PNG, and fail on any renderer console error. Doubles as a **boot smoke test**. | auto (xvfb) |
| `npm start` | Dev mode: Vite dev server + Electron with HMR. Long-running. | yes |
| `npm run compile` | Package a distributable via electron-builder. Heavy. | no |
| `npm test` | Playwright e2e (`tests/e2e.spec.ts`). **Requires `npm run compile` first** (it launches the packaged binary). | yes |
| `npm run e2e` | `npm run compile` + run the e2e suite under a virtual display. | auto (xvfb) |

**Fast inner loop for agents:** `npm run validate` for correctness, then
`npm run screenshot` to confirm the UI actually renders. Reserve `npm run e2e` /
`npm run compile` for pre-release checks — they're slow and may need network.

## `scripts/`

### `scripts/screenshot.mjs`
Launches the built app through Playwright, waits for paint, writes a PNG, and
prints the window title + a sample of visible text. **Exits non-zero if the
renderer logs a console error or throws** — so it's both a screenshot tool and a
boot smoke test. On headless Linux (no `DISPLAY`) it re-execs itself under
`xvfb-run` automatically.

Prereq: built output must exist (`npm run build`). The `npm run screenshot`
wrapper handles that. To run the script directly:

```bash
node scripts/screenshot.mjs [--out <path>] [--width <n>] [--height <n>] \
                            [--wait <ms>] [--url <devServerUrl>]
```

- `--out`   output PNG (default `.artifacts/screenshot.png`, gitignored)
- `--width` / `--height`  window content size (default `1440x900`)
- `--wait`  ms to wait after load before capturing (default `2500`)
- `--url`   screenshot a running dev server instead of the built `dist`
  (e.g. `--url http://localhost:5173`); otherwise it loads the built renderer.

### `scripts/with-display.sh`
Runs any command directly when `$DISPLAY` is set, otherwise wraps it in
`xvfb-run`. Used by `npm run e2e`; reuse it for any GUI command on a headless box:

```bash
scripts/with-display.sh npx playwright test ./tests/e2e.spec.ts
```

## Conventions & gotchas

- **Node ≥ 23** is declared in `package.json#engines`. The repo runs on Node 22
  with `EBADENGINE` warnings; prefer Node ≥ 23 to match.
- **`.npmrc` sets `legacy-peer-deps=true`.** Required because shadcn's
  `calendar.tsx` pins `react-day-picker@8` (peer caps at React 18) while the app
  runs React 19. Keep it; don't run `npm install` without it.
- **Renderer ESLint is intentionally tuned** (`packages/renderer/eslint.config.js`):
  the vendored `components/ui/**` (shadcn) is exempt from React style rules, and
  HMR/"rules of React"/`no-explicit-any`/`no-unused-vars` are **warnings** (not
  errors) project-wide, because Figma/shadcn output trips them. `npm run lint`
  passing means **0 errors**; warnings are acceptable baseline noise. Don't let
  pre-existing warnings block you, but don't add new errors.
- **Renderer `tsconfig.app.json` is relaxed** vs. the template default
  (`verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters` off) so Figma
  Make output typechecks without hand-editing every generated file.
- **Artifacts** (screenshots, smoke output) go to `.artifacts/` — gitignored.
- The app renders in a **dark theme by default** (the root element carries the
  `dark` class); design tokens live in `packages/renderer/src/styles/theme.css`.
