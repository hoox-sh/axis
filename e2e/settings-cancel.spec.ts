/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Settings → General is a Save/Cancel tab.
 *
 * The status-bar toggles used to write the store and `flushPersist()` from
 * their `onChange`, so the change was persisted before the footer's Save was
 * pressed and Cancel could not undo it. They are local until Save now.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, stubAppNetwork } from './charts';
import { openStudio } from './studio';

test.describe('settings cancel semantics @settings', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page, {
      status: 'success',
      plots: Array.from({ length: 32 }, (_, i) => i),
      series: {},
      events: [],
      meta: { script_name: 'e2e', ms: 4 },
    });
  });

  test('cancelling keeps the status-bar toggles as they were', async ({ page }) => {
    await loadMockBars(page, { historyBars: 300, rollingWindowBars: 300 });
    await openStudio(page, 'settings');
    await expect(page.getByTestId('axis-settings')).toBeVisible();

    const compact = page.getByTestId('axis-settings-hud-compact');
    const before = (await compact.getAttribute('aria-checked')) ?? 'false';

    await compact.click();
    await expect(compact).not.toHaveAttribute('aria-checked', before);

    // General is a Save/Cancel tab: closing without saving must not persist.
    await page.getByTestId('axis-settings-close').click();
    await expect(page.getByTestId('axis-settings')).toHaveCount(0);

    await page.reload({ waitUntil: 'load' });
    await openStudio(page, 'settings');
    await expect(page.getByTestId('axis-settings-hud-compact')).toHaveAttribute(
      'aria-checked',
      before,
    );
  });
});
