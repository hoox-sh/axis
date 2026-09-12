/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawings overlay e2e — exercises the browser-bound drawing layer
 * (`src/chart/drawing-layer.ts`, drawing tools, pane chart host) that unit
 * tests cannot reach without a real layout engine + canvas.
 *
 * Flow: stub network → load mock bars → pick Trend line → two chart clicks →
 * SVG shape appears → reload → shape persists from storage.
 *
 * Run: `bunx playwright test e2e/drawings.spec.ts`
 */

import { test, expect } from '@playwright/test';
import {
  clickChart,
  drawingShapeCount,
  loadMockBars,
  selectDrawingTool,
  stubAppNetwork,
} from './charts';

test.describe('Drawings overlay', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page);
  });

  test('draws a trend line and persists it across reload', async ({ page }) => {
    await loadMockBars(page);
    await selectDrawingTool(page, 'Lines', 'Trend line');

    const before = await drawingShapeCount(page);
    // Two placement clicks with a move between (draft preview path).
    await clickChart(page, 0.3, 0.4);
    await page.mouse.move(400, 300);
    await clickChart(page, 0.6, 0.5);

    await expect
      .poll(() => drawingShapeCount(page), { timeout: 10_000 })
      .toBeGreaterThan(before);

    // Persisted drawings rehydrate on boot.
    await page.reload();
    await expect(page.getByTestId('axis-topbar')).toBeVisible();
    await expect
      .poll(() => drawingShapeCount(page), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test('switching tools updates the active tool indicator', async ({ page }) => {
    await loadMockBars(page);
    // Each selection asserts the Layers active-tool mirror internally.
    await selectDrawingTool(page, 'Lines', 'Trend line');
    await selectDrawingTool(page, 'Fibonacci', 'Fib retracement');
  });
});
