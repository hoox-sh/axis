/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Script Library panel polish: match highlighting, pinning (Pinned group),
 * collapsible categories, `/` search focus, and the Personal empty-state CTAs.
 */

import { expect, test } from '@playwright/test';

test('library panel: search highlight, pin, collapse, and shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const libBtn = page.getByTestId('axis-btn-library');
  if ((await libBtn.getAttribute('aria-pressed')) !== 'true') await libBtn.click();
  await expect(page.getByTestId('axis-library')).toBeVisible();

  // Search marks matches in card titles/descriptions.
  const search = page.getByTestId('axis-library-builtin-search');
  await search.fill('rsi');
  await expect(page.locator('.ax-library-hl').first()).toBeVisible();
  await expect(page.getByTestId('axis-library-builtin-card').first()).toBeVisible();

  // Escape clears the query.
  await search.press('Escape');
  await expect(search).toHaveValue('');

  // Pin the first card: it moves into a Pinned group and the star flips.
  const first = page.getByTestId('axis-library-builtin-card').first();
  await first.getByLabel(/^Pin /).click();
  await expect(page.getByRole('button', { name: /^Pinned/ })).toBeVisible();
  await expect(
    page
      .getByTestId('axis-library-builtin-card')
      .first()
      .getByLabel(/^Unpin /),
  ).toBeVisible();

  // Collapsing a category keeps its header but hides its cards.
  const group = page.getByRole('button', { name: /^Moving averages/ });
  await group.click();
  await expect(group).toHaveAttribute('aria-expanded', 'false');

  // `/` focuses the library search when focus is not in a field.
  await page.getByTestId('axis-library-builtin-card').first().click();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();

  // Personal empty state exposes both entry points.
  await page.getByTestId('axis-library-tab-personal').click();
  await expect(page.getByTestId('axis-library-empty-save')).toBeVisible();
  await expect(page.getByTestId('axis-library-empty-import')).toBeVisible();
});
