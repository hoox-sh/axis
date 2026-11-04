/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Studio → Debug page: runtime logging toggle, ring stats, and the formatted
 * live view (scope filter + clear). Seeds the ring in localStorage so the
 * test does not depend on a venue load.
 */

import { expect, test } from '@playwright/test';
import { openStudio } from './studio';

const SEED = [
  '2026-11-04T10:00:00.000Z [chart] setData {"n":10,"fit":true}',
  '2026-11-04T10:00:01.000Z [engine] ws.open {"first":true}',
  '2026-11-04T10:00:02.000Z [chart] action.menu {"id":"view.reset"}',
].join('\n');

test('debug page toggles logging and renders the ring live', async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem('axis.debug.log.0', `${seed}\n`);
  }, SEED);

  await page.goto('/');
  await openStudio(page, 'debug');
  await expect(page.getByTestId('axis-debug-title')).toHaveText('Logs & diagnostics');

  // Seeded ring renders one row per line, newest last.
  const rows = page.locator('.ax-debug-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('axis-debug-live-count')).toHaveText('3');
  await expect(page.getByTestId('axis-debug-stat-lines')).toContainText('3');
  await expect(rows.first()).toContainText('10:00:00.000');
  await expect(rows.first()).toContainText('chart');
  await expect(rows.first()).toContainText('setData');

  // Scope chips narrow the view.
  await page.getByTestId('axis-debug-scope-engine').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('ws.open');
  await page.getByTestId('axis-debug-scope-all').click();
  await expect(rows).toHaveCount(3);

  // Toggle writes the runtime flag (env is forced off by playwright.config).
  const toggle = page.getByTestId('axis-debug-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('axis.debug'))).toBe('1');

  // Clear empties the ring and falls back to the waiting state.
  await page.getByTestId('axis-debug-clear').click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId('axis-debug-empty')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('axis.debug.log.0'))).toBe(null);
});
