/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Data Source Manager: composer collapse, date presets, estimate tiles,
 * starting a mock-walk backfill, job filters/search, and clearing finished.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, stubAppNetwork } from './charts';

async function openPanel(page: import('@playwright/test').Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-datasource');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-datasource').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await loadMockBars(page, { historyBars: 300 });
  await openPanel(page);
});

test('datasource panel: presets, estimate, start job, filters', async ({ page }) => {
  const panel = page.getByTestId('axis-datasource').first();

  // The chart load may already have queued a catch-up job; open the composer
  // explicitly rather than relying on the empty-book default.
  if ((await panel.getByTestId('axis-datasource-form').count()) === 0) {
    await panel.getByTestId('axis-datasource-new').click();
  }
  await expect(panel.getByTestId('axis-datasource-form')).toBeVisible();
  await expect(panel.getByTestId('axis-datasource-estimate')).toBeVisible();

  // Date presets fill the input and mark themselves active.
  const before = await panel.getByTestId('axis-datasource-past-date').inputValue();
  await panel.getByTestId('axis-datasource-preset-30d').click();
  const after = await panel.getByTestId('axis-datasource-past-date').inputValue();
  expect(after).not.toBe(before);
  await expect(panel.getByTestId('axis-datasource-preset-30d')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByTestId('axis-datasource-estimate')).toContainText('30d');

  // Start the job — the composer folds away and a card appears.
  const jobsBefore = await panel.locator('.ax-dsm-job').count();
  await panel.getByTestId('axis-datasource-start').click();
  await expect(panel.getByTestId('axis-datasource-form')).toHaveCount(0);
  await expect(panel.locator('.ax-dsm-job')).toHaveCount(jobsBefore + 1);
  const newest = panel.locator('.ax-dsm-job').first();
  await expect(newest).toContainText('BTCUSDT');
  await expect(newest).toContainText('15m');

  // Job search + filters.
  const search = panel.getByTestId('axis-datasource-jobs-query');
  await search.fill('ethusdt');
  await expect(panel.getByTestId('axis-datasource-no-match')).toBeVisible();
  await search.press('Escape');
  await expect(panel.locator('.ax-dsm-job').first()).toBeVisible();

  await panel.getByTestId('axis-datasource-jobs-filter-active').click();
  await expect(panel.getByTestId('axis-datasource-jobs-filter-active')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByTestId('axis-datasource-jobs-filter-all').click();

  // Reopen the composer from the header toggle.
  await panel.getByTestId('axis-datasource-new').click();
  await expect(panel.getByTestId('axis-datasource-form')).toBeVisible();
  await panel.getByTestId('axis-datasource-new').click();
  await expect(panel.getByTestId('axis-datasource-form')).toHaveCount(0);

  // Finished jobs can be cleared in one action.
  const clear = panel.getByTestId('axis-datasource-clear-finished');
  if (await clear.count()) {
    const cards = await panel.locator('.ax-dsm-job').count();
    await clear.click();
    await expect.poll(() => panel.locator('.ax-dsm-job').count()).toBeLessThan(cards);
  }
});

test('datasource panel: chart-settings reset and summary', async ({ page }) => {
  const panel = page.getByTestId('axis-datasource').first();
  if ((await panel.getByTestId('axis-datasource-form').count()) === 0) {
    await panel.getByTestId('axis-datasource-new').click();
  }
  await expect(panel.getByTestId('axis-datasource-summary')).toContainText('done');

  await panel.getByTestId('axis-datasource-symbol').fill('ETHUSDT');
  await panel.getByTestId('axis-datasource-use-chart').click();
  await expect(panel.getByTestId('axis-datasource-symbol')).toHaveValue('BTCUSDT');

  // Validation: a future date is rejected.
  await panel.getByTestId('axis-datasource-past-date').fill('2099-01-01');
  await panel.getByTestId('axis-datasource-start').click();
  await expect(panel.getByTestId('axis-datasource-form')).toContainText(
    'Pick a UTC date in the past',
  );
});
