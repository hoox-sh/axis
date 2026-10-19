/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Dataset manager — full delete (bars + metadata) and the Settings flush.
 *
 * The delete used to clear only the local bars cache: the dataset-store
 * memory mirror kept the series, so the metadata row survived and came
 * back in the list. Both flows must leave nothing behind.
 */

import { expect, test, type Page } from '@playwright/test';

const DATASET_KEY = 'binance-rest|BTCUSDT|1d';

/** Seed the local bars cache (IndexedDB) with one dataset. */
async function seedDataset(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bars = Array.from({ length: 5 }, (_, i) => ({
      time: 1700000000 + i * 86400,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 10,
    }));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('axis-bars-cache', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('bars')) {
          db.createObjectStore('bars', { keyPath: 'key' });
        }
      };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('bars', 'readwrite');
        tx.objectStore('bars').put({
          key: 'binance-rest|BTCUSDT|1d',
          sourceId: 'binance-rest',
          symbol: 'BTCUSDT',
          interval: '1d',
          bars,
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

async function openDatasetManager(page: Page): Promise<void> {
  await page.getByTestId('axis-btn-datasource').click();
  await page.getByTestId('axis-datasource-open-datasets').click();
  await expect(page.getByTestId('axis-cached-datasets-modal')).toBeVisible();
}

test('dataset manager delete removes bars + metadata', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  await seedDataset(page);

  await openDatasetManager(page);
  const row = page.getByTestId(`axis-cached-dataset-${DATASET_KEY}`);
  await expect(row).toBeVisible();

  // Load it so the dataset-store memory mirror holds the metadata row.
  await page.getByTestId('axis-cached-datasets-load').click();
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /^Delete$/ }).click();
  await page.getByRole('button', { name: 'Yes, delete' }).click();
  await page.waitForTimeout(800);

  // Bars and metadata are gone — the row must not come back.
  await expect(row).toHaveCount(0);
});

test('settings flushes the dataset manager', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('axis-topbar').waitFor({ state: 'visible', timeout: 30_000 });
  await seedDataset(page);

  await page.getByTestId('axis-btn-studio').click();
  const settingsRail = page.getByTestId('axis-studio-rail-settings');
  await expect(settingsRail).toBeVisible({ timeout: 15_000 });
  await settingsRail.click();
  await expect(page.getByTestId('axis-settings')).toBeVisible();

  await page.getByTestId('axis-settings-tab-data').click();
  const flush = page.getByTestId('axis-settings-flush-datasets');
  await expect(flush).toBeVisible();

  page.on('dialog', (d) => d.accept());
  await flush.click();

  const msg = page.getByTestId('axis-settings-flush-datasets-msg');
  await expect(msg).toBeVisible();
  await expect(msg).toContainText('Dataset manager flushed');
});
