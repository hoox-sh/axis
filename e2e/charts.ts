/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * DOM harness for chart/drawing e2e specs.
 *
 * Shared helpers to boot the app with fully stubbed network, load mock bars,
 * select drawing tools, click into the chart host, and count rendered drawing
 * shapes. Keeps specs focused on behavior; all Playwright boilerplate lives
 * here.
 *
 * Run: `bunx playwright test e2e/drawings.spec.ts`
 */

import { expect, type Page } from '@playwright/test';

/** Stub Pro API run + venue traffic so specs never touch the network. */
export async function stubAppNetwork(page: Page): Promise<void> {
  await page.route('**/run**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'success',
        plots: [1, 2, 3, 4, 5],
        series: {},
        events: [],
        meta: { script_name: 'e2e', overlay: true, ms: 12 },
      }),
    });
  });
  await page.route('**/api.binance.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
}

/** Boot on `/` and load mock-walk bars so the chart has a drawable series. */
export async function loadMockBars(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('axis-topbar')).toBeVisible();
  await page.getByTestId('axis-select-source').selectOption('mock-walk');
  await page.getByTestId('axis-btn-load').click();
  await expect(page.getByTestId('axis-status-message')).toContainText(/Loaded \d+ bars|Ready/i, {
    timeout: 15_000,
  });
  await expect(page.locator('[data-axis-chart-host]')).toBeVisible();
}

/** Open a toolbar group flyout and pick a tool; asserts the active indicator. */
export async function selectDrawingTool(
  page: Page,
  groupLabel: string,
  toolLabel: string,
): Promise<void> {
  const toolbar = page.getByTestId('axis-drawing-toolbar');
  await expect(toolbar).toBeVisible();
  const group = toolbar.getByRole('button', { name: groupLabel });
  await group.click();
  await page.getByRole('menuitemradio', { name: toolLabel }).click();
  // Group stays pressed while its tool is active.
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  // Layers panel mirrors the active tool name.
  await page.getByTestId('axis-btn-layers').click();
  await expect(page.getByTestId('axis-layers-active-tool')).toContainText(toolLabel);
  // Close the panel so it never covers the chart for placement clicks.
  await page.getByTestId('axis-btn-layers').click();
}

/** Click inside the chart host at a fractional offset (default: left third). */
export async function clickChart(page: Page, xRatio = 0.3, yRatio = 0.4): Promise<void> {
  const host = page.locator('[data-axis-chart-host]').first();
  const box = await host.boundingBox();
  if (!box) throw new Error('chart host has no bounding box');
  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
}

/** Number of rendered SVG shapes inside chart hosts (drawings overlay). */
export async function drawingShapeCount(page: Page): Promise<number> {
  return page.locator('[data-axis-chart-host] svg :is(line, path, rect, circle, ellipse)').count();
}
