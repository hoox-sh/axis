/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Quote panel: hero price/change, 24h range marker, OHLC tiles, copy, and
 * the empty state. Opened from the extras menu.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, stubAppNetwork } from './charts';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function openQuote(page: import('@playwright/test').Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('axis-btn-extra').click();
  await page.getByTestId('axis-extra-quote-toggle').click();
  await expect(page.getByTestId('axis-quote').first()).toBeVisible();
}

test('quote panel: hero, range, OHLC, copy', async ({ page }) => {
  await stubAppNetwork(page);
  await loadMockBars(page, { historyBars: 300 });
  await openQuote(page);

  const panel = page.getByTestId('axis-quote').first();
  await expect(panel.getByTestId('axis-quote-price')).not.toHaveText('—');
  await expect(panel.getByTestId('axis-quote-change')).toContainText('%');
  await expect(panel.getByTestId('axis-quote-ohlc').locator('.ax-quote-ohlc-cell')).toHaveCount(4);
  await expect(panel.locator('.ax-quote-range-marker')).toBeVisible();
  await expect(panel.locator('.ax-quote-live')).toContainText(/open|idle|connecting|closed/);

  await panel.getByTestId('axis-quote-copy').click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('BTCUSDT');
  expect(clip).toMatch(/[0-9]/);
});

test('quote panel: empty state before bars load', async ({ page }) => {
  await stubAppNetwork(page);
  await page.goto('/');
  await openQuote(page);
  await expect(page.getByTestId('axis-quote-empty')).toBeVisible();
});
