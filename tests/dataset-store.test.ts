// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getDataset,
  putDatasetBars,
  replaceDataset,
  removeDataset,
  setPersistenceMode,
  getPersistenceMode,
  setMergePolicy,
  subscribeDatasets,
  listMemoryDatasets,
  keyFor,
  _resetDatasetStoreForTests,
} from '../src/data/dataset-store';
import { _resetDatasetSinksForTests } from '../src/data/dataset-sinks';
import { _resetBarsCacheForTests } from '../src/data/bars-cache';
import type { Bar } from '../src/store/types';

function bar(t: number, close: number): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

beforeEach(async () => {
  _resetDatasetStoreForTests();
  _resetDatasetSinksForTests();
  await _resetBarsCacheForTests();
});

describe('dataset-store', () => {
  it('defaults to local persistence', () => {
    expect(getPersistenceMode()).toBe('local');
  });

  it('put + get round-trips through the memory mirror', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1), bar(120, 2)]);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars.map((b) => b.time)).toEqual([60, 120]);
  });

  it('merges overlapping writes with newest-wins by default', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 100)]);
    const res = await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 999)]);
    expect(res.conflicts).toBe(1);
    expect(res.added).toBe(0);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars[0]!.close).toBe(999);
  });

  it('keep-current policy preserves existing bars on conflict', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 100)]);
    setMergePolicy('keep-current');
    const res = await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 999)]);
    expect(res.conflicts).toBe(1);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars[0]!.close).toBe(100);
  });

  it('session mode keeps memory but never persists to bars-cache', async () => {
    setPersistenceMode('session');
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    expect((await getDataset('binance-rest', 'BTCUSDT', '1d')).length).toBe(1);
    // local sink must be untouched
    const { getCachedBars } = await import('../src/data/bars-cache');
    expect(await getCachedBars('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
  });

  it('local mode persists through bars-cache', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    const { getCachedBars } = await import('../src/data/bars-cache');
    const cached = await getCachedBars('binance-rest', 'BTCUSDT', '1d');
    expect(cached.map((b) => b.time)).toEqual([60]);
  });

  it('get falls back to the local sink when memory is cold', async () => {
    const { putCachedBars } = await import('../src/data/bars-cache');
    await putCachedBars('binance-rest', 'ETHUSDT', '1h', [bar(3600, 5)]);
    const bars = await getDataset('binance-rest', 'ETHUSDT', '1h');
    expect(bars.map((b) => b.time)).toEqual([3600]);
  });

  it('replace overwrites the dataset and emits change', async () => {
    const events: string[] = [];
    subscribeDatasets((key) => events.push(key));
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1), bar(120, 2)]);
    await replaceDataset('binance-rest', 'BTCUSDT', '1d', [bar(300, 9)]);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars.map((b) => b.time)).toEqual([300]);
    expect(events.filter((k) => k === keyFor('binance-rest', 'BTCUSDT', '1d')).length).toBe(2);
  });

  it('remove clears memory and sink', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    await removeDataset('binance-rest', 'BTCUSDT', '1d');
    expect(await getDataset('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
    const { getCachedBars } = await import('../src/data/bars-cache');
    expect(await getCachedBars('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
  });

  it('listMemoryDatasets reports counts and bounds', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1), bar(120, 2)]);
    const metas = listMemoryDatasets();
    expect(metas).toHaveLength(1);
    expect(metas[0]!.barCount).toBe(2);
    expect(metas[0]!.oldestSec).toBe(60);
    expect(metas[0]!.newestSec).toBe(120);
  });

  it('subscribe fires on put with merged series', async () => {
    let lastLen = 0;
    const unsub = subscribeDatasets((_key, bars) => {
      lastLen = bars.length;
    });
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    expect(lastLen).toBe(1);
    unsub();
  });
});
