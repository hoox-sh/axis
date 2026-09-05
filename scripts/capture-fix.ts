/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Second pass: recapture cluttered full-page stills with only the relevant chrome,
 * copy landing hero crops, mobile, CLI, OG.
 */
import { chromium, type Locator, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const OUT = join(ROOT, 'docs', 'images');
const URL = process.env.AXIS_CAPTURE_URL || 'https://axis.hoox.sh';

const RSI = `//@version=6
indicator("RSI", overlay=false)
length = input.int(14, "RSI Length", minval=2, maxval=100)
rsi = ta.rsi(close, length)
plot(rsi, "RSI", color=color.purple)
hline(70, "Overbought", color=color.red)
hline(30, "Oversold", color=color.green)
`;

const EXTRA = [
  'axis-btn-indicators',
  'axis-btn-library',
  'axis-btn-layers',
  'axis-btn-datasource',
  'axis-btn-onchain',
  'axis-btn-alerts',
  'axis-btn-scriptlogs-top',
  'axis-btn-systemlogs',
  'axis-btn-dataview',
];

async function shot(page: Page, rel: string, loc?: Locator) {
  const dest = join(OUT, rel);
  mkdirSync(join(dest, '..'), { recursive: true });
  if (loc) await loc.screenshot({ path: dest, type: 'png', animations: 'disabled' });
  else await page.screenshot({ path: dest, type: 'png', animations: 'disabled' });
  console.log('  ✓', rel);
}

async function closeExtras(page: Page, keep: string[] = []) {
  for (const id of EXTRA) {
    if (keep.includes(id)) continue;
    const btn = page.getByTestId(id);
    if (!(await btn.count())) continue;
    if ((await btn.getAttribute('aria-pressed')) === 'true') {
      await btn.click({ force: true });
      await page.waitForTimeout(150);
    }
  }
  const logs = page.getByTestId('axis-btn-systemlogs');
  if ((await logs.count()) && (await logs.getAttribute('aria-pressed')) === 'true') {
    await logs.click({ force: true });
  }
}

async function waitReady(page: Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 45_000 });
  await page.waitForTimeout(800);
}

async function load(page: Page) {
  await page.getByTestId('axis-btn-load').click({ force: true });
  await page.waitForTimeout(2_500);
  await page.waitForFunction(
    () => [...document.querySelectorAll('canvas')].some((c) => (c as HTMLCanvasElement).width > 200),
    { timeout: 25_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(600);
}

async function main() {
  mkdirSync(join(OUT, 'landing'), { recursive: true });
  mkdirSync(join(OUT, 'cli'), { recursive: true });
  mkdirSync(join(OUT, 'app'), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  await context.addInitScript((doc: string) => {
    try { localStorage.setItem('pynescript.axis.editor.doc', doc); } catch { /* */ }
  }, RSI);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitReady(page);
  await load(page);
  await page.getByTestId('axis-btn-run').click({ force: true });
  await page.waitForTimeout(3_000);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await closeExtras(page);

  // Drawings: chart + toolbar + fib
  console.log('— drawings —');
  await closeExtras(page);
  const toolbar = page.getByTestId('axis-drawing-toolbar');
  await shot(page, 'app/drawings-toolbar.png', toolbar);
  const fibGroup = page.locator('[data-drawing-group="fib"] button').first();
  await fibGroup.click({ force: true });
  const fibItem = page.locator('[data-drawing-flyout] button').first();
  if (await fibItem.count()) await fibItem.click({ force: true });
  const box = await page.locator('[data-axis-panes]').first().boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.65);
    await page.waitForTimeout(150);
    await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.28);
    await page.waitForTimeout(400);
  }
  await shot(page, 'app/drawings-fib.png');
  await shot(page, 'landing/axis-drawings.png');
  await page.locator('[data-drawing-group="select"] button').first().click({ force: true }).catch(() => undefined);

  // Volume profile
  console.log('— volume profile —');
  await closeExtras(page);
  await page.getByTestId('axis-btn-layers').click({ force: true });
  await page.waitForTimeout(300);
  const vpToggle = page.getByTestId('axis-layers').getByText(/volume profile/i).first();
  if (await vpToggle.count()) {
    await vpToggle.click({ force: true });
    await page.waitForTimeout(700);
  }
  await shot(page, 'app/volume-profile.png');
  await closeExtras(page);

  // On-chain: chart + panel
  console.log('— on-chain —');
  await closeExtras(page);
  await page.getByTestId('axis-btn-onchain').click({ force: true });
  await page.waitForTimeout(400);
  await shot(page, 'app/onchain-panel.png', page.getByTestId('axis-onchain'));
  const chip = page.locator('[data-testid="axis-onchain-popular-chips"] button').first();
  if (await chip.count()) {
    await chip.click({ force: true });
    await page.waitForTimeout(4_000);
  }
  await shot(page, 'app/onchain-tvl.png');
  await shot(page, 'landing/axis-onchain.png');
  const dex = page.getByRole('tab', { name: 'DEX' });
  if (await dex.count()) {
    await dex.click({ force: true });
    await page.waitForTimeout(400);
    await shot(page, 'app/onchain-dex.png');
  }
  await closeExtras(page);

  // Compare
  console.log('— compare —');
  const compare = page.getByTestId('axis-compare-enabled');
  if (await compare.count()) {
    await compare.click({ force: true });
    const field = page.getByTestId('axis-compare-symbol');
    if (await field.count()) {
      await field.fill('ETHUSDT');
      await field.press('Enter');
      await page.waitForTimeout(3_500);
    }
    await shot(page, 'app/compare.png');
    await compare.click({ force: true }).catch(() => undefined);
  }

  // Bar replay
  console.log('— replay —');
  await page.getByTestId('axis-btn-bar-replay').click({ force: true });
  await page.waitForTimeout(400);
  if (await page.getByTestId('axis-bar-replay-controls').count()) {
    await page.getByTestId('axis-bar-replay-step-back').click({ force: true, clickCount: 8 }).catch(() => undefined);
    await page.waitForTimeout(250);
    await shot(page, 'app/bar-replay.png');
    await page.getByTestId('axis-bar-replay-exit').click({ force: true }).catch(() => undefined);
  }

  // 2x2
  console.log('— layout 2x2 —');
  await page.getByTestId('axis-btn-layouts').click({ force: true });
  await page.waitForTimeout(200);
  await page.getByTestId('axis-layout-mode-4').click({ force: true });
  await page.waitForTimeout(3_000);
  await shot(page, 'app/chart-layout-2x2.png');
  await page.getByTestId('axis-btn-layouts').click({ force: true });
  await page.getByTestId('axis-layout-mode-1').click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(500);

  // Theme tab
  console.log('— theme —');
  await page.getByTestId('axis-btn-studio').click({ force: true });
  await page.getByTestId('axis-studio-rail-settings').click();
  await page.waitForTimeout(300);
  const themeTab = page.getByTestId('axis-settings-tab-theme').or(page.getByRole('tab', { name: 'Theme' }));
  if (await themeTab.count()) {
    await themeTab.click({ force: true });
    await page.waitForTimeout(300);
    await shot(page, 'app/theme-panel.png');
  }
  await page.keyboard.press('Escape');

  await context.close();

  // Mobile
  console.log('— mobile —');
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
  });
  await mobile.addInitScript((doc: string) => {
    try { localStorage.setItem('pynescript.axis.editor.doc', doc); } catch { /* */ }
  }, RSI);
  const mp = await mobile.newPage();
  await mp.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await mp.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 45_000 });
  await mp.waitForTimeout(2_000);
  await mp.screenshot({ path: join(OUT, 'app/workspace-mobile.png'), type: 'png', animations: 'disabled' });
  copyFileSync(join(OUT, 'app/workspace-mobile.png'), join(OUT, 'landing/axis-mobile.png'));
  console.log('  ✓ app/workspace-mobile.png');
  await mobile.close();
  await browser.close();

  // Landing copies from best stills
  const copies: [string, string][] = [
    ['app/workspace.png', 'landing/axis-hero.png'],
    ['app/workspace.png', 'app/run-rsi.png'],
    ['app/workspace.png', 'app/load-ready.png'],
    ['app/chart-panes.png', 'landing/axis-chart.png'],
    ['app/editor.png', 'landing/axis-editor.png'],
    ['studio/wire.png', 'landing/axis-studio.png'],
    ['app/results-drawer.png', 'landing/axis-results.png'],
  ];
  for (const [src, dst] of copies) {
    const a = join(OUT, src);
    const b = join(OUT, dst);
    if (existsSync(a)) {
      copyFileSync(a, b);
      console.log('  copy', src, '→', dst);
    }
  }

  spawnSync('convert', [join(OUT, 'landing/axis-hero.png'), '-quality', '92', join(OUT, 'landing/axis-hero.webp')]);
  const og = spawnSync(
    'convert',
    [
      '-size', '1200x630', 'xc:#050505',
      '(', join(OUT, 'landing/axis-hero.png'), '-resize', '1100x', ')',
      '-gravity', 'center', '-composite',
      join(OUT, 'landing/axis-og.png'),
    ],
    { encoding: 'utf8' },
  );
  if (og.status === 0) console.log('  ✓ landing/axis-og.png');
  else console.log('  ! og', og.stderr?.slice(0, 200));

  // CLI
  console.log('— cli —');
  const bin = join(ROOT, 'packages/cli/bin/axis.js');
  const help = spawnSync('bun', [bin, '--help'], { encoding: 'utf8', cwd: ROOT });
  const doctor = spawnSync('bun', [bin, 'doctor'], { encoding: 'utf8', cwd: ROOT, timeout: 30_000 });
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const html = (cmd: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#050505;color:#e8e6e3;font:14px/1.45 ui-monospace, "IBM Plex Mono", monospace}
    .t{padding:28px 32px} .p{color:#F97316} pre{white-space:pre-wrap;margin:0}
  </style></head><body><div class="t"><pre><span class="p">$</span> ${cmd}\n\n${esc(body)}</pre></div></body></html>`;
  const b2 = await chromium.launch({ headless: true });
  const c2 = await b2.newContext({ viewport: { width: 1100, height: 740 }, deviceScaleFactor: 2 });
  const p2 = await c2.newPage();
  await p2.setContent(html('axis --help', (help.stdout || help.stderr || '').trim()));
  await p2.screenshot({ path: join(OUT, 'cli/help.png'), fullPage: true, type: 'png' });
  await p2.setContent(html('axis doctor', (doctor.stdout || doctor.stderr || '').trim()));
  await p2.screenshot({ path: join(OUT, 'cli/doctor.png'), fullPage: true, type: 'png' });
  console.log('  ✓ cli/help.png cli/doctor.png');
  await b2.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
