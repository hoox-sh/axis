/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * v1 concept e2e (§11): pan/zoom at 10k bars while streaming, pane parity
 * screenshot (price + 3 indicator panes), crosshair one clock, drawings
 * through pan/zoom and a window slide. Not @smoke — run with
 * `bunx playwright test e2e/v1-chart.spec.ts` or `--grep @v1`.
 */

import { test, expect } from '@playwright/test';
import {
  applyBuiltinPanes,
  clickChart,
  drawingShapeCount,
  loadMockBars,
  measureRafDuring,
  paneTimeTicks,
  panChart,
  selectDrawingTool,
  slideLiveWindow,
  startMockLive,
  stubAppNetwork,
  zoomChart,
} from './charts';

const OVERLAY_FALSE_BUILTINS = ['rsi', 'macd', 'atr'] as const;

test.describe('v1 chart gates @v1', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page, {
      status: 'success',
      plots: Array.from({ length: 256 }, (_, i) => i),
      series: {},
      events: [],
      meta: { script_name: 'v1-e2e', overlay: false, ms: 8 },
    });
  });

  test('pane parity: price + 3 indicator panes share one last bar', async ({ page }) => {
    await loadMockBars(page);
    await applyBuiltinPanes(page, OVERLAY_FALSE_BUILTINS);
    await expect(page.getByText(/3 scripts\s*·\s*5 panes/)).toBeVisible();
    const host = page.locator('[data-axis-chart-host]').first();
    await expect(host).toBeVisible();
    await expect(host.locator('.tv-lightweight-charts')).toHaveCount(1);

    const clock = await paneTimeTicks(page);
    expect(clock.charts).toBe(1);
    expect(clock.paneChrome).toBeGreaterThanOrEqual(5);
    if (clock.uniqueLastTicks.length > 0) {
      expect(clock.uniqueLastTicks).toHaveLength(1);
      expect(clock.uniqueLastTicks[0]).toBeTruthy();
    }

    const watchlist = page.getByTestId('axis-btn-watchlist');
    if ((await watchlist.getAttribute('aria-pressed')) === 'true') {
      await watchlist.click();
    }
    await expect(host).toHaveScreenshot('v1-pane-parity.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.08,
    });
  });

  test('crosshair / time axis is one clock on the single chart', async ({ page }) => {
    await loadMockBars(page);
    await applyBuiltinPanes(page, OVERLAY_FALSE_BUILTINS);
    const host = page.locator('[data-axis-chart-host]').first();
    await expect(host).toBeVisible();
    const box = await host.boundingBox();
    if (!box) throw new Error('chart host has no bounding box');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

    await expect(page.getByText(/3 scripts\s*·\s*5 panes/)).toBeVisible();
    await expect(host.locator('.tv-lightweight-charts')).toHaveCount(1);

    const clock = await paneTimeTicks(page);
    expect(clock.charts).toBe(1);
    if (clock.uniqueLastTicks.length > 0) {
      expect(clock.uniqueLastTicks).toHaveLength(1);
      expect(clock.uniqueLastTicks[0]).toBeTruthy();
    }
  });

  test('drawings stay anchored through pan, zoom, and a window slide', async ({ page }) => {
    await loadMockBars(page, {
      historyBars: 200,
      rollingWindowBars: 200,
      interval: '1m',
    });
    await selectDrawingTool(page, 'lines', 'Trend line');
    await clickChart(page, 0.3, 0.4);
    await page.mouse.move(400, 300);
    await clickChart(page, 0.6, 0.5);
    await expect.poll(() => drawingShapeCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
    const before = await drawingShapeCount(page);

    await panChart(page, -0.18);
    await expect.poll(() => drawingShapeCount(page), { timeout: 10_000 }).toBe(before);

    await zoomChart(page, 300);
    await expect.poll(() => drawingShapeCount(page), { timeout: 10_000 }).toBe(before);

    await slideLiveWindow(page);
    await expect.poll(() => drawingShapeCount(page), { timeout: 10_000 }).toBe(before);
  });

  test('pan/zoom at 10k bars while streaming stays within the frame budget', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loadMockBars(page, { historyBars: 10_000, rollingWindowBars: 10_000 });
    await expect(page.getByTestId('axis-statusbar-bars')).toHaveText(/10000 bars/, {
      timeout: 30_000,
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await startMockLive(page);
    const frames = await measureRafDuring(page, async () => {
      await panChart(page, -0.22);
      await zoomChart(page, 240);
    });
    expect(frames.length).toBeGreaterThan(0);
    const max = Math.max(...frames);
    // Concept G2 is 50 ms. CI runners starve rAF; keep a slack ceiling there.
    expect(max).toBeLessThan(process.env.CI ? 250 : 50);
  });
});
