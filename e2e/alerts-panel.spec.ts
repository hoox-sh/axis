/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Alerts panel: search, filters, collapsible composer, create/edit/duplicate,
 * bulk enable/disable, and delete. Alerts are seeded into localStorage so the
 * engine never runs.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, seedAxisStore, stubAppNetwork } from './charts';

const ALERTS_KEY = 'axis.alerts.v1';

function seededAlerts() {
  const now = Date.now();
  return [
    {
      id: 'a_price',
      name: 'BTC breakout',
      enabled: true,
      symbol: 'BTCUSDT',
      kind: 'price_cross',
      params: { price: 42000 },
      createdAt: now - 86_400_000,
      lastFiredAt: now - 120_000,
      notifyBrowser: true,
    },
    {
      id: 'a_pct',
      name: 'ETH 2% move',
      enabled: true,
      symbol: 'ETHUSDT',
      kind: 'pct_change',
      params: { pct: 2, direction: 'both' },
      createdAt: now - 3_600_000,
      interval: '1h',
    },
    {
      id: 'a_chain',
      name: 'AAVE TVL spike',
      enabled: false,
      symbol: 'aave',
      kind: 'onchain_tvl_spike',
      params: { protocolId: 'aave', minAbsPct: 10, direction: 'both' },
      createdAt: now - 900_000,
      notifyBrowser: false,
    },
  ];
}

async function seedAlerts(page: import('@playwright/test').Page, alerts: unknown[]) {
  await page.addInitScript(
    ([key, data]) => {
      localStorage.setItem(key as string, JSON.stringify({ version: 1, alerts: data }));
    },
    [ALERTS_KEY, alerts] as const,
  );
}

async function openAlerts(page: import('@playwright/test').Page) {
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-alerts');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-alerts')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await seedAxisStore(page, {
    scripts: [
      {
        id: 'ind_rsi',
        name: 'AXIS RSI',
        code: '//@version=6\nindicator("AXIS RSI", overlay=false)\nplot(ta.rsi(close, 14), "RSI")',
        paneId: 'ind_rsi',
        visible: true,
        plots: { RSI: { color: '#E8B84A' } },
      },
    ],
  });
  await seedAlerts(page, seededAlerts());
  await loadMockBars(page, { historyBars: 200 });
  await page.goto('/');
  await openAlerts(page);
});

test('alerts panel: summary, filters, search, and row tone', async ({ page }) => {
  await expect(page.getByTestId('axis-alerts-summary')).toContainText('3 alerts');
  await expect(page.getByTestId('axis-alerts-summary')).toContainText('2 armed');
  await expect(page.getByTestId('axis-alerts-summary')).toContainText('1 fired');
  await expect(page.getByTestId('axis-alerts-summary')).toContainText('1 off');

  const rows = page.getByTestId('axis-alerts-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute('data-tone', 'fired');
  await expect(rows.first()).toContainText('2m ago');

  // Filter chips carry live counts.
  await expect(page.getByTestId('axis-alerts-filter-price')).toContainText('2');
  await page.getByTestId('axis-alerts-filter-onchain').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('AAVE TVL spike');
  await page.getByTestId('axis-alerts-filter-all').click();

  // Search spans name, symbol, and condition.
  await page.getByTestId('axis-alerts-search').fill('eth');
  await expect(page.getByTestId('axis-alerts-count')).toContainText('1 / 3');
  await expect(rows).toHaveCount(1);
  await page.getByTestId('axis-alerts-search').press('Escape');
  await expect(rows).toHaveCount(3);
});

test('alerts panel: create, edit, duplicate, bulk, and delete', async ({ page }) => {
  const rows = page.getByTestId('axis-alerts-row');
  await expect(page.getByTestId('axis-alerts-composer')).toHaveCount(0);

  // Create a price alert.
  await page.getByTestId('axis-alerts-new').click();
  await expect(page.getByTestId('axis-alerts-composer')).toBeVisible();
  await page.getByTestId('axis-alerts-name').fill('SOL reclaim');
  await page.getByTestId('axis-alerts-symbol').fill('SOLUSDT');
  await page.getByTestId('axis-alerts-price').fill('150');
  await page.getByTestId('axis-alerts-create').click();
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('axis-alerts-summary')).toContainText('4 alerts');
  await expect(rows.last()).toContainText('SOL reclaim');

  // Edit prefills and saves.
  await rows.last().getByTestId('axis-alerts-row-menu').click();
  await page.getByTestId('axis-alerts-row-menu-row').getByText('Edit').click();
  await expect(page.getByTestId('axis-alerts-name')).toHaveValue('SOL reclaim');
  await expect(page.getByTestId('axis-alerts-price')).toHaveValue('150');
  await page.getByTestId('axis-alerts-name').fill('SOL 150');
  await page.getByTestId('axis-alerts-create').click();
  await expect(rows.last()).toContainText('SOL 150');
  await expect(page.getByTestId('axis-alerts-composer')).toHaveCount(0);

  // Duplicate opens a prefilled composer with a copy name.
  await rows.last().getByTestId('axis-alerts-row-menu').click();
  await page.getByTestId('axis-alerts-row-menu-row').getByText('Duplicate').click();
  await expect(page.getByTestId('axis-alerts-name')).toHaveValue('SOL 150 copy');
  await page.getByTestId('axis-alerts-cancel').click();
  await expect(page.getByTestId('axis-alerts-composer')).toHaveCount(0);

  // Toggle one alert off.
  await rows.first().getByTestId('axis-alerts-toggle').click();
  await expect(rows.first()).toHaveAttribute('data-enabled', '0');

  // Bulk disable / enable.
  await page.getByTestId('axis-alerts-bulk-toggle').click();
  await page.getByTestId('axis-alerts-bulk').getByText('Disable all').click();
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toHaveAttribute('data-enabled', '0');
  await page.getByTestId('axis-alerts-bulk').getByText('Enable all').click();
  await expect(rows.first()).toHaveAttribute('data-enabled', '1');

  // Delete one row (confirm dialog).
  page.on('dialog', (d) => void d.accept());
  await rows.last().getByTestId('axis-alerts-row-menu').click();
  await page.getByTestId('axis-alerts-row-menu-row').getByText('Delete').click();
  await expect(rows).toHaveCount(3);
});

test('alerts panel: composer opens when there are no alerts', async ({ page }) => {
  // A later init script wins, so this reload starts from an empty catalog.
  await seedAlerts(page, []);
  await page.reload();
  await openAlerts(page);
  await expect(page.getByTestId('axis-alerts-composer')).toBeVisible();
  await expect(page.getByTestId('axis-alerts-empty')).toBeVisible();
  await expect(page.getByTestId('axis-alerts-summary')).toContainText('0 alerts');
});
