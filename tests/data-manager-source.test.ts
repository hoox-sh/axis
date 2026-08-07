// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  clearDataManagerSelection,
  getDataManagerSelection,
  resolveDataManagerBars,
  setDataManagerSelection,
  DATA_MANAGER_SOURCE_ID,
} from '../src/data/data-manager-source';
import { putCachedBars, _resetBarsCacheForTests } from '../src/data/bars-cache';
import {
  ensureSourcesRegistered,
  getSource,
  listSources,
  _resetSourceRegistrationFlag,
} from '../src/sources/catalog';
import type { Bar } from '../src/store/types';

function bar(t: number): Bar {
  return { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
}

describe('data-manager source', () => {
  beforeEach(async () => {
    await _resetBarsCacheForTests();
    clearDataManagerSelection();
    _resetSourceRegistrationFlag();
    ensureSourcesRegistered();
  });

  it('is registered as a built-in offline source', () => {
    const ids = listSources().map((s) => s.id);
    expect(ids).toContain(DATA_MANAGER_SOURCE_ID);
    const src = getSource(DATA_MANAGER_SOURCE_ID);
    expect(src?.name).toMatch(/Data Manager/i);
    expect(src?.capabilities?.offline).toBe(true);
  });

  it('resolve prefers explicit selection', async () => {
    await putCachedBars('binance-rest', 'BTCUSDT', '1h', [bar(100), bar(200)]);
    await putCachedBars('okx-rest', 'BTCUSDT', '1h', [bar(100), bar(200), bar(300)]);
    setDataManagerSelection('binance-rest', 'BTCUSDT', '1h');
    const resolved = await resolveDataManagerBars('BTCUSDT', '1h');
    expect(resolved?.sourceId).toBe('binance-rest');
    expect(resolved?.bars).toHaveLength(2);
    expect(getDataManagerSelection()?.sourceId).toBe('binance-rest');
  });

  it('resolve honours load window on selection', async () => {
    await putCachedBars('binance-rest', 'BTCUSDT', '1h', [
      bar(100),
      bar(200),
      bar(300),
      bar(400),
      bar(500),
    ]);
    setDataManagerSelection('binance-rest', 'BTCUSDT', '1h', {
      fromSec: 200,
      toSec: 400,
      maxBars: 2,
    });
    const resolved = await resolveDataManagerBars('BTCUSDT', '1h');
    expect(resolved?.bars.map((b) => b.time)).toEqual([300, 400]);
    expect(getDataManagerSelection()?.maxBars).toBe(2);
  });

  it('resolve falls back to largest matching series', async () => {
    await putCachedBars('binance-rest', 'ETHUSDT', '1d', [bar(1)]);
    await putCachedBars('okx-rest', 'ETHUSDT', '1d', [bar(1), bar(2), bar(3)]);
    const resolved = await resolveDataManagerBars('ETHUSDT', '1d');
    expect(resolved?.sourceId).toBe('okx-rest');
    expect(resolved?.bars).toHaveLength(3);
  });

  it('fetchHistorical throws when cache empty', async () => {
    const src = getSource(DATA_MANAGER_SOURCE_ID)!;
    await expect(
      src.fetchHistorical({ symbol: 'NONE', interval: '1d' }),
    ).rejects.toThrow(/No cached dataset/);
  });

  it('fetchHistorical returns cached bars', async () => {
    // Use mock-walk so expand-to-now does not hit a real venue network
    const now = Math.floor(Date.now() / 1000);
    const step = 4 * 3600;
    await putCachedBars('mock-walk', 'SOLUSDT', '4h', [
      bar(now - step * 2),
      bar(now - step),
    ]);
    setDataManagerSelection('mock-walk', 'SOLUSDT', '4h');
    const src = getSource(DATA_MANAGER_SOURCE_ID)!;
    const bars = await src.fetchHistorical({ symbol: 'SOLUSDT', interval: '4h' });
    // At least the cached bars; expand may append toward now
    expect(bars.length).toBeGreaterThanOrEqual(2);
  });
});
