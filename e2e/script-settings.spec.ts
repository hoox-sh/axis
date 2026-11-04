/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Script Settings modal (Inputs): search, collapsible groups, modified dots,
 * per-field reset, and the copy-values affordance. No engine run is needed —
 * the modal resolves field defs from the script source.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, seedAxisStore, stubAppNetwork } from './charts';

const RSI_INPUTS = `//@version=6
indicator("AXIS RSI")
len = input.int(14, "Length", minval=1, group="RSI")
smooth = input.bool(true, "Smooth", group="RSI")
alpha = input.float(0.3, "Alpha", group="Display")
plot(ta.rsi(close, len), "RSI")`;

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await seedAxisStore(page, {
    scripts: [
      {
        id: 'ind_rsi',
        name: 'AXIS RSI',
        code: RSI_INPUTS,
        paneId: 'ind_rsi',
        visible: true,
        plots: { RSI: { color: '#E8B84A' } },
        inputValues: { Length: 21 },
      },
    ],
  });
  await loadMockBars(page, { historyBars: 200 });
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-indicators');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-indicators')).toBeVisible();
  await page.getByTestId('axis-indicator-settings').first().click();
  await expect(page.getByTestId('axis-script-settings')).toBeVisible();
});

test('summary counts inputs and highlights changed values', async ({ page }) => {
  const summary = page.getByTestId('axis-script-settings-summary');
  await expect(summary).toContainText('3 inputs');
  await expect(summary).toContainText('1 changed');
  await expect(page.getByTestId('axis-in-modified-Length')).toBeVisible();
  // Unmodified fields carry no dot
  await expect(page.getByTestId('axis-in-modified-Alpha')).toHaveCount(0);
});

test('per-field reset restores the Pine default', async ({ page }) => {
  const summary = page.getByTestId('axis-script-settings-summary');
  await expect(summary).toContainText('1 changed');
  const row = page.locator('.ss-field-row', { has: page.locator('text=Length') });
  await row.hover();
  await row.getByRole('button', { name: /Reset Length/ }).click();
  await expect(page.getByTestId('axis-in-modified-Length')).toHaveCount(0);
  await expect(page.getByTestId('axis-script-settings-summary')).not.toContainText('changed');
});

test('search filters groups and offers a no-match state', async ({ page }) => {
  const search = page.getByTestId('axis-script-settings-search');
  await search.fill('alpha');
  await expect(page.getByTestId('axis-script-settings-nomatch')).toHaveCount(0);
  await expect(page.locator('.ss-group[data-input-group="Display"]')).toBeVisible();
  await expect(page.locator('.ss-group[data-input-group="RSI"]')).toHaveCount(0);
  await search.fill('zzz');
  await expect(page.getByTestId('axis-script-settings-nomatch')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('.ss-group')).toHaveCount(2);
});

test('slash focuses search and Escape clears + dismisses', async ({ page }) => {
  await page.keyboard.press('/');
  await expect(page.getByTestId('axis-script-settings-search')).toBeFocused();
  await page.keyboard.type('smooth');
  await expect(page.locator('.ss-group')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Escape clears the filter (via the search) and dismisses the modal
  await expect(page.getByTestId('axis-script-settings')).toBeHidden();
  await page.getByTestId('axis-indicator-settings').first().click();
  await expect(page.getByTestId('axis-script-settings-search')).toHaveValue('');
  await expect(page.locator('.ss-group')).toHaveCount(2);
});

test('groups collapse with live counts and persist across opens', async ({ page }) => {
  const rsi = page.locator('.ss-group[data-input-group="RSI"]');
  await expect(rsi.locator('.ss-group-count')).toContainText('2');
  await rsi.locator('.ss-group-head').click();
  await expect(rsi).toHaveAttribute('data-collapsed', 'true');
  await expect(rsi.locator('.ss-group-body')).toHaveCount(0);
  // Reopen the modal — the collapse persists
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('axis-script-settings')).toBeHidden();
  await page.getByTestId('axis-indicator-settings').first().click();
  await expect(page.locator('.ss-group[data-input-group="RSI"]')).toHaveAttribute(
    'data-collapsed',
    'true',
  );
});
