/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @smoke Watchlist row actions, alert mini-modal, and the Prev reference.
 *
 * The Prev column must be a **daily** close (fixed for the day), never a
 * rolling 24h open — the header/tooltip states which reference is in use.
 */
import { test, expect } from '@playwright/test';
import { stubAppNetwork, loadMockBars } from './charts';

test.describe('watchlist actions @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page);
    await loadMockBars(page, { historyBars: 200 });
  });

  test('row actions have room and the big view opens', async ({ page }) => {
    const panel = page.getByTestId('axis-watchlist');
    await expect(panel).toBeVisible();

    const row = panel.locator('.axis-wl-row').first();
    await expect(row).toBeVisible();

    // Prev header explains the reference price.
    const prevHeader = panel.locator('span[title*="Previous daily close"]').first();
    await expect(prevHeader).toHaveText('Prev');

    // Three action buttons, each with its own hit area (no overlap).
    const alertBtn = row.locator('[data-testid^="axis-watchlist-alert-"]').first();
    const expandBtn = row.locator('[data-testid^="axis-watchlist-expand-"]').first();
    const alertBox = await alertBtn.boundingBox();
    const expandBox = await expandBtn.boundingBox();
    expect(alertBox && expandBox).toBeTruthy();
    expect(expandBox!.x).toBeGreaterThan(alertBox!.x + alertBox!.width - 1);

    // Big price view (actions are hover-revealed — hover the row first).
    await row.hover();
    await expandBtn.click();
    await expect(row).toHaveClass(/is-expanded/);
    await expect(row.locator('.axis-wl-big-price')).toBeVisible();
    await expect(row).toContainText(/Prev/);
    // Toggle back to compact.
    await row.hover();
    await row.locator('[data-testid^="axis-watchlist-expand-"]').first().click();
    await expect(row).not.toHaveClass(/is-expanded/);
  });

  test('alert mini-modal: context price, quick fills, hint, Escape', async ({ page }) => {
    const panel = page.getByTestId('axis-watchlist');
    const row = panel.locator('.axis-wl-row').first();
    await row.hover();
    await row.locator('[data-testid^="axis-watchlist-alert-"]').first().click();

    const pop = page.getByTestId('axis-watchlist-alert-pop');
    await expect(pop).toBeVisible();
    // Last price is shown for context.
    await expect(pop.getByTestId('axis-watchlist-alert-last')).not.toBeEmpty();

    // Quick fill sets a valid price and enables Create.
    await pop.getByTestId('axis-watchlist-alert-quick-up1').click();
    const price = pop.getByTestId('axis-watchlist-alert-price');
    await expect(price).not.toHaveValue('');
    await expect(pop.getByTestId('axis-watchlist-alert-create')).toBeEnabled();

    // "Above" with a level under the last price warns that it fires next tick.
    await pop.getByRole('button', { name: 'Above' }).click();
    await price.fill('0.01');
    await expect(pop.getByTestId('axis-watchlist-alert-hint')).toContainText(/already above/i);

    // Invalid input disables Create.
    await price.fill('');
    await expect(pop.getByTestId('axis-watchlist-alert-create')).toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  });
});
