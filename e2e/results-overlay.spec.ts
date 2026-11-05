/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Results overlay: event stream filters, plot stat strip, and saved-run
 * sort / search / multi-select.
 *
 * The server engine prefers WebSocket `/ws/run`, which Playwright cannot
 * stub, so these tests pin it to REST (`preferWs: false`) and point the
 * endpoint at the stubbed origin.
 */

import { expect, test, type Page } from '@playwright/test';
import { seedAxisStore, seedManualLoad, stubAppNetwork } from './charts';
import { openDockedEditor } from './studio';

const RUN_BODY = {
  status: 'success',
  plots: [],
  series: { fast: [1, 3, 2, 5, 4, 7], slow: [2, 2, 3, 3, 4, 4] },
  events: [
    { type: 'entry', dir: 'long', id: 'L1', time: 1762100000, price: 100, qty: 1 },
    { type: 'close', dir: 'long', id: 'L2', time: 1762103600, price: 104, qty: 1, pnl: 40 },
    { type: 'entry', dir: 'short', id: 'S1', time: 1762107200, price: 103, qty: 1 },
    { type: 'exit', dir: 'short', id: 'S2', time: 1762110800, price: 101, qty: 1, pnl: 20 },
  ],
  meta: { script_name: 'e2e-strategy', overlay: false, ms: 18, script_type: 'strategy' },
};

/** Open the Results overlay with a completed strategy run behind it. */
async function openResultsWithRun(page: Page) {
  await stubAppNetwork(page, RUN_BODY);
  await seedManualLoad(page);
  await seedAxisStore(page, {
    endpoint: 'http://127.0.0.1:5002',
    pluginsConfig: { 'engine:server': { preferWs: false } },
  });
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('axis-select-source').selectOption('mock-walk');
  await page.getByTestId('axis-btn-load').click();
  await expect(page.getByTestId('axis-status-message')).toContainText(/Loaded \d+ bars/, {
    timeout: 20_000,
  });
  await openDockedEditor(page);
  await page.getByTestId('axis-select-engine').selectOption('server');
  await page.getByTestId('axis-btn-run').click();
  await expect(page.getByTestId('axis-btn-run')).toBeEnabled({ timeout: 20_000 });
  // Strategies auto-open Results shortly after the run settles. Wait for the
  // overlay first — clicking the topbar while it is open fails, because the
  // backdrop intercepts pointer events.
  const overlay = page.getByTestId('axis-results');
  try {
    await overlay.waitFor({ state: 'visible', timeout: 3_000 });
  } catch {
    await page.getByTestId('axis-btn-results').click();
    await overlay.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await expect(overlay).toBeVisible();
  // The overlay is a focus-trapped dialog. A strategy run dispatches
  // `axis-results-tab` to focus Strategy, which can land *after* the first
  // click, so select Events last and confirm the tab actually stuck.
  await page.getByRole('tab', { name: 'Events' }).click();
  await expect(page.getByRole('tab', { name: 'Events' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('axis-events-views')).toBeVisible();
}

test('results: event filters narrow the stream', async ({ page }) => {
  await openResultsWithRun(page);

  const rows = page.locator('[data-testid="axis-events-stream"] .ax-event-row');
  // Solid re-renders the list after the tab switch; poll the count.
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBe(4);
  await expect(page.getByTestId('axis-events-counts')).toContainText('4 event');
  await expect(page.getByTestId('axis-events-counts')).toContainText('2 positions');

  // Direction filter.
  await page.getByTestId('axis-events-dir-long').click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('L1');
  await expect(page.getByTestId('axis-events-counts')).toContainText('2 / 4 event');

  // Side filter stacks on top of direction.
  await page.getByTestId('axis-events-side-exits').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('L2');

  // Reset restores everything.
  await page.getByTestId('axis-events-reset').click();
  await expect(rows).toHaveCount(4);
  await expect(page.getByTestId('axis-events-reset')).toHaveCount(0);

  // Text search matches ids and directions.
  await page.getByTestId('axis-events-query').fill('s2');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('S2');

  // No match state, and Esc clears the query.
  await page.getByTestId('axis-events-query').fill('zzz');
  await expect(page.getByTestId('axis-events-no-match')).toBeVisible();
  await page.getByTestId('axis-events-query').press('Escape');
  await expect(rows).toHaveCount(4);
});

test('results: plots show min, max, and change', async ({ page }) => {
  await openResultsWithRun(page);
  await page.getByRole('tab', { name: 'Plots' }).click();

  const cards = page.locator('.ax-plot-card');
  await expect(cards).toHaveCount(2);

  const fast = cards.filter({ hasText: 'fast' });
  await expect(fast).toContainText('6 pts');
  await expect(fast.locator('.ax-plot-stats')).toContainText('min');
  await expect(fast.locator('.ax-plot-stats')).toContainText('1');
  await expect(fast.locator('.ax-plot-stats')).toContainText('max');
  await expect(fast.locator('.ax-plot-stats')).toContainText('7');
  await expect(fast.locator('.ax-plot-stats')).toContainText('+600.00%');
  await expect(fast.locator('svg.ax-spark path')).toHaveAttribute('d', /^M /);
});

test('results: saved runs sort, search, and multi-select', async ({ page }) => {
  await openResultsWithRun(page);
  await page.getByRole('tab', { name: 'Saved' }).click();

  // The completed run persisted under the focused script; seed extras so the
  // sort has something to order.
  const emptyCode = page.locator('[data-testid="axis-results-saved-empty"] code');
  let scriptId = (await emptyCode.count()) ? await emptyCode.textContent() : null;
  if (!scriptId) {
    scriptId = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="axis-results-saved"]');
      return el?.getAttribute('data-script-id') ?? 'main.pine';
    });
  }
  expect(scriptId).toBeTruthy();

  await page.evaluate(async (sid) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('pynescript.axis.storage', 3);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('results')) {
            const s = db.createObjectStore('results');
            s.createIndex('byScript', 'meta.scriptId', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('results', 'readwrite');
      const store = tx.objectStore('results');
      const now = Date.now();
      const rows = [
        { runId: 'r-a', startedAt: now - 86_400_000, totalPnl: 120, winRate: 62.5, trades: 8 },
        { runId: 'r-b', startedAt: now - 43_200_000, totalPnl: -40, winRate: 33.3, trades: 6 },
        { runId: 'r-c', startedAt: now - 3_600_000, totalPnl: 260, winRate: 75, trades: 12 },
      ];
      for (const r of rows) {
        store.put(
          {
            meta: {
              scriptId: sid,
              runId: r.runId,
              startedAt: r.startedAt,
              durationMs: 210,
              scriptKind: 'strategy',
              schemaVersion: 1,
              label: `Run ${r.runId.slice(-1).toUpperCase()}`,
              inputs: { symbol: 'BTCUSDT', timeframe: '15m' },
              stats: r,
            },
            result: { status: 'success', plots: [], events: [] },
          },
          [sid, r.runId],
        );
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, scriptId);
  await page.getByTestId('axis-results-saved-refresh').click();

  const rows = page.getByTestId('axis-results-saved-row');
  // The completed run persists too, so assert on the seeded rows rather than
  // the total.
  const seeded = page
    .getByTestId('axis-results-saved-list')
    .locator('.ax-card-title')
    .filter({ hasText: /^Run [ABC]$/ });
  await expect(seeded).toHaveCount(3, { timeout: 10_000 });
  const labels = () => seeded.allTextContents();

  // Newest first by default.
  expect(await labels()).toEqual(['Run C', 'Run B', 'Run A']);

  // Sort by net P&L desc.
  await page.getByTestId('axis-results-saved-sort').selectOption('pnl');
  await expect.poll(labels).toEqual(['Run C', 'Run A', 'Run B']);

  // Sort by trades.
  await page.getByTestId('axis-results-saved-sort').selectOption('trades');
  await expect.poll(labels).toEqual(['Run C', 'Run A', 'Run B']);

  // Search narrows the list.
  await page.getByTestId('axis-results-saved-query').fill('run b');
  await expect(seeded).toHaveCount(1);
  await expect(seeded.first()).toHaveText('Run B');
  await page.getByTestId('axis-results-saved-query').fill('nope');
  await expect(page.getByTestId('axis-results-saved-no-match')).toBeVisible();
  await page.getByTestId('axis-results-saved-query').fill('');

  // Select all, then bulk delete every visible run (seeded + the completed one).
  await page.getByTestId('axis-results-saved-selectall').check();
  const total = await rows.count();
  await expect(page.getByTestId('axis-results-saved-delete-selected')).toContainText(
    `Delete ${total}`,
  );

  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('axis-results-saved-delete-selected').click();
  await expect(rows).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('axis-results-saved-empty')).toBeVisible();
});

test('results: saved row selection toggles individually', async ({ page }) => {
  await openResultsWithRun(page);
  await page.getByRole('tab', { name: 'Saved' }).click();
  const rows = page.getByTestId('axis-results-saved-row');
  if ((await rows.count()) === 0) {
    test.skip(true, 'no saved runs to select in this run');
    return;
  }
  const check = rows.first().getByTestId('axis-results-saved-rowcheck');
  await check.check();
  await expect(rows.first()).toHaveClass(/is-selected/);
  await expect(page.getByTestId('axis-results-saved-delete-selected')).toContainText('Delete 1');
  await check.uncheck();
  await expect(rows.first()).not.toHaveClass(/is-selected/);
});

test('results: commission nets into net profit and exposes the fee total', async ({ page }) => {
  await openResultsWithRun(page);
  await page.getByRole('tab', { name: 'Strategy' }).click();
  await expect(page.getByTestId('axis-strategy-report')).toBeVisible();

  // Gross P&L with no commission: +6.00 from the stubbed events.
  await expect(page.getByTestId('axis-strategy-net')).toContainText('+6.00');
  await expect(page.getByTestId('axis-strategy-commission-total')).toHaveCount(0);

  // Turn commission on, then charge a flat 2 per fill.
  await page.getByTestId('axis-strategy-commission-on').check();
  await page.getByTestId('axis-strategy-commission-value').fill('2');
  await page.getByTestId('axis-strategy-commission-type').selectOption('cash_per_order');

  // 2 trades × (entry + exit) × 2 = 8 charged; net = 6 − 8 = −2.
  await expect(page.getByTestId('axis-strategy-commission-total')).toContainText('-8.00');
  await expect(page.getByTestId('axis-strategy-gross-pnl')).toContainText('+6.00');
  await expect(page.getByTestId('axis-strategy-net')).toContainText('-2.00');

  // Fees are real money: the win rate collapses because both legs now lose.
  await expect(page.getByTestId('axis-strategy-stats')).toContainText('0.0%');

  // Turning it back off restores gross P&L.
  await page.getByTestId('axis-strategy-commission-on').uncheck();
  await expect(page.getByTestId('axis-strategy-net')).toContainText('+6.00');
  await expect(page.getByTestId('axis-strategy-commission-total')).toHaveCount(0);
});
