/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Status-bar scanline: HUD inspector opens on click, never on hover.
 */
import { test, expect } from '@playwright/test';
import { stubAppNetwork } from './charts';

test.describe('status-bar scanline', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page, {
      status: 'success',
      plots: [1, 2, 3, 4, 5],
      series: {},
      events: [],
      meta: { script_name: 'statusbar', overlay: true, ms: 8 },
    });
  });

  test('HUD inspector opens on click, not hover', async ({ page }) => {
    await page.goto('/');
    const bar = page.getByTestId('axis-statusbar');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('axis-connection-hud')).toBeVisible();
    await expect(page.getByTestId('axis-status-message')).toBeVisible();
    await expect(page.getByTestId('axis-statusbar-bars')).toBeVisible();

    const live = page.getByTestId('axis-hud-live');
    await expect(live).toBeVisible();
    await live.hover();
    await expect(page.getByTestId('axis-hud-info')).toHaveCount(0);

    await live.click();
    const inspector = page.getByTestId('axis-hud-info');
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute('role', 'dialog');

    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);

    await live.click();
    await expect(page.getByTestId('axis-hud-info')).toBeVisible();
    await live.click();
    await expect(page.getByTestId('axis-hud-info')).toHaveCount(0);
  });

  test('Compose inspector is click-open', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('axis-statusbar')).toBeVisible({ timeout: 15_000 });
    const compose = page.getByTestId('axis-hud-compose');
    await expect(compose).toBeVisible();
    await compose.hover();
    await expect(page.getByTestId('axis-compose-menu')).toHaveCount(0);
    await compose.click();
    await expect(page.getByTestId('axis-compose-menu')).toBeVisible();
    await expect(page.getByTestId('axis-compose-menu')).toHaveAttribute('role', 'dialog');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('axis-compose-menu')).toHaveCount(0);
  });
});
