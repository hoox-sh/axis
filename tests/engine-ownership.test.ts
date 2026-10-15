// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Engine-owned live mode: the ownership predicate and the two local
 * persistence gates (live-bar cache writes, cache→now expand). In every-tick
 * Pro mode the engine's store owns the series, so AXIS must not write OHLCV
 * to the dataset store / IndexedDB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isEngineOwnedLive } from '../src/engines/ownership';
import {
  _setCachedEngineCapabilitiesForTests,
  _resetEngineRegistrationFlag,
  DEFAULT_ENGINE_CAPABILITIES,
  liveRerunModeForEngine,
} from '../src/engines/catalog';
import type { EngineCapabilities } from '../src/plugins/types';
import {
  noteDataManagerLiveBar,
  expandCachedSeriesToNow,
  _flushDataManagerLiveBarForTests,
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
import { ensureSourcesRegistered, _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { ensureStreamsRegistered, _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { setActivePlugin, setStore } from '../src/store';
import { registry } from '../src/plugins/registry';
import type { SourcePlugin } from '../src/plugins/types';
import type { Bar } from '../src/store/types';

const PRO_CAPS: EngineCapabilities = {
  ...DEFAULT_ENGINE_CAPABILITIES,
  liveModes: ['every-tick', 'bar-close'],
  ownsData: true,
  dataSession: true,
};

function bar(t: number, c = 100): Bar {
  return { time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
}

describe('isEngineOwnedLive', () => {
  beforeEach(() => {
    _setCachedEngineCapabilitiesForTests(null);
    setStore('live', 'rerunOn', 'every-tick');
  });

  afterEach(() => {
    _setCachedEngineCapabilitiesForTests(null);
    setStore('live', 'rerunOn', 'every-tick');
  });

  it('is false while capabilities are unresolved (fail-open)', () => {
    expect(isEngineOwnedLive()).toBe(false);
  });

  it('is true only with dataSession caps and every-tick policy', () => {
    _setCachedEngineCapabilitiesForTests(PRO_CAPS);
    expect(isEngineOwnedLive()).toBe(true);

    setStore('live', 'rerunOn', 'bar-close');
    expect(isEngineOwnedLive()).toBe(false);

    setStore('live', 'rerunOn', 'every-tick');
    _setCachedEngineCapabilitiesForTests({ ...PRO_CAPS, dataSession: false, ownsData: false });
    expect(isEngineOwnedLive()).toBe(false);
  });
});

describe('liveRerunModeForEngine', () => {
  beforeEach(() => {
    _setCachedEngineCapabilitiesForTests(null);
  });

  afterEach(() => {
    _setCachedEngineCapabilitiesForTests(null);
  });

  it('keeps the stored every-tick while capabilities are unknown', () => {
    // A probe that never answered (or failed) is not "bar close only" — the
    // preference must survive so it is not silently reset on reload.
    expect(liveRerunModeForEngine('every-tick')).toBe('every-tick');
    expect(liveRerunModeForEngine(undefined)).toBe('every-tick');
  });

  it('falls back to bar close only when the engine answered without every-tick', () => {
    _setCachedEngineCapabilitiesForTests({
      ...DEFAULT_ENGINE_CAPABILITIES,
      liveModes: ['bar-close'],
    });
    expect(liveRerunModeForEngine('every-tick')).toBe('bar-close');

    _setCachedEngineCapabilitiesForTests(PRO_CAPS);
    expect(liveRerunModeForEngine('every-tick')).toBe('every-tick');
  });

  it('never upgrades a stored bar-close', () => {
    _setCachedEngineCapabilitiesForTests(PRO_CAPS);
    expect(liveRerunModeForEngine('bar-close')).toBe('bar-close');
  });
});

describe('engine-owned persistence gates', () => {
  beforeEach(async () => {
    await _resetBarsCacheForTests();
    _flushDataManagerLiveBarForTests();
    clearDataManagerSelection();
    _resetSourceRegistrationFlag();
    _resetStreamRegistrationFlag();
    _resetEngineRegistrationFlag();
    ensureSourcesRegistered();
    ensureStreamsRegistered();
    setStore('live', 'rerunOn', 'every-tick');
    _setCachedEngineCapabilitiesForTests(null);
  });

  afterEach(() => {
    _setCachedEngineCapabilitiesForTests(null);
    setStore('live', 'rerunOn', 'every-tick');
    _flushDataManagerLiveBarForTests();
    try {
      registry.unregisterSource('own-test-src');
    } catch {
      /* ignore */
    }
  });

  it('noteDataManagerLiveBar does not write when engine-owned', async () => {
    await putCachedBars('binance-rest', 'SOLUSDT', '1m', [bar(1000), bar(1060)]);
    setDataManagerSelection('binance-rest', 'SOLUSDT', '1m');
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    setStore('source', DATA_MANAGER_SOURCE_ID);

    // Engine-owned: the live bar must not reach the cache.
    _setCachedEngineCapabilitiesForTests(PRO_CAPS);
    noteDataManagerLiveBar({ ...bar(1120, 55), closed: true });
    await new Promise((r) => setTimeout(r, 40));
    let cached = await getCachedBars('binance-rest', 'SOLUSDT', '1m');
    expect(cached.map((b) => b.time)).not.toContain(1120);

    // Baseline: without engine ownership the same call persists.
    _setCachedEngineCapabilitiesForTests(null);
    noteDataManagerLiveBar({ ...bar(1120, 55), closed: true });
    await new Promise((r) => setTimeout(r, 40));
    cached = await getCachedBars('binance-rest', 'SOLUSDT', '1m');
    expect(cached.map((b) => b.time)).toContain(1120);
  });

  it('noteDataManagerLiveBar persists when the engine does not own data', async () => {
    await putCachedBars('binance-rest', 'SOLUSDT', '1m', [bar(1000), bar(1060)]);
    setDataManagerSelection('binance-rest', 'SOLUSDT', '1m');
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    setStore('source', DATA_MANAGER_SOURCE_ID);

    _setCachedEngineCapabilitiesForTests({ ...PRO_CAPS, dataSession: false, ownsData: false });
    noteDataManagerLiveBar({ ...bar(1180, 60), closed: true });
    await new Promise((r) => setTimeout(r, 40));
    const cached = await getCachedBars('binance-rest', 'SOLUSDT', '1m');
    expect(cached.map((b) => b.time)).toContain(1180);
  });

  it('expandCachedSeriesToNow neither fetches nor writes when engine-owned', async () => {
    const t0 = 1_700_000_000;
    await putCachedBars('own-test-src', 'BTCUSDT', '1h', [bar(t0), bar(t0 + 3600)]);

    let calls = 0;
    const src: SourcePlugin = {
      id: 'own-test-src',
      name: 'Own Test',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical() {
        calls += 1;
        return [bar(t0 + 7200), bar(t0 + 10800)];
      },
    };
    registry.registerSource(src);

    _setCachedEngineCapabilitiesForTests(PRO_CAPS);
    const result = await expandCachedSeriesToNow('own-test-src', 'BTCUSDT', '1h', {
      nowSec: t0 + 3600 * 10,
    });
    expect(calls).toBe(0);
    expect(result.expanded).toBe(false);
    expect(result.bars.length).toBe(2); // cache served as-is

    const cached = await getCachedBars('own-test-src', 'BTCUSDT', '1h');
    expect(cached.length).toBe(2);
  });

  it('expandCachedSeriesToNow still fetches and writes without engine ownership', async () => {
    const t0 = 1_700_000_000;
    await putCachedBars('own-test-src', 'BTCUSDT', '1h', [bar(t0), bar(t0 + 3600)]);

    let calls = 0;
    const src: SourcePlugin = {
      id: 'own-test-src',
      name: 'Own Test',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical({ endTime }) {
        calls += 1;
        const end = Math.floor(Number(endTime) || t0 + 36000);
        return [bar(end - 3600), bar(end)];
      },
    };
    registry.registerSource(src);

    const nowSec = t0 + 3600 * 10;
    const result = await expandCachedSeriesToNow('own-test-src', 'BTCUSDT', '1h', { nowSec });
    expect(calls).toBeGreaterThan(0);
    expect(result.expanded).toBe(true);

    const cached = await getCachedBars('own-test-src', 'BTCUSDT', '1h');
    expect(cached.length).toBeGreaterThan(2);
  });
});
