/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @smoke Playwright smoke for AXIS shell.
 *
 * Invariant: with `/run` and Binance REST mocked, the app boots (title, topbar,
 * chart host), can load mock-walk bars, run the server engine, and open Manager.
 * Network is fully stubbed — no real exchange or Pro API.
 *
 * Run: `bun run test:e2e:smoke`
 */
import { test, expect } from '@playwright/test';

test.describe('AXIS smoke @smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Pro API run endpoint (server engine)
    await page.route('**/run**', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          plots: [1, 2, 3, 4, 5],
          series: {},
          events: [],
          meta: { script_name: 'smoke', overlay: true, ms: 12 },
        }),
      });
    });

    // Avoid real exchange traffic during smoke
    await page.route('**/api.binance.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );
  });

  test('loads shell with topbar and chart host', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AXIS/i);
    await expect(page.getByTestId('axis-topbar')).toBeVisible();
    await expect(page.getByTestId('axis-brand')).toContainText('AXIS');
    await expect(page.locator('[data-axis-panes]')).toBeVisible();
  });

  test('loads mock-walk bars and runs mocked engine', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('axis-select-source').selectOption('mock-walk');
    await page.getByTestId('axis-btn-load').click();

    // Status message — not getByText(/bars/i), which matches hidden <option>Bars
    await expect(page.getByTestId('axis-status-message')).toContainText(
      /Loaded \d+ bars|Ready/i,
      { timeout: 15_000 },
    );

    await page.getByTestId('axis-select-engine').selectOption('server');
    await page.getByTestId('axis-btn-run').click();

    // After run, status or results should reflect success (no crash)
    await expect(page.getByTestId('axis-topbar')).toBeVisible();
    await page.waitForTimeout(500);
    // Page still interactive
    await expect(page.getByTestId('axis-btn-run')).toBeEnabled();
  });

  test('opens and closes plugin Manager', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('axis-btn-plugins').click({ force: true });
    await expect(page.getByTestId('axis-manager')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Catalog' })).toBeVisible();
    await page.getByTestId('axis-plugins-close').click();
    await expect(page.getByTestId('axis-manager')).toHaveCount(0);
  });

  test('opens Runtime studio page', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('axis-btn-runtimes').click();
    await expect(page.getByTestId('axis-runtimes-hub')).toBeVisible();
    await page.getByTestId('axis-runtimes-close').click();
    await expect(page.getByTestId('axis-runtimes-hub')).toHaveCount(0);
  });

  test('opens Architecture modal and applies Offline Lab', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('axis-btn-architecture').click();
    await expect(page.getByTestId('axis-architecture-modal')).toBeVisible();
    await page.getByTestId('axis-arch-preset-offline-lab').click();
    await expect(page.getByTestId('axis-architecture-title')).toContainText('Offline Lab');
    await page.getByTestId('axis-architecture-apply').click();
    await expect(page.getByTestId('axis-architecture-modal')).toHaveCount(0);
    await expect(page.getByTestId('axis-select-source')).toHaveValue('mock-walk');
    await expect(page.getByTestId('axis-select-engine')).toHaveValue('pyodide');
  });

  test('opens Settings dialog', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('axis-btn-settings').click();
    await expect(page.getByRole('dialog', { name: /Settings/i })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});
