/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Open a studio overlay page via the visible topbar Studio button + rail.
 * Hidden `axis-btn-*` hooks stay `hidden` (command palette / programmatic
 * click only) so Playwright does not try to click through the fullscreen
 * button.
 */
import { expect, type Page } from '@playwright/test';

export type StudioRailPage = 'runtime' | 'wire' | 'settings' | 'workers' | 'plugins';

const PAGE_TEST_ID: Record<StudioRailPage, string> = {
  runtime: 'axis-runtimes-hub',
  wire: 'axis-architecture-modal',
  settings: 'axis-settings',
  workers: 'axis-workers-manager',
  plugins: 'axis-manager',
};

export async function openStudio(page: Page, rail: StudioRailPage = 'runtime') {
  await page.getByTestId('axis-btn-studio').click();
  // Studio remembers the last page; always pick the rail so this is not
  // order-dependent across tests in the same worker.
  await expect(page.getByTestId(`axis-studio-rail-${rail}`)).toBeVisible();
  await page.getByTestId(`axis-studio-rail-${rail}`).click();
  await expect(page.getByTestId(PAGE_TEST_ID[rail])).toBeVisible();
}
