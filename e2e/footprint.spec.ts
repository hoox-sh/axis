/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @smoke Footprint overlay (A1.3.2).
 *
 * Layers → Footprint paints per-candle cells from the OHLCV estimate. Guards
 * the wiring (LayerPanel row → toggle signal → overlay) and the honest badge,
 * with no network and no engine run.
 */
import { test, expect } from '@playwright/test';
import { stubAppNetwork, loadMockBars } from './charts';

test.describe('footprint overlay @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page);
  });

  test('Layers → Footprint paints estimate cells', async ({ page }) => {
    // Wide bars: rows need a few pixels each, so a dense window would be noise.
    await loadMockBars(page, { historyBars: 120 });

    const layers = page.getByTestId('axis-btn-layers');
    await expect(layers).toBeVisible();
    if ((await layers.getAttribute('aria-pressed')) !== 'true') {
      await layers.click();
    }

    const row = page.getByTestId('axis-layers-footprint');
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Show Footprint/i }).click();

    const overlay = page.getByTestId('axis-footprint');
    await expect(overlay).toBeVisible({ timeout: 15_000 });

    // One group per painted bar, one rect pair per price row.
    const groups = overlay.locator('svg > g[data-bar-time]');
    await expect.poll(async () => groups.count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const rects = overlay.locator('svg rect');
    expect(await rects.count()).toBeGreaterThan(10);

    // Never claim tick accuracy: the badge says it is an estimate.
    const badge = page.getByTestId('axis-footprint-badge');
    await expect(badge).toContainText(/OHLCV est\./);
    await expect(badge).toHaveAttribute('data-rows', /\d+/);

    // Toggling off removes the overlay.
    await row.getByRole('button', { name: /Hide Footprint/i }).click();
    await expect(page.getByTestId('axis-footprint')).toHaveCount(0);
  });
});
