/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Data Window: crosshair rows, pin/step, value search, copy, and collapse.
 * Bars come from mock-walk; a seeded `lastRun` supplies one plot series.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, seedAxisStore, stubAppNetwork } from './charts';

const SERIES = Array.from({ length: 3000 }, (_, i) => 42000 + Math.sin(i / 8) * 400);

async function openDataWindow(page: import('@playwright/test').Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-dataview');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-dataview').first()).toBeVisible();
}

async function hoverChart(page: import('@playwright/test').Page, xRatio = 0.55) {
  const host = page.locator('[data-axis-chart-host]').first();
  const box = await host.boundingBox();
  if (!box) throw new Error('chart host has no bounding box');
  await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * 0.45);
}

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await seedAxisStore(page, {
    scripts: [
      {
        id: 'ind_sma',
        name: 'AXIS SMA',
        code: '//@version=6\nindicator("AXIS SMA", overlay=true)\nplot(ta.sma(close, 20), "SMA")',
        paneId: 'price',
        visible: true,
        plots: { SMA: { color: '#8B9CFF' } },
      },
    ],
    lastRun: {
      status: 'success',
      series: { SMA: SERIES },
      meta: { plot_meta: { SMA: { title: 'SMA', color: '#8B9CFF', kind: 'plot' } } },
    },
    drawings: [
      { id: 'd_hline', kind: 'hline', color: '#3DDC97', price: 42100, meta: { symbol: 'BTCUSDT' } },
    ],
  });
  await loadMockBars(page, { historyBars: 300 });
  await openDataWindow(page);
});

test('data window: crosshair values, pin, step, search, copy, collapse', async ({ page }) => {
  const panel = page.getByTestId('axis-dataview').first();

  // No crosshair yet → explicit empty state with a shortcut.
  await expect(panel.getByTestId('axis-dataview-empty')).toBeVisible();
  await panel.getByTestId('axis-dataview-inspect-last').click();
  await expect(panel.getByTestId('axis-dataview-pin')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByTestId('axis-dataview-time')).toContainText('UTC');
  await expect(panel.getByTestId('axis-dataview-bar').first()).toBeVisible();

  // Unpin and hover the chart.
  await panel.getByTestId('axis-dataview-pin').click();
  await hoverChart(page);
  await expect(panel.getByTestId('axis-dataview-time')).toContainText('UTC');
  await expect(panel.getByTestId('axis-dataview-ohlcv')).toContainText('Close');
  await expect(panel.getByTestId('axis-dataview-ohlcv')).toContainText('Change');
  await expect(panel.getByTestId('axis-dataview-plots')).toContainText('SMA');
  await expect(panel.getByTestId('axis-dataview-drawings')).toContainText('Horizontal line');

  // Pin freezes the bar while the crosshair moves.
  const pinnedIndex = await panel
    .getByTestId('axis-dataview-time')
    .locator('.ax-dataview-bar')
    .textContent();
  await panel.getByTestId('axis-dataview-pin').click();
  await hoverChart(page, 0.3);
  await expect(panel.getByTestId('axis-dataview-time')).toContainText('pinned');
  await expect(panel.getByTestId('axis-dataview-time').locator('.ax-dataview-bar')).toHaveText(
    pinnedIndex ?? '',
  );

  // Step forward / back moves the pinned index.
  await panel.getByTestId('axis-dataview-next').click();
  await expect(panel.getByTestId('axis-dataview-time').locator('.ax-dataview-bar')).not.toHaveText(
    pinnedIndex ?? '',
  );
  await panel.getByTestId('axis-dataview-prev').click();
  await expect(panel.getByTestId('axis-dataview-time').locator('.ax-dataview-bar')).toHaveText(
    pinnedIndex ?? '',
  );

  // Search filters values across groups.
  await panel.getByTestId('axis-dataview-search').fill('sma');
  await expect(panel.getByTestId('axis-dataview-plots')).toBeVisible();
  await expect(panel.getByTestId('axis-dataview-ohlcv')).toHaveCount(0);
  await expect(panel.getByTestId('axis-dataview-drawings')).toHaveCount(0);
  await panel.getByTestId('axis-dataview-search').press('Escape');
  await expect(panel.getByTestId('axis-dataview-ohlcv')).toBeVisible();

  // Copy a row and all values.
  await panel.getByTestId('axis-dataview-ohlcv').hover();
  await panel.locator('.ax-dataview-row[data-key="close"] .ax-dataview-copy').click();
  await expect(panel).toContainText('Copied Close');
  await panel.getByTestId('axis-dataview-copy-all').click();
  await expect(panel).toContainText('Copied');

  // Collapse a group.
  await panel.getByTestId('axis-dataview-ohlcv').locator('.ax-dataview-section-head').click();
  await expect(panel.getByTestId('axis-dataview-ohlcv').locator('.ax-dataview-row')).toHaveCount(0);
  await panel.getByTestId('axis-dataview-ohlcv').locator('.ax-dataview-section-head').click();
  await expect(
    panel.getByTestId('axis-dataview-ohlcv').locator('.ax-dataview-row').first(),
  ).toBeVisible();
});
