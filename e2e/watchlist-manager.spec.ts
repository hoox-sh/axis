/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Watchlist manager: folders, list actions, symbol actions, and persistence.
 */

import { expect, test } from '@playwright/test';

test('watchlist manager: folders, list + symbol actions, persistence', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });

  const wlBtn = page.getByTestId('axis-btn-watchlist');
  if ((await wlBtn.getAttribute('aria-pressed')) !== 'true') await wlBtn.click();
  await expect(page.getByTestId('axis-watchlist')).toBeVisible();

  // Open the manager and create a folder.
  await page.getByTestId('axis-watchlist-list').click();
  await expect(page.getByTestId('axis-watchlist-manager')).toBeVisible();
  await page.getByTestId('axis-watchlist-new-folder').click();
  const folderRename = page.getByTestId('axis-watchlist-rename-folder');
  await expect(folderRename).toBeVisible();
  await folderRename.fill('Crypto');
  await folderRename.press('Enter');
  const folder = page.locator('[data-testid^="axis-watchlist-folder-"]').first();
  await expect(folder).toContainText('Crypto');

  // Create a list inside the folder and rename it.
  await folder.getByLabel(/New watchlist in Crypto/).click();
  const listRename = page.getByTestId('axis-watchlist-rename-list');
  await expect(listRename).toBeVisible();
  await listRename.fill('Majors');
  await listRename.press('Enter');
  await expect(folder).toContainText('Majors');

  // Move Main into the folder.
  const mainRow = page.getByTestId('axis-watchlist-list-row-wl-main');
  await mainRow.getByLabel(/Actions for Main/).click();
  const folderId = (await folder.getAttribute('data-testid'))!.replace(
    'axis-watchlist-folder-',
    '',
  );
  await mainRow.getByLabel(/Folder for Main/).selectOption(folderId);
  await expect(folder.getByTestId('axis-watchlist-list-row-wl-main')).toBeVisible();

  // Collapse / expand the folder.
  await folder.getByLabel(/Collapse Crypto/).click();
  await expect(folder.getByTestId('axis-watchlist-list-row-wl-main')).toBeHidden();
  await folder.getByLabel(/Expand Crypto/).click();
  await expect(folder.getByTestId('axis-watchlist-list-row-wl-main')).toBeVisible();

  // Activate Main again.
  await mainRow.getByTitle('Open Main').click();
  await expect(page.getByTestId('axis-watchlist-manager')).toHaveCount(0);

  // Symbol actions: move BTC down.
  await page.locator('.axis-wl-row').first().hover();
  await page.getByTestId('axis-watchlist-more-BTCUSDT').click();
  await expect(page.getByTestId('axis-watchlist-sym-actions-BTCUSDT')).toBeVisible();
  await page.getByTestId('axis-watchlist-sym-actions-BTCUSDT').getByTitle('Move down').click();
  await expect(page.locator('.axis-wl-row').first()).toContainText('ETH');

  // Move ETH into the Majors list.
  await page.locator('.axis-wl-row').first().hover();
  await page.getByTestId('axis-watchlist-more-ETHUSDT').click();
  await page.getByLabel('Move ETHUSDT to another watchlist').selectOption({ label: 'Majors' });
  await expect(page.getByTestId('axis-watchlist-more-ETHUSDT')).toHaveCount(0);

  // Sort + clear the active list.
  await page.getByTestId('axis-watchlist-list').click();
  await page.getByTestId('axis-watchlist-sort').click();
  await page.getByTestId('axis-watchlist-clear').click();
  await expect(page.getByTestId('axis-watchlist-empty')).toContainText('No symbols in Main');

  // Folder + lists survive a reload.
  await page.reload();
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const wlBtn2 = page.getByTestId('axis-btn-watchlist');
  if ((await wlBtn2.getAttribute('aria-pressed')) !== 'true') await wlBtn2.click();
  await page.getByTestId('axis-watchlist-list').click();
  await expect(page.getByTestId('axis-watchlist-manager')).toContainText('Crypto');
  await expect(page.getByTestId('axis-watchlist-manager')).toContainText('Majors');
});
