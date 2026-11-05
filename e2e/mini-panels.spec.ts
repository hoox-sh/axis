/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Float-only Time and Price mini panels: candle countdown + progress, wall
 * clocks, big price with trend tint, live state, and price copy. Opened from
 * the extras menu.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, stubAppNetwork } from './charts';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function openExtrasPanel(page: import('@playwright/test').Page, testId: string) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('axis-btn-extra').click();
  await page.getByTestId(testId).click();
  // The extras popover sits over the floating panels; close it to screenshot.
  await page.keyboard.press('Escape');
}

test('time panel: countdown, progress, and clocks', async ({ page }) => {
  await stubAppNetwork(page);
  await loadMockBars(page, { historyBars: 300 });
  await openExtrasPanel(page, 'axis-extra-time-toggle');

  const panel = page.getByTestId('axis-time').first();
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('axis-time-countdown')).toHaveText(/^\d+:[0-5]\d$/);

  // Hover-collapse can mark the panel body `aria-hidden`, so address the
  // progress bar by class rather than by role.
  const progress = panel.locator('.ax-time-progress');
  await expect(progress).toBeVisible();
  const now = Number(await progress.getAttribute('aria-valuenow'));
  expect(now).toBeGreaterThanOrEqual(0);
  expect(now).toBeLessThanOrEqual(100);

  await expect(panel.getByTestId('axis-time-clocks')).toContainText('UTC');
  await expect(panel.locator('.ax-time-close')).toContainText('UTC');
  await expect(panel.locator('.ax-time-label')).toContainText('close');

  // The countdown ticks.
  const first = await panel.getByTestId('axis-time-countdown').textContent();
  await expect(panel.getByTestId('axis-time-countdown')).not.toHaveText(first ?? '', {
    timeout: 5_000,
  });
});

test('price panel: price, live state, and copy', async ({ page }) => {
  await stubAppNetwork(page);
  await loadMockBars(page, { historyBars: 300 });
  await openExtrasPanel(page, 'axis-extra-price-panel-toggle');

  const panel = page.getByTestId('axis-price').first();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.ax-price-symbol')).toHaveText('BTCUSDT');
  await expect(panel.getByTestId('axis-price-sub')).toContainText('24h');
  await expect(panel.locator('.ax-price-live')).toContainText(/open|idle|connecting|closed/);

  const value = panel.getByTestId('axis-price-value');
  await expect(value).not.toHaveText('—');
  const shown = (await value.textContent())?.trim() ?? '';
  expect(shown).toMatch(/[0-9]/);

  await value.click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toMatch(/[0-9]/);
  expect(clip.replace(/[,\s]/g, '')).toBe(shown.replace(/[,\s]/g, ''));
});
