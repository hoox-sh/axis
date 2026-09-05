/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Capture AXIS PWA stills + GIFs for docs, README, and the product landing page.
 *
 *   bun scripts/capture-screenshots.ts
 *   AXIS_CAPTURE_URL=http://127.0.0.1:3000 bun scripts/capture-screenshots.ts
 *   bun scripts/capture-screenshots.ts --skip-gifs
 *
 * Default host is the public demo (working engine + Binance). Local Vite works
 * for chrome stills; Run/Results need a live Pro API.
 */

import { chromium, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const OUT = join(ROOT, 'docs', 'images');
const URL = process.env.AXIS_CAPTURE_URL || 'https://axis.hoox.sh';
const SKIP_GIFS = process.argv.includes('--skip-gifs');
const SKIP_CLI = process.argv.includes('--skip-cli');
const GIFS_ONLY = process.argv.includes('--gifs-only');
const DATE = new Date().toISOString().slice(0, 10);

const RSI = `//@version=6
indicator("RSI", overlay=false)
length = input.int(14, "RSI Length", minval=2, maxval=100)
rsi = ta.rsi(close, length)
plot(rsi, "RSI", color=color.purple)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
`;

const STRATEGY = `//@version=6
strategy("SMA Cross", overlay=true, initial_capital=10000, commission_value=0.05)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")
fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)
plot(fast, "Fast SMA", color=color.aqua)
plot(slow, "Slow SMA", color=color.orange)
if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
`;

const failures: string[] = [];
const captured: string[] = [];

function ensureDir(p: string) {
  mkdirSync(p, { recursive: true });
}

function log(msg: string) {
  console.log(msg);
}

async function shot(page: Page, rel: string, loc?: Locator) {
  const dest = join(OUT, rel);
  ensureDir(dirname(dest));
  try {
    if (loc) {
      await loc.waitFor({ state: 'visible', timeout: 12_000 });
      await loc.screenshot({ path: dest, type: 'png', animations: 'disabled' });
    } else {
      await page.screenshot({ path: dest, type: 'png', animations: 'disabled' });
    }
    captured.push(rel);
    log(`  ✓ ${rel}`);
  } catch (err) {
    failures.push(`${rel}: ${(err as Error).message}`);
    log(`  ✗ ${rel} — ${(err as Error).message}`);
  }
}

async function closeResults(page: Page) {
  const close = page.getByTestId('axis-results-close');
  if ((await close.count()) && (await close.isVisible().catch(() => false))) {
    await close.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
}

async function dismissOverlays(page: Page) {
  await closeResults(page);
  await closeStudio(page).catch(() => undefined);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(200);
}

async function waitShell(page: Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 45_000 });
  await page.locator('[data-axis-panes], canvas, [data-testid="axis-watchlist"]').first().waitFor({
    state: 'attached',
    timeout: 20_000,
  });
}

async function waitBars(page: Page, timeout = 45_000) {
  const status = page.getByTestId('axis-status-message');
  await status.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  try {
    await status.filter({ hasText: /Loaded \d+ bars|Ready/i }).waitFor({ timeout });
  } catch {
    // Status copy varies; canvas paint is the real gate.
  }
  await page.waitForFunction(
    () => {
      const canvases = [...document.querySelectorAll('canvas')] as HTMLCanvasElement[];
      return canvases.some((c) => c.width > 200 && c.height > 80);
    },
    { timeout: 20_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function loadHistory(page: Page) {
  const loadBtn = page.getByTestId('axis-btn-load');
  if (await loadBtn.count()) {
    await loadBtn.click();
  }
  await waitBars(page);
}

async function setEditorDoc(page: Page, doc: string) {
  const cm = page.locator('.cm-content').first();
  if (!(await cm.count())) {
    const editorBtn = page.getByTestId('axis-btn-editor');
    if (await editorBtn.count()) await editorBtn.click();
    await page.waitForTimeout(400);
  }
  await cm.waitFor({ state: 'visible', timeout: 15_000 });
  await cm.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(doc);
  await page.waitForTimeout(250);
}

async function runScript(page: Page): Promise<boolean> {
  const run = page.getByTestId('axis-btn-run');
  if (!(await run.count())) return false;
  await run.click();
  try {
    await page.getByTestId('axis-status-message').filter({ hasText: /success|Ready|ms|applied|error/i }).waitFor({
      timeout: 40_000,
    });
  } catch {
    await page.waitForTimeout(4_000);
  }
  await page.waitForTimeout(1_000);
  const err = await page.getByTestId('axis-status-message').textContent().catch(() => '');
  if (/error|fail/i.test(err || '')) {
    log(`  ! run status: ${err}`);
    return false;
  }
  return true;
}

async function openPanel(page: Page, testId: string) {
  await dismissOverlays(page);
  const btn = page.getByTestId(testId);
  if (!(await btn.count())) throw new Error(`missing ${testId}`);
  await btn.click({ timeout: 8_000, force: true });
  await page.waitForTimeout(350);
}

async function section(name: string, fn: () => Promise<void>) {
  log(`\n— ${name} —`);
  try {
    await fn();
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    log(`  ✗ ${name} — ${(err as Error).message.split('\n')[0]}`);
  }
}

async function openStudio(page: Page, rail: 'runtime' | 'wire' | 'settings' | 'workers' | 'plugins') {
  await dismissOverlays(page);
  await page.getByTestId('axis-btn-studio').click();
  await page.getByTestId(`axis-studio-rail-${rail}`).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId(`axis-studio-rail-${rail}`).click();
  await page.waitForTimeout(400);
}

async function closeStudio(page: Page) {
  const close = page.locator(
    '[data-testid="axis-runtimes-close"], [data-testid="axis-architecture-close"], [data-testid="axis-settings-close"], [data-testid="axis-workers-close"], [data-testid="axis-plugins-close"]',
  ).locator('visible=true').first();
  if (await close.count()) {
    await close.click({ timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
    return;
  }
  if (await page.locator('.ax-page').count()) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

async function padPng(rel: string, px = 24, color = '#0a0b10') {
  const src = join(OUT, rel);
  if (!existsSync(src)) return;
  const tmp = src.replace(/\.png$/, '.pad.png');
  const r = spawnSync('convert', [src, '-bordercolor', color, '-border', `${px}x${px}`, tmp], { encoding: 'utf8' });
  if (r.status === 0) {
    copyFileSync(tmp, src);
    spawnSync('rm', ['-f', tmp]);
  }
}

async function webp(rel: string) {
  const src = join(OUT, rel);
  if (!existsSync(src)) return;
  const dest = src.replace(/\.png$/, '.webp');
  spawnSync('convert', [src, '-quality', '92', dest], { encoding: 'utf8' });
}

function ffmpegGif(webm: string, gif: string, width = 1280) {
  const palette = webm + '.png';
  const vf = `fps=8,scale=${width}:-1:flags=lanczos`;
  spawnSync('ffmpeg', ['-y', '-i', webm, '-vf', `${vf},palettegen=stats_mode=diff`, palette], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-i', webm, '-i', palette, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, '-loop', '0', gif],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  spawnSync('rm', ['-f', palette]);
  if (r.status !== 0) throw new Error(r.stderr?.slice(-400) || 'ffmpeg gif failed');
}

async function seedContext(context: BrowserContext) {
  await context.addInitScript((doc: string) => {
    try {
      localStorage.setItem('pynescript.axis.editor.doc', doc);
    } catch {
      /* ignore */
    }
  }, RSI);
}

async function captureStills(page: Page) {
  await dismissOverlays(page);

  await section('workspace / chrome', async () => {
    await shot(page, 'app/workspace.png');
    await shot(page, 'app/load-ready.png');
    await shot(page, 'app/topbar.png', page.getByTestId('axis-topbar'));
    await shot(page, 'app/watchlist.png', page.getByTestId('axis-watchlist'));
    await shot(page, 'app/statusbar.png', page.getByTestId('axis-statusbar'));
    await shot(page, 'app/chart-panes.png', page.locator('[data-axis-panes]').first());
    await shot(page, 'app/editor.png', page.getByTestId('axis-editor'));
  });

  await section('command palette', async () => {
    await dismissOverlays(page);
    await page.keyboard.press('Control+K');
    await page.getByTestId('axis-command-palette').waitFor({ state: 'visible', timeout: 8_000 });
    await page.getByTestId('axis-command-palette-input').fill('theme');
    await page.waitForTimeout(250);
    await shot(page, 'app/command-palette.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  await section('scripts / library / layers', async () => {
    await openPanel(page, 'axis-btn-indicators');
    await shot(page, 'app/scripts-panel.png', page.getByTestId('axis-indicators'));
    await openPanel(page, 'axis-btn-library');
    await shot(page, 'app/script-library.png', page.getByTestId('axis-library'));
    await openPanel(page, 'axis-btn-layers');
    await shot(page, 'app/layers.png', page.getByTestId('axis-layers'));
    const layers = page.getByTestId('axis-layers');
    const toggle = layers.getByText(/volume profile/i).first();
    if (await toggle.count()) {
      await toggle.click({ force: true });
      await page.waitForTimeout(600);
      await shot(page, 'app/volume-profile.png');
      await toggle.click({ force: true }).catch(() => undefined);
    }
    await dismissOverlays(page);
  });

  await section('data source', async () => {
    await openPanel(page, 'axis-btn-datasource');
    await shot(page, 'app/data-source-manager.png', page.getByTestId('axis-datasource'));
    await dismissOverlays(page);
  });

  await section('on-chain', async () => {
    await openPanel(page, 'axis-btn-onchain');
    const chip = page.locator('[data-testid="axis-onchain-popular-chips"] button').first();
    if (await chip.count()) {
      await chip.click({ force: true });
      await page.waitForTimeout(4_000);
    }
    await shot(page, 'app/onchain-tvl.png');
    await shot(page, 'landing/axis-onchain.png');
    const dexTab = page.getByRole('tab', { name: 'DEX' });
    if (await dexTab.count()) {
      await dexTab.click({ force: true });
      await page.waitForTimeout(400);
      await shot(page, 'app/onchain-dex.png');
    }
    await dismissOverlays(page);
  });

  await section('alerts', async () => {
    await openPanel(page, 'axis-btn-alerts');
    await shot(page, 'app/alerts.png', page.getByTestId('axis-alerts'));
    await dismissOverlays(page);
  });

  await section('drawings', async () => {
    await dismissOverlays(page);
    const toolbar = page.getByTestId('axis-drawing-toolbar');
    await shot(page, 'app/drawings-toolbar.png', toolbar);
    const fibGroup = page.locator('[data-drawing-group="fib"] button').first();
    if (await fibGroup.count()) {
      await fibGroup.click({ force: true });
      const fibItem = page.locator('[data-drawing-flyout] button').first();
      if (await fibItem.count()) await fibItem.click({ force: true });
      const box = await page.locator('[data-axis-panes]').first().boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width * 0.28, box.y + box.height * 0.62);
        await page.waitForTimeout(120);
        await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.28);
        await page.waitForTimeout(400);
      }
      await shot(page, 'app/drawings-fib.png');
      await shot(page, 'landing/axis-drawings.png');
      await page.locator('[data-drawing-group="select"] button').first().click({ force: true }).catch(() => undefined);
    }
  });

  await section('compare / replay / layout', async () => {
    await dismissOverlays(page);
    const compare = page.getByTestId('axis-compare-enabled');
    if (await compare.count()) {
      await compare.click({ force: true });
      const cmpField = page.getByTestId('axis-compare-symbol');
      if (await cmpField.count()) {
        await cmpField.fill('ETHUSDT');
        await cmpField.press('Enter');
        await page.waitForTimeout(3_000);
      }
      await shot(page, 'app/compare.png');
      await compare.click({ force: true }).catch(() => undefined);
    }
    await page.getByTestId('axis-btn-bar-replay').click({ force: true });
    await page.waitForTimeout(400);
    if (await page.getByTestId('axis-bar-replay-controls').count()) {
      await page.getByTestId('axis-bar-replay-step-back').click({ force: true, clickCount: 6 }).catch(() => undefined);
      await page.waitForTimeout(200);
      await shot(page, 'app/bar-replay.png');
      await page.getByTestId('axis-bar-replay-exit').click({ force: true }).catch(() => undefined);
    }
    await page.getByTestId('axis-btn-layouts').click({ force: true });
    await page.waitForTimeout(200);
    const grid4 = page.getByTestId('axis-layout-mode-4');
    if (await grid4.count()) {
      await grid4.click({ force: true });
      await page.waitForTimeout(2_500);
      await shot(page, 'app/chart-layout-2x2.png');
      await page.getByTestId('axis-btn-layouts').click({ force: true });
      await page.getByTestId('axis-layout-mode-1').click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(600);
    } else {
      await page.keyboard.press('Escape');
    }
  });

  await section('editor extras / debug', async () => {
    await dismissOverlays(page);
    if (!(await page.getByTestId('axis-editor').isVisible().catch(() => false))) {
      await page.getByTestId('axis-btn-editor').click({ force: true });
      await page.waitForTimeout(400);
    }
    await shot(page, 'app/editor-problems.png', page.getByTestId('axis-editor'));
    const debugBtn = page.getByTestId('axis-btn-inline-debug');
    if (await debugBtn.count()) {
      await debugBtn.click({ force: true });
      await page.waitForTimeout(300);
      await shot(page, 'app/debug-chips.png', page.getByTestId('axis-editor'));
    }
    await page.getByTestId('axis-btn-scriptlogs-top').click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    if (await page.getByTestId('axis-scriptlogs').count()) {
      await shot(page, 'app/scriptlogs.png', page.getByTestId('axis-scriptlogs'));
    }
    await dismissOverlays(page);
  });

  await section('results / strategy / HPO', async () => {
    await dismissOverlays(page);
    await setEditorDoc(page, STRATEGY);
    await runScript(page);
    await page.waitForTimeout(800);
    if (!(await page.getByTestId('axis-results').isVisible().catch(() => false))) {
      await page.getByTestId('axis-btn-results').click({ force: true });
      await page.waitForTimeout(400);
    }
    await shot(page, 'app/results-drawer.png');
    await shot(page, 'landing/axis-results.png');
    await shot(page, 'app/results-tabs.png', page.getByTestId('axis-results-tabs'));
    const stratTab = page.getByTestId('axis-results-tab-strategy');
    if (await stratTab.count()) {
      await stratTab.click({ force: true });
      await page.waitForTimeout(250);
      await shot(page, 'app/results-strategy.png', page.getByTestId('axis-results-body'));
      await shot(page, 'app/results-equity.png', page.getByTestId('axis-results-body'));
    }
    const opt = page.getByTestId('axis-results-tab-optimise');
    if (await opt.count()) {
      await opt.click({ force: true });
      await page.waitForTimeout(400);
      await shot(page, 'app/hpo.png', page.getByTestId('axis-results-body'));
    }
    await closeResults(page);
  });

  await section('studio', async () => {
    await openStudio(page, 'runtime');
    await shot(page, 'studio/runtime.png');
    await page.getByTestId('axis-studio-rail-wire').click();
    await page.waitForTimeout(350);
    await shot(page, 'studio/wire.png');
    await shot(page, 'landing/axis-studio.png');
    await page.getByTestId('axis-studio-rail-settings').click();
    await page.waitForTimeout(350);
    await shot(page, 'studio/settings.png');
    const theme = page.getByTestId('axis-theme-panel');
    if (await theme.count()) await shot(page, 'app/theme-panel.png', theme);
    await page.getByTestId('axis-studio-rail-workers').click();
    await page.waitForTimeout(800);
    await shot(page, 'studio/workers.png');
    await page.getByTestId('axis-studio-rail-plugins').click();
    await page.waitForTimeout(400);
    await shot(page, 'studio/plugins.png');
    await shot(page, 'studio/plugins-catalog.png');
    const installTab = page.getByTestId('axis-plugins-tab-install');
    if (await installTab.count()) {
      await installTab.click();
      await page.waitForTimeout(250);
      await shot(page, 'studio/plugins-install.png');
    }
    await closeStudio(page);
  });

  await section('landing hero', async () => {
    await dismissOverlays(page);
    await setEditorDoc(page, RSI);
    await runScript(page);
    await closeResults(page);
    await page.waitForTimeout(800);
    await shot(page, 'app/run-rsi.png');
    await shot(page, 'landing/axis-hero.png');
    await shot(page, 'landing/axis-chart.png', page.locator('[data-axis-panes]').first());
    await shot(page, 'landing/axis-editor.png', page.getByTestId('axis-editor'));
  });
}

async function captureMobile(contextFactory: () => Promise<BrowserContext>) {
  log('\n— mobile —');
  const context = await contextFactory();
  await seedContext(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitShell(page);
  await loadHistory(page);
  await shot(page, 'app/workspace-mobile.png');
  await shot(page, 'landing/axis-mobile.png');
  await context.close();
}

async function captureGifs(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  log('\n— gifs —');
  ensureDir(join(OUT, 'gifs'));
  const tmp = join(OUT, '.tmp-video');
  ensureDir(tmp);

  async function record(name: string, run: (page: Page) => Promise<void>) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      recordVideo: { dir: tmp, size: { width: 1280, height: 800 } },
    });
    await seedContext(context);
    const page = await context.newPage();
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitShell(page);
      await loadHistory(page);
      await run(page);
    } catch (err) {
      failures.push(`gif ${name}: ${(err as Error).message}`);
      log(`  ✗ gif ${name} — ${(err as Error).message}`);
    }
    const video = page.video();
    await page.close();
    await context.close();
    if (!video) return;
    const webm = await video.path();
    const gif = join(OUT, 'gifs', `${name}.gif`);
    try {
      ffmpegGif(webm, gif, 1280);
      captured.push(`gifs/${name}.gif`);
      const kb = Math.round(statSync(gif).size / 1024);
      log(`  ✓ gifs/${name}.gif (${kb} KB)`);
    } catch (err) {
      failures.push(`gif encode ${name}: ${(err as Error).message}`);
      log(`  ✗ gif encode ${name}`);
    }
  }

  await record('load-and-run', async (page) => {
    await setEditorDoc(page, RSI);
    await page.waitForTimeout(400);
    await page.getByTestId('axis-btn-load').click();
    await waitBars(page);
    await page.waitForTimeout(500);
    await page.getByTestId('axis-btn-run').click();
    await page.waitForTimeout(5_000);
  });

  await record('command-palette', async (page) => {
    await page.keyboard.press('Control+K');
    await page.waitForTimeout(300);
    await page.getByTestId('axis-command-palette-input').pressSequentially('draw', { delay: 80 });
    await page.waitForTimeout(400);
    await page.getByTestId('axis-command-palette-input').fill('');
    await page.getByTestId('axis-command-palette-input').pressSequentially('theme', { delay: 80 });
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await record('studio-rail', async (page) => {
    await page.getByTestId('axis-btn-studio').click();
    await page.waitForTimeout(400);
    for (const rail of ['wire', 'settings', 'workers', 'plugins', 'runtime'] as const) {
      await page.getByTestId(`axis-studio-rail-${rail}`).click();
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  await record('drawing-trend', async (page) => {
    const group = page.locator('[data-drawing-group="lines"] button').first();
    if (await group.count()) {
      await group.click();
      const item = page.locator('[data-drawing-flyout] button').first();
      if (await item.count()) await item.click();
      const box = await page.locator('[data-axis-panes]').first().boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.7);
        await page.mouse.down();
        await page.waitForTimeout(80);
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(800);
      }
    }
  });

  await record('bar-replay', async (page) => {
    await page.getByTestId('axis-btn-bar-replay').click();
    await page.waitForTimeout(300);
    if (await page.getByTestId('axis-bar-replay-play').count()) {
      await page.getByTestId('axis-bar-replay-play').click();
      await page.waitForTimeout(4_000);
      await page.getByTestId('axis-bar-replay-exit').click().catch(() => undefined);
    }
    await page.waitForTimeout(400);
  });

  await record('onchain-attach', async (page) => {
    await page.getByTestId('axis-btn-onchain').click();
    await page.waitForTimeout(500);
    const chip = page.locator('[data-testid="axis-onchain-popular-chips"] button').first();
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(4_000);
    }
  });

  await record('theme-switch', async (page) => {
    await page.getByTestId('axis-btn-studio').click();
    await page.getByTestId('axis-studio-rail-settings').click();
    await page.waitForTimeout(400);
    const chips = page.getByTestId('axis-theme-panel').locator('button');
    const n = Math.min(await chips.count(), 4);
    for (let i = 0; i < n; i++) {
      await chips.nth(i).click();
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  });
}

async function captureCli() {
  log('\n— cli —');
  ensureDir(join(OUT, 'cli'));
  const bin = join(ROOT, 'packages/cli/bin/axis.js');
  const help = spawnSync('bun', [bin, '--help'], { encoding: 'utf8', cwd: ROOT });
  const doctor = spawnSync('bun', [bin, 'doctor'], { encoding: 'utf8', cwd: ROOT, timeout: 30_000 });
  const helpText = (help.stdout || help.stderr || '').trim() || 'axis --help failed';
  const doctorText = (doctor.stdout || doctor.stderr || '').trim() || 'axis doctor failed';

  const htmlFor = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:#050505;color:#e8e6e3;font:15px/1.45 "IBM Plex Mono", ui-monospace, monospace;}
  .term{min-height:100vh;padding:28px 32px 36px;box-sizing:border-box;}
  .bar{display:flex;gap:8px;margin-bottom:18px;opacity:.55}
  .dot{width:10px;height:10px;border-radius:50%;background:#3f3f46}
  pre{margin:0;white-space:pre-wrap;word-break:break-word;}
  .prompt{color:#F97316}
</style></head>
<body><div class="term">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <pre><span class="prompt">$</span> ${title}\n\n${escapeHtml(body)}</pre>
</div></body></html>`;

  function escapeHtml(s: string) {
    return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.setContent(htmlFor('axis --help', helpText), { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, 'cli/help.png'), fullPage: true, type: 'png' });
  captured.push('cli/help.png');
  log('  ✓ cli/help.png');
  await page.setContent(htmlFor('axis doctor', doctorText), { waitUntil: 'load' });
  await page.screenshot({ path: join(OUT, 'cli/doctor.png'), fullPage: true, type: 'png' });
  captured.push('cli/doctor.png');
  log('  ✓ cli/doctor.png');
  await browser.close();
}

function composeOg() {
  const hero = join(OUT, 'landing/axis-hero.png');
  const dest = join(OUT, 'landing/axis-og.png');
  if (!existsSync(hero)) return;
  const r = spawnSync(
    'convert',
    [
      '-size',
      '1200x630',
      'xc:#050505',
      '(',
      hero,
      '-resize',
      '1040x',
      '-gravity',
      'center',
      '-extent',
      '1040x520',
      ')',
      '-gravity',
      'south',
      '-geometry',
      '+0+28',
      '-composite',
      dest,
    ],
    { encoding: 'utf8' },
  );
  if (r.status === 0) {
    captured.push('landing/axis-og.png');
    log('  ✓ landing/axis-og.png');
  } else {
    log(`  ! og compose: ${r.stderr?.slice(0, 200)}`);
  }
}

function writeManifests() {
  const common = `Captured ${DATE} from ${URL}
Viewport desktop 1440×900 @2x; mobile 390×844 @2x.
Seed: BTCUSDT 1d Binance REST, void dark, SMA Cross / RSI v6.
No secrets. Chart data is public CEX OHLCV.
`;
  ensureDir(join(OUT, 'app'));
  ensureDir(join(OUT, 'studio'));
  ensureDir(join(OUT, 'cli'));
  ensureDir(join(OUT, 'landing'));
  ensureDir(join(OUT, 'gifs'));
  writeFileSync(join(OUT, 'README.md'), `# AXIS interface screenshots

| Dir | Contents |
| --- | --- |
| [\`app/\`](app/) | PWA chrome, chart, editor, research panels |
| [\`studio/\`](studio/) | Runtime / Wire / Settings / Workers / Plugins |
| [\`cli/\`](cli/) | \`axis --help\` and \`axis doctor\` |
| [\`landing/\`](landing/) | Finish-cut hero + feature tiles for hoox.sh/axis |
| [\`gifs/\`](gifs/) | Short looping tours |

Gallery: [Interface gallery](../enduser/guides/screenshots.mdx).

${common}
`);
  writeFileSync(join(OUT, 'app/MANIFEST.md'), `# App stills\n\n${common}\nFiles:\n${captured.filter((c) => c.startsWith('app/')).map((c) => `- \`${c}\``).join('\n')}\n`);
  writeFileSync(join(OUT, 'studio/MANIFEST.md'), `# Studio stills\n\n${common}\nFiles:\n${captured.filter((c) => c.startsWith('studio/')).map((c) => `- \`${c}\``).join('\n')}\n`);
  writeFileSync(join(OUT, 'cli/MANIFEST.md'), `# CLI stills\n\nDark terminal render of AXIS CLI stdout. Not a live TTY recording.\n\n${common}\n`);
  writeFileSync(join(OUT, 'landing/MANIFEST.md'), `# Landing crops\n\nHero is a full workspace still (no fake browser chrome — landing CSS supplies the CRT frame).\nTiles are locator crops. OG is a 1200×630 composite.\n\n${common}\n`);
  writeFileSync(join(OUT, 'gifs/MANIFEST.md'), `# GIFs\n\nPlaywright WebM → ffmpeg palette GIF, 8 fps, 1280 wide, loop.\n\n${common}\nFiles:\n${captured.filter((c) => c.startsWith('gifs/')).map((c) => `- \`${c}\``).join('\n')}\n`);
}

async function main() {
  ensureDir(join(OUT, 'app'));
  ensureDir(join(OUT, 'studio'));
  ensureDir(join(OUT, 'landing'));
  ensureDir(join(OUT, 'gifs'));
  log(`Capturing ${URL} → ${OUT}`);

  const browser = await chromium.launch({ headless: true });
  if (!GIFS_ONLY) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
    });
    await seedContext(context);
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await waitShell(page);
    await loadHistory(page);
    const ran = await runScript(page);
    log(ran ? '  engine run ok' : '  engine run skipped/failed — stills continue');
    await captureStills(page);
    await context.close();

    await captureMobile(async () =>
      browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        isMobile: true,
        hasTouch: true,
      }),
    );
  }

  if (!SKIP_GIFS) {
    await captureGifs(browser);
  }
  await browser.close();

  if (!SKIP_CLI) {
    await captureCli();
  }

  for (const tile of [
    'landing/axis-chart.png',
    'landing/axis-editor.png',
    'landing/axis-drawings.png',
    'landing/axis-onchain.png',
    'landing/axis-results.png',
    'landing/axis-studio.png',
    'landing/axis-mobile.png',
  ]) {
    await padPng(tile, 20);
  }
  await webp('landing/axis-hero.png');
  composeOg();
  writeManifests();

  log(`\nCaptured ${captured.length} files, ${failures.length} failures`);
  for (const f of failures) log(`  fail: ${f}`);
  if (captured.length < 8) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
