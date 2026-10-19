// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  canExpandFromSource,
  expandCachedSeriesToNow,
  fillBarsTowardNow,
  fillInternalGaps,
  noteDataManagerLiveBar,
} from '../src/data/expand-cache';
import {
  putCachedBars,
  getCachedBars,
  _resetBarsCacheForTests,
} from '../src/data/bars-cache';
import {
  clearDataManagerSelection,
  setDataManagerSelection,
  DATA_MANAGER_SOURCE_ID,
} from '../src/data/data-manager-source';
import {
  ensureSourcesRegistered,
  _resetSourceRegistrationFlag,
} from '../src/sources/catalog';
import { defaultStreamForSource } from '../src/streams/catalog';
import { ensureStreamsRegistered, _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { setActivePlugin, setStore } from '../src/store';
import { _setCachedEngineCapabilitiesForTests } from '../src/engines/catalog';
import { registry } from '../src/plugins/registry';
import type { SourcePlugin } from '../src/plugins/types';
import type { Bar } from '../src/store/types';

function bar(t: number, c = 100): Bar {
  return { time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
}

describe('expand-cache', () => {
  beforeEach(async () => {
    await _resetBarsCacheForTests();
    // Module-level capability cache persists across files in one process;
    // a dirty value would route live-bar writes through the ownership gate.
    _setCachedEngineCapabilitiesForTests(null);
    clearDataManagerSelection();
    _resetSourceRegistrationFlag();
    _resetStreamRegistrationFlag();
    ensureSourcesRegistered();
    ensureStreamsRegistered();
  });

  afterEach(() => {
    try {
      registry.unregisterSource('expand-test-src');
      registry.unregisterSource('fill-tail-src');
      registry.unregisterSource('fill-hole-src');
    } catch {
      /* ignore */
    }
  });

  it('canExpandFromSource rejects offline-only ids', () => {
    expect(canExpandFromSource('csv-upload')).toBe(false);
    expect(canExpandFromSource('data-manager')).toBe(false);
    expect(canExpandFromSource('binance-rest')).toBe(true);
    expect(canExpandFromSource('mock-walk')).toBe(true);
  });

  it('defaultStreamForSource(data-manager) follows venue selection', () => {
    expect(defaultStreamForSource('data-manager')).toBe('binance-ws');
    setDataManagerSelection('okx-rest', 'BTCUSDT', '1h');
    expect(defaultStreamForSource('data-manager')).toBe('okx-ws');
    setDataManagerSelection('bybit-rest', 'ETHUSDT', '15m');
    expect(defaultStreamForSource('data-manager')).toBe('bybit-ws');
    expect(defaultStreamForSource('mock-walk')).toMatch(/mock/);
  });

  it('fillBarsTowardNow closes a stale tail so live does not paint a hole', async () => {
    const t0 = 1_700_000_000;
    const step = 60;
    const stale = [bar(t0), bar(t0 + step), bar(t0 + step * 2)];
    const nowSec = t0 + step * 2 + step * 10;
    const src: SourcePlugin = {
      id: 'fill-tail-src',
      name: 'Fill Tail',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical({ endTime, limit }) {
        const end = Math.floor(Number(endTime) || nowSec);
        const n = Math.min(Number(limit) || 10, 10);
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          out.push(bar(end - i * step, 100 + i));
        }
        return out;
      },
    };
    registry.registerSource(src);
    const result = await fillBarsTowardNow(stale, 'fill-tail-src', 'BTCUSDT', '1m', { nowSec });
    expect(result.expanded).toBe(true);
    expect(result.bars[result.bars.length - 1]!.time).toBeGreaterThanOrEqual(nowSec - step);
    const times = result.bars.map((b) => b.time);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBe(step);
    }
  });

  it('fillInternalGaps closes a hole inside an otherwise current series', async () => {
    const step = 60;
    const t0 = 1_700_000_000;
    const left = Array.from({ length: 5 }, (_, i) => bar(t0 + i * step));
    const hole = 5;
    const rightStart = t0 + (5 + hole) * step;
    const right = Array.from({ length: 5 }, (_, i) => bar(rightStart + i * step));
    const seed = [...left, ...right];
    const src: SourcePlugin = {
      id: 'fill-hole-src',
      name: 'Fill Hole',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical({ endTime, limit }) {
        const end = Math.floor(Number(endTime) || 0);
        const n = Math.min(Number(limit) || 20, 20);
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          out.push(bar(end - i * step));
        }
        return out;
      },
    };
    registry.registerSource(src);
    const result = await fillInternalGaps(seed, 'fill-hole-src', 'BTCUSDT', '1m');
    expect(result.expanded).toBe(true);
    const times = result.bars.map((b) => b.time);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBe(step);
    }
  });

  it('expandCachedSeriesToNow fills gap from newest to now via venue pages', async () => {
    // Cache ends far in the past
    const t0 = 1_700_000_000; // ~2023
    await putCachedBars('expand-test-src', 'BTCUSDT', '1h', [
      bar(t0),
      bar(t0 + 3600),
      bar(t0 + 7200),
    ]);

    const nowSec = t0 + 7200 + 3600 * 5; // 5 hours after last bar
    let calls = 0;
    const src: SourcePlugin = {
      id: 'expand-test-src',
      name: 'Expand Test',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical({ endTime, limit }) {
        calls += 1;
        const end = Math.floor(Number(endTime) || nowSec);
        const n = Math.min(Number(limit) || 10, 10);
        const out: Bar[] = [];
        for (let i = n - 1; i >= 0; i--) {
          const t = end - i * 3600;
          out.push(bar(t, 100 + i));
        }
        return out;
      },
    };
    registry.registerSource(src);

    const result = await expandCachedSeriesToNow('expand-test-src', 'BTCUSDT', '1h', {
      nowSec,
    });
    expect(result.expanded).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(result.bars.length).toBeGreaterThan(3);
    expect(result.bars[result.bars.length - 1]!.time).toBeGreaterThanOrEqual(t0 + 7200);

    const cached = await getCachedBars('expand-test-src', 'BTCUSDT', '1h');
    expect(cached.length).toBe(result.bars.length);
  });

  it('noteDataManagerLiveBar appends into the selection cache', async () => {
    await putCachedBars('binance-rest', 'SOLUSDT', '1m', [bar(1000), bar(1060)]);
    setDataManagerSelection('binance-rest', 'SOLUSDT', '1m');
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    setStore('source', DATA_MANAGER_SOURCE_ID);

    // closed:true flushes immediately (open-bar path is debounced)
    noteDataManagerLiveBar({ ...bar(1120, 55), closed: true });
    // putCachedBars is async fire-and-forget — wait a few ticks
    await new Promise((r) => setTimeout(r, 80));

    const cached = await getCachedBars('binance-rest', 'SOLUSDT', '1m');
    expect(cached.map((b) => b.time)).toContain(1120);
    const at1120 = cached.find((b) => b.time === 1120);
    expect(at1120?.close).toBe(55);
  });
});
