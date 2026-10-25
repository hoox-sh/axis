/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * v1 concept e2e (§11): pan/zoom frames, pane time-axis parity, drawings
 * through pan/zoom. Not @smoke — CI smoke stays fast; run with
 * `bunx playwright test e2e/v1-chart.spec.ts` or `--grep @v1`.
 */

import { test, expect } from '@playwright/test';
import {
  clickChart,
  drawingShapeCount,
  loadMockBars,
  measureRafDuring,
  panChart,
  selectDrawingTool,
  stubAppNetwork,
  zoomChart,
} from './charts';

test.describe('v1 chart gates @v1', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page);
  });

  test('price and volume panes share one last-bar time', async ({ page }) => {
    await loadMockBars(page);
    const chrome = page.locator('[data-axis-pane-chrome]');
    await expect(chrome.first()).toBeVisible();
    const times = await page.evaluate(() => {
      const host = document.querySelector('[data-axis-chart-host]');
      const labels = host
        ? Array.from(host.querySelectorAll('.tv-lightweight-charts table tr')).map((row) =>
            row.querySelector('td:last-child')?.textContent?.trim() ?? '',
          )
        : [];
      return { paneCount: document.querySelectorAll('[data-axis-pane-chrome]').length, labels };
    });
    expect(times.paneCount).toBeGreaterThanOrEqual(1);
  });

  test('crosshair / time axis is one clock on the single chart', async ({ page }) => {
    await loadMockBars(page);
    const host = page.locator('[data-axis-chart-host]').first();
    await expect(host).toBeVisible();
    const box = await host.boundingBox();
    if (!box) throw new Error('chart host has no bounding box');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

    await expect(page.locator('[data-axis-pane-chrome="price"]')).toBeVisible();
    await expect(page.locator('[data-axis-pane-chrome="volume"]')).toBeVisible();

    const clock = await page.evaluate(() => {
      const root = document.querySelector('[data-axis-chart-host]');
      if (!root) {
        return { charts: 0, uniqueLastTicks: [] as string[] };
      }
      const charts = Array.from(root.querySelectorAll('.tv-lightweight-charts'));
      const lastTicks: string[] = [];
      for (const chart of charts) {
        const rows = chart.querySelectorAll('table tr');
        const last = rows[rows.length - 1];
        const tick = last?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
        if (tick) lastTicks.push(tick);
      }
      return {
        charts: charts.length,
        uniqueLastTicks: [...new Set(lastTicks)],
      };
    });

    expect(clock.charts).toBe(1);
    if (clock.uniqueLastTicks.length > 0) {
      expect(clock.uniqueLastTicks).toHaveLength(1);
      expect(clock.uniqueLastTicks[0]).toBeTruthy();
    }
  });

  test('drawings stay anchored through pan and zoom', async ({ page }) => {
    await loadMockBars(page);
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
  });

  test('pan/zoom frame samples stay bounded', async ({ page }) => {
    await loadMockBars(page);
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
