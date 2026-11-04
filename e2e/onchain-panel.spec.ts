/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain panel: TVL search/attach, series rows, event spikes, DEX fields,
 * and detach. DefiLlama endpoints are stubbed so no network is used.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, stubAppNetwork } from './charts';

const DAY = 86_400;
const now = Math.floor(Date.now() / 1000);

function tvlSeries(base: number) {
  return Array.from({ length: 90 }, (_, i) => {
    const spike = i === 60 ? 1.25 : i === 30 ? 0.82 : 1;
    return {
      date: now - (89 - i) * DAY,
      totalLiquidityUSD: Math.round(base * spike * (1 + Math.sin(i / 6) * 0.05)),
    };
  });
}

async function dismissToasts(page: import('@playwright/test').Page) {
  const dismiss = page.getByTestId('axis-toast-dismiss');
  for (let i = 0; i < (await dismiss.count()); i += 1) {
    await dismiss
      .first()
      .click()
      .catch(() => {});
  }
}

async function openOnchain(page: import('@playwright/test').Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-onchain');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-onchain').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await page.route('**/protocols', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { slug: 'aave', name: 'Aave', tvl: 12_000_000_000, category: 'Lending' },
        { slug: 'uniswap', name: 'Uniswap', tvl: 5_400_000_000, category: 'Dexes' },
      ]),
    }),
  );
  await page.route('**/protocol/aave', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Aave', slug: 'aave', tvl: tvlSeries(12_000_000_000) }),
    }),
  );
  await loadMockBars(page, { historyBars: 300 });
  await openOnchain(page);
});

test('onchain panel: attach, toggle, events, dex, detach', async ({ page }) => {
  const panel = page.getByTestId('axis-onchain').first();
  await expect(panel.getByTestId('axis-onchain-summary')).toContainText('0 series');
  await expect(panel.getByTestId('axis-onchain-summary')).toContainText('0 events');

  // Search + attach.
  await panel.getByTestId('axis-onchain-search-input').fill('aave');
  await expect(panel.getByTestId('axis-onchain-result-aave')).toBeVisible({ timeout: 10_000 });
  await panel.getByTestId('axis-onchain-result-aave').click();
  const seriesRow = panel.locator('[data-testid^="axis-onchain-series-"]').first();
  await expect(seriesRow).toBeVisible({ timeout: 15_000 });
  await dismissToasts(page);
  await expect(seriesRow).toContainText('Aave TVL');
  await expect(seriesRow).toContainText('defillama');
  await expect(seriesRow).toContainText('90 pts');
  await expect(panel.getByTestId('axis-onchain-summary')).toContainText('1 series');

  // Visibility toggle.
  const eye = seriesRow.locator('label.ax-oc-eye');
  await eye.click();
  await expect(seriesRow.locator('input[type="checkbox"]')).not.toBeChecked();
  await eye.click();
  await expect(seriesRow.locator('input[type="checkbox"]')).toBeChecked();

  // Events: derive spikes from the attached series.
  await panel.getByTestId('axis-onchain-mode-events').click();
  await expect(panel.getByTestId('axis-onchain-panel-events')).toBeVisible();
  const spikes = panel.locator('[data-testid^="axis-onchain-show-spikes-"]').first();
  await spikes.click();
  await dismissToasts(page);
  const events = panel.locator('[data-testid^="axis-onchain-event-"]');
  await expect(events.first()).toBeVisible({ timeout: 10_000 });
  expect(await events.count()).toBeGreaterThan(0);
  await expect(panel.getByTestId('axis-onchain-event-count')).toContainText(/Events: [1-9]/);
  await panel.getByTestId('axis-onchain-clear-events').click();
  await expect(panel.getByTestId('axis-onchain-events-empty')).toBeVisible();

  // DEX: load is gated on a pool address.
  await panel.getByTestId('axis-onchain-mode-dex').click();
  await expect(panel.getByTestId('axis-onchain-panel-dex')).toBeVisible();
  await expect(panel.getByTestId('axis-onchain-dex-load')).toBeDisabled();
  await panel
    .getByTestId('axis-onchain-dex-pool-input')
    .fill('0x0000000000000000000000000000000000000001');
  await expect(panel.getByTestId('axis-onchain-dex-load')).toBeEnabled();

  // Detach from TVL.
  await panel.getByTestId('axis-onchain-mode-tvl').click();
  await panel
    .getByTestId(
      'axis-onchain-detach-' +
        (await seriesRow.getAttribute('data-testid'))!.replace('axis-onchain-series-', ''),
    )
    .click();
  await expect(panel.getByTestId('axis-onchain-empty')).toBeVisible();
  await expect(panel.getByTestId('axis-onchain-summary')).toContainText('0 series');
});
