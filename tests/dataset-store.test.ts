// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getDataset,
  peekDataset,
  putDatasetBars,
  replaceDataset,
  removeDataset,
  removeDatasetEverywhere,
  flushDatasets,
  setPersistenceMode,
  getPersistenceMode,
  setMergePolicy,
  subscribeDatasets,
  listMemoryDatasets,
  keyFor,
  awaitPendingCopies,
  _resetDatasetStoreForTests,
  _drainDatasetWritesForTests,
} from '../src/data/dataset-store';
import { _resetDatasetSinksForTests } from '../src/data/dataset-sinks';
import { _resetBarsCacheForTests } from '../src/data/bars-cache';
import type { Bar } from '../src/store/types';

function bar(t: number, close: number): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

beforeEach(async () => {
  // Drain the writes a previous file left in flight: a write that lands
  // after the reset would put a dataset in this file's mirror that this
  // file never created.
  await _drainDatasetWritesForTests();
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

  it('peekDataset returns the live memory array without copying', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1), bar(120, 2)]);
    const peeked = peekDataset('binance-rest', 'BTCUSDT', '1d');
    const copied = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(peeked).not.toBeNull();
    expect(peeked!.map((b) => b.time)).toEqual([60, 120]);
    expect(copied).not.toBe(peeked);
    expect(peekDataset('binance-rest', 'NOSUCH', '1d')).toBeNull();
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

  it('getDataset never throws when the git sink has no plugin', async () => {
    setPersistenceMode('git');
    const bars = await getDataset('binance-rest', 'NOSINK', '1d');
    expect(Array.isArray(bars)).toBe(true);
    expect(bars).toHaveLength(0);
  });

  it('a closed candle is never overwritten by a forming bar', async () => {
    // The immutable candle: a closed bar is final. A stale REST page that
    // still carries the partial (forming) values must not reopen it.
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [
      { ...bar(60, 100), closed: true },
    ]);
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [
      { ...bar(60, 42), closed: false },
    ]);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars[0]!.close).toBe(100);
  });

  it('a closed restatement still wins over the closed bar', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [
      { ...bar(60, 100), closed: true },
    ]);
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [
      { ...bar(60, 101), closed: true },
    ]);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars[0]!.close).toBe(101);
  });

  it('keeps the newest bar of a duplicated open time', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 2)]);
    const bars = await getDataset('binance-rest', 'BTCUSDT', '1d');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.close).toBe(2);
  });

  it('serializes concurrent writes so no bar is lost', async () => {
    // Two writers racing on a cold mirror used to read the same base and the
    // second write dropped the first one's bars.
    const { putCachedBars } = await import('../src/data/bars-cache');
    await putCachedBars('binance-rest', 'RACE', '1h', [bar(60, 1)]);
    await Promise.all([
      putDatasetBars('binance-rest', 'RACE', '1h', [bar(3600, 2)]),
      putDatasetBars('binance-rest', 'RACE', '1h', [bar(7200, 3)]),
    ]);
    const bars = await getDataset('binance-rest', 'RACE', '1h');
    expect(bars.map((b) => b.time)).toEqual([60, 3600, 7200]);
  });

  it('does not write when the sink read fails (no truncation)', async () => {
    // A failed sink read used to look like an empty dataset: the merge base
    // was empty, so the last page replaced the whole series.
    setPersistenceMode('git'); // no git plugin / PAT → the sink read throws
    const res = await putDatasetBars('binance-rest', 'BROKEN', '1d', [bar(60, 1)]);
    expect(res.bars).toHaveLength(0);
    expect(res.added).toBe(0);
    expect(peekDataset('binance-rest', 'BROKEN', '1d')).toBeNull();
  });

  it('migrates a dataset that only the old sink holds', async () => {
    // A dataset that lived solely in the old sink (evicted from the mirror,
    // or written before it was warmed) was invisible in the new mode: only
    // the memory mirror was copied.
    const { putCachedBars } = await import('../src/data/bars-cache');
    await putCachedBars('binance-rest', 'SOLO', '1h', [bar(60, 1), bar(3600, 2)]);
    // The dataset store never saw it — its mirror is cold.
    expect(peekDataset('binance-rest', 'SOLO', '1h')).toBeNull();

    setPersistenceMode('session');
    await awaitPendingCopies();

    const bars = await getDataset('binance-rest', 'SOLO', '1h');
    expect(bars.map((b) => b.time)).toEqual([60, 3600]);
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

  it('getDataset keeps the memory mirror across a persistence-mode switch', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1), bar(120, 2)]);
    setPersistenceMode('session');
    expect((await getDataset('binance-rest', 'BTCUSDT', '1d')).map((b) => b.time)).toEqual([
      60, 120,
    ]);
    setPersistenceMode('git');
    expect((await getDataset('binance-rest', 'BTCUSDT', '1d')).length).toBe(2);
    setPersistenceMode('local');
    expect((await getDataset('binance-rest', 'BTCUSDT', '1d')).length).toBe(2);
  });
});

describe('dataset-store · full delete + flush', () => {
  it('a write queued before a reset does not repopulate the mirror', async () => {
    // The suite resets the singletons between files; a write that was still
    // queued when the reset ran used to land in the next file's mirror — a
    // dataset the next file never created.
    const pending = putDatasetBars('binance-rest', 'LATEUSDT', '1d', [bar(60, 1)]);
    _resetDatasetStoreForTests();
    await pending.catch(() => undefined);
    expect(listMemoryDatasets()).toHaveLength(0);
  });

  it('removeDatasetEverywhere drops the bars and the metadata row', async () => {
    const key = keyFor('binance-rest', 'BTCUSDT', '1d');
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    expect(listMemoryDatasets().some((m) => m.key === key)).toBe(true);

    await removeDatasetEverywhere('binance-rest', 'BTCUSDT', '1d');

    // Metadata (memory mirror) is gone — the manager list must not re-add it.
    // The check is key-scoped: another suite file's dataset in the shared
    // mirror must not decide this test.
    expect(listMemoryDatasets().some((m) => m.key === key)).toBe(false);
    expect(await getDataset('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
    const { getCachedBars, listCachedSeries } = await import('../src/data/bars-cache');
    expect(await getCachedBars('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
    expect((await listCachedSeries()).some((c) => c.key === key)).toBe(false);
  });

  it('removeDatasetEverywhere clears every sink, not only the active one', async () => {
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    // Local sink holds a copy while the active mode is git.
    setPersistenceMode('git');
    await removeDatasetEverywhere('binance-rest', 'BTCUSDT', '1d');
    const { getCachedBars } = await import('../src/data/bars-cache');
    expect(await getCachedBars('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
  });

  it('flushDatasets wipes every dataset (bars + metadata) from all sinks', async () => {
    const btc = keyFor('binance-rest', 'BTCUSDT', '1d');
    const eth = keyFor('binance-rest', 'ETHUSDT', '1h');
    await putDatasetBars('binance-rest', 'BTCUSDT', '1d', [bar(60, 1)]);
    await putDatasetBars('binance-rest', 'ETHUSDT', '1h', [bar(3600, 2)]);
    expect(listMemoryDatasets().some((m) => m.key === btc || m.key === eth)).toBe(true);

    const removed = await flushDatasets();

    // At least the two datasets this test created (a foreign dataset in the
    // shared mirror must not decide the count).
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(listMemoryDatasets().some((m) => m.key === btc || m.key === eth)).toBe(false);
    const { getCachedBars, listCachedSeries } = await import('../src/data/bars-cache');
    expect((await listCachedSeries()).some((c) => c.key === btc || c.key === eth)).toBe(false);
    expect(await getCachedBars('binance-rest', 'BTCUSDT', '1d')).toHaveLength(0);
    expect(await getCachedBars('binance-rest', 'ETHUSDT', '1h')).toHaveLength(0);
  });

  it('flushDatasets clears datasets that only live in the local cache', async () => {
    const { putCachedBars, listCachedSeries } = await import('../src/data/bars-cache');
    await putCachedBars('binance-rest', 'SOLUSDT', '1d', [bar(60, 1)]);
    expect(await listCachedSeries()).toHaveLength(1);

    await flushDatasets();

    expect(await listCachedSeries()).toHaveLength(0);
  });
});
