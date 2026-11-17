/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Studio Source/Data and Workers read-only contracts, in a real browser.
 *
 * - Settings labels the data tab **Source**, and its Open Data button, the
 *   topbar Data button, and the status-bar dataset count all open the rail
 *   **Data** page (not a slide-over).
 * - Workers hides optional workers until Show optional and sends the agent
 *   card to Plugins instead of installing or editing it here.
 *
 * The unit seams live in `tests/studio-open-routing.test.ts` and
 * `tests/studio-workers-inventory.test.ts`; this spec proves the button
 * bindings the unit harness cannot render.
 */

import { expect, test } from '@playwright/test';
import { openStudio } from './studio';

test('Settings Source tab and its Open Data button reach the rail Data page', async ({ page }) => {
  await page.goto('/');
  await openStudio(page, 'settings');

  const sourceTab = page.getByTestId('axis-settings-tab-data');
  await expect(sourceTab).toContainText('Source');
  await sourceTab.click();

  await page.getByTestId('axis-settings-open-dsm').click();
  await expect(page.getByTestId('axis-data-page')).toBeVisible();
});

test('topbar Data and status-bar dataset open the rail Data page', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });

  await page.getByTestId('axis-btn-datasource').click();
  await expect(page.getByTestId('axis-data-page')).toBeVisible();
  await page.getByTestId('axis-data-page-close').click();
  await expect(page.getByTestId('axis-data-page')).toHaveCount(0);

  await page.getByTestId('axis-statusbar-dataset').click();
  await expect(page.getByTestId('axis-data-page')).toBeVisible();
});

test('Workers hides optional workers until Show optional and links the agent to Plugins', async ({
  page,
}) => {
  await page.goto('/');
  await openStudio(page, 'workers');

  const agentCard = page.getByTestId('axis-worker-card-pyne-agent');
  await expect(agentCard).toHaveCount(0);

  await page.locator('#axis-workers-optional').check();
  await expect(agentCard).toBeVisible({ timeout: 15_000 });
  await agentCard.click();
  await expect(page.getByText(/Open Plugins to install/)).toBeVisible();

  await page.getByTestId('axis-workers-goto-plugins').click();
  await expect(page.getByTestId('axis-manager')).toBeVisible();
});
