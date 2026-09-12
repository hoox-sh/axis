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
  // Wait for boot first: on slow runners the topbar buttons exist but are
  // not actionable until hydration finishes.
  await expect(page.getByTestId('axis-topbar')).toBeVisible({ timeout: 30_000 });
  const railItem = page.getByTestId(`axis-studio-rail-${rail}`);
  const studioBtn = page.getByTestId('axis-btn-studio');
  // Studio is a toggle — a second click while the overlay is still opening
  // closes it. Studio also remembers the last page; always pick the rail.
  if (!(await railItem.isVisible())) {
    await studioBtn.click();
    const shown = await railItem
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!shown) {
      const late = await railItem
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (
        !late &&
        (await railItem.count()) === 0 &&
        (await studioBtn.getAttribute('aria-pressed')) !== 'true'
      ) {
        await studioBtn.click();
      }
      await expect(railItem).toBeVisible({ timeout: 15_000 });
    }
  }
  await railItem.click();
  await expect(page.getByTestId(PAGE_TEST_ID[rail])).toBeVisible();
}
