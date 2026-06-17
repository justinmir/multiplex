#!/usr/bin/env node
/**
 * Showcase screenshots for the README.
 *
 * Launches the *built* app against a throwaway, fully-seeded profile
 * (MULTIPLEX_SEED=1 + a temp XDG_CONFIG_HOME so your real data is untouched),
 * drives the UI with Playwright, and writes one PNG per view to
 * docs/screenshots/.
 *
 * Captures: home, the project view (Overview), and the live session view.
 *
 * Prereq: built output must exist — run `npm run build` first. The
 * `npm run screenshots` wrapper does that for you.
 *
 * On headless Linux (no DISPLAY) it re-execs itself under `xvfb-run`.
 *
 * Usage:
 *   node scripts/showcase.mjs [--out-dir <dir>] [--width <n>] [--height <n>] [--wait <ms>]
 */
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// --- auto-wrap in a virtual display on headless Linux ----------------------
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.__XVFB_WRAPPED) {
  const hasXvfb = spawnSync('which', ['xvfb-run'], { stdio: 'ignore' }).status === 0;
  if (hasXvfb) {
    const res = spawnSync(
      'xvfb-run',
      ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: 'inherit', env: { ...process.env, __XVFB_WRAPPED: '1' } },
    );
    process.exit(res.status ?? 1);
  }
  console.error(
    '[showcase] No DISPLAY and xvfb-run not found.\n' +
      "          Install xvfb (Debian/Ubuntu: 'sudo apt-get install xvfb') or run on a machine with a display.",
  );
  process.exit(1);
}

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const outDir = path.resolve(repoRoot, arg('out-dir', 'docs/screenshots'));
const width = Number(arg('width', 1600));
const height = Number(arg('height', 1000));
const wait = Number(arg('wait', 2200));

// --- preflight -------------------------------------------------------------
const rendererDist = path.join(repoRoot, 'packages/renderer/dist/index.html');
if (!existsSync(rendererDist)) {
  console.error(
    `[showcase] Built renderer not found at ${rendererDist}\n` +
      '          Run `npm run build` first (or use `npm run screenshots`).',
  );
  process.exit(1);
}

const { _electron: electron } = await import('playwright');
const electronPath = (await import('electron')).default;

// A fresh, seeded profile in a temp dir keeps the user's real data untouched
// and makes the demo data deterministic for every run.
const profileDir = mkdtempSync(path.join(tmpdir(), 'multiplex-showcase-'));
const entry = path.join(repoRoot, 'packages/entry-point.mjs');
const env = {
  ...process.env,
  NODE_ENV: 'production',
  MODE: 'production',
  MULTIPLEX_SEED: '1',
  XDG_CONFIG_HOME: profileDir,
};

mkdirSync(outDir, { recursive: true });

const app = await electron.launch({ executablePath: electronPath, args: [entry, '--no-sandbox'], env });
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
await app
  .evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), { width, height })
  .catch(() => {});
await win.waitForTimeout(wait);

const shoot = async (name) => {
  const out = path.join(outDir, `${name}.png`);
  await win.screenshot({ path: out });
  console.log(`[showcase] wrote ${path.relative(repoRoot, out)}`);
};

/** Click the first element matching `text`, then settle. Logs and continues on miss. */
const clickText = async (text, settle = wait) => {
  try {
    await win.getByText(text, { exact: false }).first().click({ timeout: 6000 });
    await win.waitForTimeout(settle);
    return true;
  } catch {
    console.warn(`[showcase] could not click “${text}” — capturing current view instead`);
    return false;
  }
};

// 1) Home — everything in flight, ordered by what needs you.
await shoot('home');

// 2) Project view — open the seeded "Ingest Pipeline v2" project (Overview).
await clickText('Ingest Pipeline v2');
await shoot('project');

// 3) Session view — open the rich, in-flight investigation session.
await clickText('Investigate p99 spike under replay load');
await shoot('session');

await app.close();
console.log(`[showcase] done — ${outDir}`);
