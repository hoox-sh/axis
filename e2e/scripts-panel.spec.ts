/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Scripts panel: search/filter, bulk visibility, card actions, plot collapse.
 * Scripts are seeded so no engine run is needed.
 */

import { expect, test } from '@playwright/test';
import { loadMockBars, seedAxisStore, stubAppNetwork } from './charts';

const SMA = `//@version=6
indicator("AXIS SMA", overlay=true)
plot(ta.sma(close, 20), "SMA")
plot(ta.sma(close, 50), "SMA 50")`;
const RSI = `//@version=6
indicator("AXIS RSI", overlay=false)
plot(ta.rsi(close, 14), "RSI")`;
const STRAT = `//@version=6
strategy("MACD Strat", overlay=true)
plot(ta.macd(close, 12, 26, 9), "MACD")`;

test.beforeEach(async ({ page }) => {
  await stubAppNetwork(page);
  await seedAxisStore(page, {
    scripts: [
      {
        id: 'ind_sma',
        name: 'AXIS SMA',
        code: SMA,
        paneId: 'price',
        visible: true,
        plots: { SMA: { color: '#8B9CFF' }, 'SMA 50': { color: '#3DDC97' } },
      },
      {
        id: 'ind_rsi',
        name: 'AXIS RSI',
        code: RSI,
        paneId: 'ind_rsi',
        visible: true,
        plots: { RSI: { color: '#E8B84A' } },
      },
      {
        id: 'ind_macd',
        name: 'MACD Strat',
        code: STRAT,
        paneId: 'price',
        visible: true,
        plots: { MACD: { color: '#F07178' } },
      },
    ],
  });
  await loadMockBars(page, { historyBars: 200 });
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  const btn = page.getByTestId('axis-btn-indicators');
  if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
  await expect(page.getByTestId('axis-indicators')).toBeVisible();
});

test('scripts panel: search, filters, bulk, card actions, plot collapse', async ({ page }) => {
  const cards = page.getByTestId('axis-indicator-card');
  await expect(cards).toHaveCount(3);
  await expect(page.getByTestId('axis-scripts-summary')).toContainText('3 scripts');
  await expect(page.getByTestId('axis-scripts-summary')).toContainText('4 plots');

  // Kind filter.
  await page.getByTestId('axis-scripts-filter-strategy').click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('MACD Strat');
  await page.getByTestId('axis-scripts-filter-all').click();
  await expect(cards).toHaveCount(3);

  // Search + clear.
  const search = page.getByTestId('axis-scripts-search');
  await search.fill('rsi');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('AXIS RSI');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(cards).toHaveCount(3);

  // Bulk hide/show.
  await page.getByTestId('axis-scripts-bulk-toggle').click();
  await page.getByTestId('axis-scripts-bulk').getByText('Hide all').click();
  await expect(cards.first()).toHaveAttribute('data-hidden', 'true');
  await page.getByTestId('axis-scripts-bulk').getByText('Show all').click();
  await expect(cards.first()).not.toHaveAttribute('data-hidden', 'true');

  // Plot controls collapse / expand (SMA has 2 plots → open by default).
  const sma = page.getByTestId('axis-indicator-card').filter({ hasText: 'AXIS SMA' });
  await expect(sma.getByTestId('axis-plot-width').first()).toBeVisible();
  await sma.getByTestId('axis-plots-toggle').click();
  await expect(sma.getByTestId('axis-plot-width')).toHaveCount(0);
  await sma.getByTestId('axis-plots-toggle').click();
  await expect(sma.getByTestId('axis-plot-width').first()).toBeVisible();

  // Card actions: move down, then remove.
  await sma.getByTestId('axis-indicator-more').click();
  await expect(sma.getByTestId('axis-indicator-more-row')).toBeVisible();
  await sma.getByTestId('axis-indicator-more-row').getByText('Down').click();
  await expect(cards.first()).toContainText('AXIS RSI');

  await cards.first().getByTestId('axis-indicator-more').click();
  await cards.first().getByTestId('axis-indicator-more-row').getByText('Remove').click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId('axis-scripts-summary')).toContainText('2 scripts');
});
