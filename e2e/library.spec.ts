/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @critical Script library + Plugins catalog UI.
 *
 * Guards: the docked Library panel (topbar Library) shows the storage picker
 * and save CTA on its Personal tab — the Plugins studio page no longer embeds
 * the library. The Plugins catalog must not offer Mock Walk. Does not hit
 * real cloud/git backends — UI visibility only.
 */
import { test, expect } from '@playwright/test';
import { openStudio } from './studio';

test.describe('Script library @critical', () => {
  test('Library panel Personal tab shows storage picker and save CTA', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
    const libBtn = page.getByTestId('axis-btn-library');
    if ((await libBtn.getAttribute('aria-pressed')) !== 'true') await libBtn.click();
    await expect(page.getByTestId('axis-library')).toBeVisible();

    // The library opens on Builtin (read-only catalogue). The storage picker and
    // save form live in the Personal tab — asserting without switching tabs
    // tests nothing.
    await page.getByTestId('axis-library-tab-personal').click();
    await expect(page.getByTestId('axis-library-storage')).toBeVisible();
    // Fresh profile: the empty-state CTA; otherwise the toolbar save button.
    const save = page.getByTestId('axis-library-save');
    const emptySave = page.getByTestId('axis-library-empty-save');
    await expect(save.or(emptySave).first()).toBeVisible();
  });

  test('Catalog does not list Mock Walk', async ({ page }) => {
    await page.goto('/');
    await openStudio(page, 'plugins');
    const sourcesFilter = page.getByRole('button', { name: 'Sources' });
    if (await sourcesFilter.isVisible()) await sourcesFilter.click();
    await expect(page.locator('li', { hasText: 'Mock Walk' })).toHaveCount(0);
    await expect(page.locator('li', { hasText: 'Mock Poll' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('axis-select-source')).not.toHaveValue('mock-walk');
  });
});
