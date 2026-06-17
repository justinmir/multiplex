#!/usr/bin/env node
/**
 * Headless screenshot + boot smoke-test for the Electron app.
 *
 * Launches the *built* app through Playwright, waits for the renderer to paint,
 * writes a PNG, and prints the window title + a sample of the visible text.
 * Exits non-zero if the renderer logs a console error or throws, so this also
 * works as a fast "does the app boot and render?" smoke test in CI/agents.
 *
 * Prereq: built output must exist — run `npm run build` first. The
 * `npm run screenshot` wrapper does that for you.
 *
 * On headless Linux (no DISPLAY) it re-execs itself under `xvfb-run`.
 *
 * Usage:
 *   node scripts/screenshot.mjs [--out <path>] [--width <n>] [--height <n>]
 *                               [--wait <ms>] [--url <devServerUrl>]
 */
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import path from 'node:path';

// --- auto-wrap in a virtual display on headless Linux ----------------------
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.__XVFB_WRAPPED) {
  const hasXvfb = spawnSync('which', ['xvfb-run'], {stdio: 'ignore'}).status === 0;
  if (hasXvfb) {
    const res = spawnSync(
      'xvfb-run',
      ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {stdio: 'inherit', env: {...process.env, __XVFB_WRAPPED: '1'}},
    );
    process.exit(res.status ?? 1);
  }
  console.warn('[screenshot] No DISPLAY and xvfb-run not found; attempting a direct launch.');
}

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = path.resolve(repoRoot, arg('out', process.env.SCREENSHOT_OUT || '.artifacts/screenshot.png'));
const width = Number(arg('width', 1440));
const height = Number(arg('height', 900));
const wait = Number(arg('wait', 2500));
const devUrl = arg('url', process.env.VITE_DEV_SERVER_URL);

// --- preflight -------------------------------------------------------------
const rendererDist = path.join(repoRoot, 'packages/renderer/dist/index.html');
if (!devUrl && !existsSync(rendererDist)) {
  console.error(
    `[screenshot] Built renderer not found at ${rendererDist}\n` +
      '             Run `npm run build` first, or pass --url <dev-server-url>.',
  );
  process.exit(1);
}

// playwright + electron resolve from the repo root, so this must run from there.
const {_electron: electron} = await import('playwright');
const electronPath = (await import('electron')).default;

const entry = path.join(repoRoot, 'packages/entry-point.mjs');
const env = {...process.env, NODE_ENV: 'production', MODE: 'production'};
if (devUrl) {
  env.MODE = 'development';
  env.VITE_DEV_SERVER_URL = devUrl;
}

const app = await electron.launch({executablePath: electronPath, args: [entry, '--no-sandbox'], env});

const errors = [];
const win = await app.firstWindow();
win.on('console', m => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
win.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

await win.waitForLoadState('domcontentloaded');

// Size the window deterministically (template leaves it at the Electron default).
await app
  .evaluate(({BrowserWindow}, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    w?.setContentSize(size.width, size.height);
  }, {width, height})
  .catch(() => {});

await win.waitForTimeout(wait);

mkdirSync(path.dirname(out), {recursive: true});
await win.screenshot({path: out});

const title = await win.title();
const sample = (await win.locator('body').innerText().catch(() => ''))
  .slice(0, 240)
  .replace(/\s+/g, ' ')
  .trim();
await app.close();

console.log(`[screenshot] wrote ${path.relative(repoRoot, out)} (${width}x${height})`);
console.log(`[screenshot] title: ${title}`);
console.log(`[screenshot] text:  ${sample}`);

if (errors.length) {
  console.error(`\n[screenshot] FAILED — renderer reported ${errors.length} error(s):`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('[screenshot] OK — no console errors.');
