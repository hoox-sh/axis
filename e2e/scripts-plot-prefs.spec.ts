/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @smoke Scripts panel plot prefs: width stepper, line type, display targets.
 *
 * Regression guard for the “+” jumping 1 → 3 (default width was read as 2),
 * plus the panel line-type override and the Pine `display.*` controls. The
 * script is **seeded** into the store so no engine is involved — these are
 * panel preferences, not run results.
 */
import { test, expect } from '@playwright/test';
import { stubAppNetwork, loadMockBars, seedAxisStore } from './charts';

const SMA_CODE = `//@version=6
indicator("AXIS SMA", overlay=true)
plot(ta.sma(close, 20), "SMA", color=#8B9CFF)`;

test.describe('scripts plot prefs @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page);
    await seedAxisStore(page, {
      scripts: [
        {
          id: 'ind_plot_prefs',
          name: 'AXIS SMA',
          code: SMA_CODE,
          paneId: 'price',
          visible: true,
          plots: { SMA: { color: '#8B9CFF' } },
        },
      ],
    });
    await loadMockBars(page, { historyBars: 200 });
  });

  test('width +1 steps by one, line type applies, display toggles', async ({ page }) => {
    const scripts = page.getByTestId('axis-btn-indicators');
    if ((await scripts.getAttribute('aria-pressed')) !== 'true') await scripts.click();

    const card = page.getByTestId('axis-indicator-card').first();
    await expect(card).toBeVisible();

    // ── Width: unset must read 1 and “+” must land on 2 (not 3) ──────────
    const width = card.getByTestId('axis-plot-width').first();
    await expect(width).toHaveText('1');
    await card
      .getByRole('button', { name: /Increase line width/i })
      .first()
      .click();
    await expect(width).toHaveText('2');
    await expect(width).toHaveAttribute('data-width', '2');
    await card
      .getByRole('button', { name: /Decrease line width/i })
      .first()
      .click();
    await expect(width).toHaveText('1');

    // ── Line type: AXIS override (Pine plot() lines are solid) ───────────
    await card.locator('[data-style-trigger]').first().click();
    const stylePopover = page.getByTestId('axis-plot-style-popover');
    await expect(stylePopover).toBeVisible();
    await stylePopover.locator('[data-line-style="dashed"]').click();
    await expect(card.locator('[data-style-trigger]').first()).toHaveAttribute('title', /Dashed/);

    // ── display.*: panel override of the declared mask ───────────────────
    const displayChip = card.getByTestId('axis-plot-display').first();
    await expect(displayChip).toHaveText(/all/);
    await card.locator('[data-display-trigger]').first().click();
    const displayPopover = page.getByTestId('axis-plot-display-popover');
    await expect(displayPopover).toBeVisible();
    await expect(displayPopover).toContainText(/Pine: all/);
    await displayPopover.locator('[data-display-target="price-scale"]').click();
    await expect(displayChip).not.toHaveText(/scale/);
    // Reset restores the declared mask.
    await displayPopover.locator('[data-display-action="reset"]').click();
    await expect(displayChip).toHaveText(/all/);
  });

  test('library marks the applied builtin', async ({ page }) => {
    const lib = page.getByTestId('axis-btn-library');
    if ((await lib.getAttribute('aria-pressed')) !== 'true') await lib.click();
    await page.getByTestId('axis-library-builtin-search').fill('sma');
    const builtin = page.locator('[data-builtin-id="sma"]');
    await expect(builtin).toHaveAttribute('data-applied', 'true');
    await expect(builtin.getByTestId('axis-library-builtin-applied')).toHaveText('applied');
    // Placement chip is explicit for both overlay and sub-pane scripts.
    await expect(builtin.getByTestId('axis-library-builtin-meta')).toContainText('overlay');
  });
});
