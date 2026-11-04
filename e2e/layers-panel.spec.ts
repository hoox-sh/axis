/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Layers panel: search, hidden-only filter, collapsible sections (persisted),
 * drawing lock/visibility/remove, and the symbol-scoped overflow menu.
 *
 * Scripts and drawings are seeded, so no engine run is involved.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, seedAxisStore, stubAppNetwork } from './charts';

const SMA = `//@version=6
indicator("AXIS SMA", overlay=true)
plot(ta.sma(close, 20), "SMA")`;
const RSI = `//@version=6
indicator("AXIS RSI", overlay=false)
plot(ta.rsi(close, 14), "RSI")`;

const DRAWINGS = [
  { id: 'd_hline', kind: 'hline', color: '#8B9CFF', price: 42100, meta: { symbol: 'BTCUSDT' } },
  {
    id: 'd_trend',
    kind: 'trend',
    color: '#3DDC97',
    p1: { time: 1700000000, price: 41000 },
    p2: { time: 1700100000, price: 43000 },
    meta: { symbol: 'BTCUSDT' },
  },
  {
    id: 'd_text',
    kind: 'text',
    color: '#F07178',
    text: 'Breakout',
    p1: { time: 1700000000, price: 42500 },
    meta: { symbol: 'BTCUSDT', hidden: true },
  },
];

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await seedAxisStore(page, {
    scripts: [
      {
        id: 'ind_sma',
        name: 'AXIS SMA',
        code: SMA,
        paneId: 'price',
        visible: true,
        plots: { SMA: { color: '#8B9CFF' } },
      },
      {
        id: 'ind_rsi',
        name: 'AXIS RSI',
        code: RSI,
        paneId: 'ind_rsi',
        visible: true,
        plots: { RSI: { color: '#E8B84A' } },
      },
    ],
    drawings: DRAWINGS,
  });
  await loadMockBars(page, { historyBars: 200 });
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-layers');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-layers')).toBeVisible();
});

test('layers panel: search, hidden filter, sections, drawings', async ({ page }) => {
  const summary = page.getByTestId('axis-layers-summary');
  await expect(summary).toContainText('2 scripts');
  await expect(summary).toContainText('3 drawings');
  await expect(summary).toContainText('1 hidden');

  const scripts = page.getByTestId('axis-layers-section-scripts');
  const drawings = page.getByTestId('axis-layers-section-drawings');
  await expect(scripts.getByRole('listitem')).toHaveCount(2);
  await expect(drawings.locator('li[data-drawing-id]')).toHaveCount(3);

  // Search spans sections: one script, no drawings, no panes.
  await page.getByTestId('axis-layers-search').fill('rsi');
  await expect(page.getByTestId('axis-layers-filterbar')).toContainText('1 match');
  await expect(scripts.getByRole('listitem')).toHaveCount(1);
  await expect(scripts).toContainText('AXIS RSI');
  await expect(drawings.locator('li[data-drawing-id]')).toHaveCount(0);
  await expect(drawings).toContainText('No drawings match');
  await page.getByTestId('axis-layers-search').press('Escape');
  await expect(page.getByTestId('axis-layers-search')).toHaveValue('');
  await expect(scripts.getByRole('listitem')).toHaveCount(2);

  // Hidden-only filter keeps the hidden text drawing.
  await page.getByTestId('axis-layers-hidden-only').click();
  await expect(page.getByTestId('axis-layers-filterbar')).toContainText('Hidden only');
  await expect(drawings.locator('li[data-drawing-id]')).toHaveCount(1);
  await expect(drawings).toContainText('Breakout');
  await page.getByTestId('axis-layers-hidden-only').click();

  // Drawing rows: hide, lock, remove.
  const hline = page.locator('li[data-drawing-id="d_hline"]');
  await hline.getByRole('button', { name: /Hide H · 42100.00/ }).click();
  await expect(hline.locator('.ax-layers-row')).toHaveAttribute('data-hidden', 'true');
  await hline.getByRole('button', { name: /Show H · 42100.00/ }).click();
  await expect(hline.locator('.ax-layers-row')).not.toHaveAttribute('data-hidden', 'true');

  const lock = hline.getByRole('button', { name: /Lock H · 42100.00/ });
  await lock.click();
  await expect(hline.getByRole('button', { name: /Unlock H · 42100.00/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await hline.getByRole('button', { name: /Remove drawing: H · 42100.00/ }).click();
  await expect(drawings.locator('li[data-drawing-id]')).toHaveCount(2);

  // Section bulk visibility for drawings.
  await drawings.getByRole('button', { name: 'Hide all drawings' }).click();
  await expect(drawings.locator('.ax-layers-row[data-hidden="true"]')).toHaveCount(2);
  await drawings.getByRole('button', { name: 'Show all drawings' }).click();
  await expect(drawings.locator('.ax-layers-row[data-hidden="true"]')).toHaveCount(0);

  // Symbol-scoped overflow menu exposes the management actions.
  await page.getByTestId('axis-layers-drawings-menu').click();
  const menu = page.getByTestId('axis-layers-drawings-menu-row');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('axis-layers-duplicate-drawings')).toBeVisible();
  await expect(menu.getByTestId('axis-layers-keep-symbol')).toBeVisible();
  await expect(menu.getByTestId('axis-layers-tag-symbol')).toBeVisible();
  await menu.getByTestId('axis-layers-duplicate-drawings').click();
  await expect(drawings.locator('li[data-drawing-id]')).toHaveCount(4);
});

test('layers panel: collapsed sections persist across reload', async ({ page }) => {
  const scripts = page.getByTestId('axis-layers-section-scripts');
  await expect(scripts.getByRole('listitem')).toHaveCount(2);
  await scripts.locator('[title="Collapse Scripts"]').click();
  await expect(scripts.getByRole('listitem')).toHaveCount(0);
  await expect(scripts.locator('[title="Expand Scripts"]')).toBeVisible();

  await page.reload();
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-layers');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  const scriptsAfter = page.getByTestId('axis-layers-section-scripts');
  await expect(scriptsAfter.locator('[title="Expand Scripts"]')).toBeVisible();
  await expect(scriptsAfter.getByRole('listitem')).toHaveCount(0);
  await scriptsAfter.locator('[title="Expand Scripts"]').click();
  await expect(scriptsAfter.getByRole('listitem')).toHaveCount(2);
});
