/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Integration: `loadSymbolData` with mock-walk + dynamic sources.
 * Guards store bars, unknown/empty/throw sources, race (stale ignore),
 * historyBars clamp, and partial OHLCV sanitization.
 */

import '../setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { registry } from '../../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag, registerDynamicSource } from '../../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../../src/storage/catalog';
import {
  setStore,
  store,
  clearLogs,
  clampHistoryBars,
  HISTORY_BARS_MIN,
} from '../../src/store';
import {
  loadSymbolData,
  _resetLoadGeneration,
} from '../../src/data/load-symbol';
import {
  putCachedBars,
  _resetBarsCacheForTests,
} from '../../src/data/bars-cache';
import { makeBars } from '../fixtures/bars';
import type { Bar } from '../../src/store/types';
import type { SourcePlugin } from '../../src/plugins/types';

beforeEach(async () => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetLoadGeneration();
  await _resetBarsCacheForTests();
  ensureBuiltins();
  clearLogs();
  setStore('bars', []);
  setStore('scripts', []);
  setStore('source', 'mock-walk');
  setStore('historyBars', 500);
  setStore('status', 'idle');
  setStore('statusMessage', '');
  // Default preferAfterLoad is true — a leftover live stream from another
  // file would append a tick after load (+1 bar) and reapply leftover SMA.
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'binance-ws',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
});

function dynSource(
  id: string,
  fetchHistorical: SourcePlugin['fetchHistorical'],
): SourcePlugin {
  return {
    id,
    name: id,
    kind: 'source',
    fetchHistorical,
  };
}

describe('loadSymbolData', () => {
  it('loads mock-walk into store', async () => {
    const ok = await loadSymbolData('ETHUSDT', '1h', 'mock-walk');
    expect(ok).toBe(true);
    expect(store.bars.length).toBeGreaterThan(0);
    expect(store.symbol).toBe('ETHUSDT');
    expect(store.interval).toBe('1h');
    expect(store.exchange).toBe('mock');
    expect(store.status).toBe('ready');
    expect(store.telemetry.source.state).toBe('open');
  });

  it('returns false for unknown source and sets error status', async () => {
    const ok = await loadSymbolData('BTCUSDT', '1d', 'nope-source');
    expect(ok).toBe(false);
    expect(store.status).toBe('error');
    expect(store.statusMessage).toMatch(/Unknown source/i);
    expect(store.telemetry.source.state).toBe('error');
    expect(store.bars).toHaveLength(0);
  });

  it('handles empty bars from source without unhandled rejection', async () => {
    registerDynamicSource(
      dynSource('empty-src', async () => []),
    );
    const ok = await loadSymbolData('X', '1m', 'empty-src');
    expect(ok).toBe(false);
    expect(store.status).toBe('error');
    expect(store.statusMessage).toMatch(/no bars/i);
    expect(store.telemetry.source.state).toBe('error');
    expect(store.telemetry.source.error).toMatch(/no bars/i);
  });

  it('handles plugin throw / network fail — status error, no throw', async () => {
    registerDynamicSource(
      dynSource('throw-src', async () => {
        throw new Error('network down');
      }),
    );
    let unhandled = false;
    const ok = await loadSymbolData('X', '1m', 'throw-src').catch(() => {
      unhandled = true;
      return false;
    });
    expect(unhandled).toBe(false);
    expect(ok).toBe(false);
    expect(store.status).toBe('error');
    expect(store.statusMessage).toMatch(/network down/i);
    expect(store.telemetry.source.state).toBe('error');
    expect(store.telemetry.source.error).toMatch(/network down/i);
  });

  it('falls back to bars-cache when venue fetch fails', async () => {
    const cached = makeBars(8);
    await putCachedBars('offline-src', 'BTCUSDT', '1h', cached);
    registerDynamicSource(
      dynSource('offline-src', async () => {
        throw new Error('network down');
      }),
    );
    const ok = await loadSymbolData('BTCUSDT', '1h', 'offline-src');
    expect(ok).toBe(true);
    expect(store.bars.length).toBe(8);
    expect(store.status).toBe('ready');
    expect(store.statusMessage).toMatch(/Offline|cached/i);
    expect(store.telemetry.source.state).toBe('degraded');
  });

  it('handles non-Error throw values', async () => {
    registerDynamicSource(
      dynSource('throw-str', async () => {
        throw 'venue 503';
      }),
    );
    const ok = await loadSymbolData('X', '1m', 'throw-str');
    expect(ok).toBe(false);
    expect(store.status).toBe('error');
    expect(store.statusMessage).toMatch(/venue 503/i);
  });

  it('rejects all-invalid OHLCV (partial / bad timestamps)', async () => {
    registerDynamicSource(
      dynSource('junk-src', async () => [
        { time: NaN, open: 1, high: 1, low: 1, close: 1 },
        { time: 1700000000, open: 1, high: NaN, low: 1, close: 1 },
        { time: -1, open: 1, high: 1, low: 1, close: 1 },
        { time: 1700000000, open: 1 }, // partial
      ] as unknown as Bar[]),
    );
    const ok = await loadSymbolData('X', '1h', 'junk-src');
    expect(ok).toBe(false);
    expect(store.status).toBe('error');
    expect(store.statusMessage).toMatch(/no valid bars/i);
  });

  it('keeps valid bars when mix of partial and good OHLCV', async () => {
    registerDynamicSource(
      dynSource('mixed-src', async () => [
        { time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        { time: 1700000100, open: 1, high: NaN, low: 1, close: 1 },
        { time: 1_700_000_200_000, open: 2, high: 3, low: 1, close: 2.5 }, // ms
      ] as unknown as Bar[]),
    );
    const ok = await loadSymbolData('MIX', '1m', 'mixed-src');
    expect(ok).toBe(true);
    expect(store.bars).toHaveLength(2);
    expect(store.bars.every((b) => b.time < 1e12)).toBe(true);
    expect(store.status).toBe('ready');
  });

  it('clamps result to historyBars (Settings limit)', async () => {
    setStore('historyBars', HISTORY_BARS_MIN); // 50
    registerDynamicSource(
      dynSource('fat-src', async ({ config }) => {
        // Source ignores limit — loader must still clamp
        void config;
        return makeBars(200);
      }),
    );
    const ok = await loadSymbolData('BTCUSDT', '1d', 'fat-src');
    expect(ok).toBe(true);
    expect(store.bars.length).toBe(HISTORY_BARS_MIN);
    // Newest bars kept
    expect(store.bars[store.bars.length - 1]!.time).toBeGreaterThan(store.bars[0]!.time);
  });

  it('passes clamped limit into fetchHistorical config', async () => {
    setStore('historyBars', 999_999); // over max → clamp
    let seenLimit: unknown;
    registerDynamicSource(
      dynSource('limit-src', async ({ config }) => {
        seenLimit = config?.limit;
        return makeBars(3);
      }),
    );
    await loadSymbolData('BTCUSDT', '1d', 'limit-src');
    expect(seenLimit).toBe(clampHistoryBars(999_999));
    expect(seenLimit).toBeLessThanOrEqual(100_000);
  });

  it('ignores stale completion when symbol switches mid-load', async () => {
    let resolveSlow: (bars: Bar[]) => void = () => {};
    const slowPromise = new Promise<Bar[]>((r) => {
      resolveSlow = r;
    });

    registerDynamicSource(
      dynSource('race-src', async ({ symbol }) => {
        if (symbol === 'SLOW') return slowPromise;
        return makeBars(5, 1_800_000_000);
      }),
    );

    const pSlow = loadSymbolData('SLOW', '1h', 'race-src');
    // Second load starts before first resolves
    const pFast = loadSymbolData('FAST', '1h', 'race-src');
    const fastOk = await pFast;
    expect(fastOk).toBe(true);
    expect(store.symbol).toBe('FAST');
    expect(store.bars.length).toBe(5);
    expect(store.status).toBe('ready');

    // Stale slow load completes with different bars — must not clobber
    resolveSlow(makeBars(20, 1_700_000_000));
    const slowOk = await pSlow;
    expect(slowOk).toBe(false);
    expect(store.symbol).toBe('FAST');
    expect(store.bars.length).toBe(5);
    expect(store.status).toBe('ready');
    expect(store.statusMessage).not.toMatch(/Load failed/i);
  });

  it('stale failure does not overwrite newer success status', async () => {
    let rejectSlow: (e: Error) => void = () => {};
    const slowPromise = new Promise<Bar[]>((_, rej) => {
      rejectSlow = rej;
    });

    registerDynamicSource(
      dynSource('race-fail-src', async ({ symbol }) => {
        if (symbol === 'SLOW') return slowPromise;
        return makeBars(4);
      }),
    );

    const pSlow = loadSymbolData('SLOW', '1h', 'race-fail-src');
    const fastOk = await loadSymbolData('FAST', '1h', 'race-fail-src');
    expect(fastOk).toBe(true);
    expect(store.status).toBe('ready');

    rejectSlow(new Error('late network error'));
    const slowOk = await pSlow;
    expect(slowOk).toBe(false);
    // Newer load's success must remain
    expect(store.status).toBe('ready');
    expect(store.symbol).toBe('FAST');
    expect(store.telemetry.source.state).toBe('open');
  });

  it('rejects empty symbol', async () => {
    const ok = await loadSymbolData('   ', '1h', 'mock-walk');
    expect(ok).toBe(false);
    expect(store.status).toBe('error');
    expect(store.statusMessage).toMatch(/Symbol required/i);
  });
});
