/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @smoke PYNE parity surfaces in the studio pages.
 *
 * With `/health` stubbed to a real Pro payload, the Runtime form must show the
 * compile readiness from `compile.*` and offer the prewarm action, and the
 * Workers `pyne-pro` detail must show the Compile row. Network is fully stubbed.
 */
import { test, expect } from '@playwright/test';
import { stubAppNetwork } from './charts';
import { openStudio } from './studio';

/** Trimmed copy of a real `pynescript-pro-api` /health body. */
const PRO_HEALTH = {
  status: 'healthy',
  service: 'pynescript-pro-api',
  version: '1.0.0',
  websocket: true,
  features: {
    warm_compile: true,
    default_run_mode: 'auto',
    optimize: true,
    script_runner: false,
    live_modes: ['every-tick', 'bar-close'],
    data_session: true,
  },
  compile: {
    has_numba: true,
    builtins_warmed: true,
    disk_cache_enabled: true,
    disk_cache_dir: '/var/cache/pyne',
    prewarm_enabled: true,
    source_entries: 4,
    ir_entries: 12,
    default_mode: 'auto',
    host_prewarmed: true,
  },
  endpoints: {
    'POST /run': 'Run Pine Script',
    'POST /compile/prewarm': 'Warm Numba builtins / optional scripts (free)',
  },
};

test.describe('PYNE parity surfaces @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await stubAppNetwork(page);
    // The engine probe is `${store.endpoint || schema default}/health`.
    await page.route(
      (url) => url.pathname === '/health',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(PRO_HEALTH),
        }),
    );
  });

  test('Runtime shows compile readiness from /health and the prewarm action', async ({ page }) => {
    await page.goto('/');
    await openStudio(page, 'runtime');

    // `compile.*` → readiness summary, not the raw JSON.
    await expect(
      page.getByText(/warm — builtins \/ host already prewarmed/),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('axis-engine-prewarm')).toBeVisible();
    await expect(page.getByTestId('axis-engine-prewarm')).toBeEnabled();
  });

  test('Workers pyne-pro detail shows the Compile row', async ({ page }) => {
    await page.goto('/');
    await openStudio(page, 'workers');

    // Master-detail: the pyne-pro card is selected by default on a stock config.
    await expect(page.getByText(/Compile/).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/disk cache \(12 IR\)/)).toBeVisible({ timeout: 20_000 });
  });
});
