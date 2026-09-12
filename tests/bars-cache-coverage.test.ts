// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Extra coverage for `src/data/bars-cache.ts`.
 *
 * Covers the unsorted `mergeBars` fallback, `capNewest` trimming,
 * in-memory series eviction, and — via a minimal in-memory `indexedDB`
 * fake that satisfies the real `src/storage/idb.ts` helpers — every
 * IndexedDB-backed path (batched flush, cold reads, metadata listing,
 * record reads, deletes, resets, and open/transaction failures).
 *
 * Does not touch `src/`; uses `bun:test` like the existing suite.
 */

import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import {
  barsCacheKey,
  mergeBars,
  mergeAndCap,
  getCachedBars,
  getCachedBarCount,
  getCachedRange,
  putCachedBars,
  clearCachedBars,
  listCachedSeries,
  getCachedRecord,
  flushPendingIdbPuts,
  _resetBarsCacheForTests,
  BARS_CACHE_MAX_SERIES,
} from '../src/data/bars-cache';
import type { Bar } from '../src/store/types';

function bar(t: number, c = 100): Bar {
  return { time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
}

// ── Minimal in-memory IndexedDB fake ─────────────────────────────────────
// Implements just enough of the IDB protocol for the real idb.ts helpers:
// `indexedDB.open()` → open request, store requests with `onsuccess`, and
// transactions with `oncomplete`. Backed by a plain Map so tests can seed
// and inspect raw records.

type Cb = (ev?: unknown) => void;
interface FakeReq {
  result: unknown;
  error: unknown;
  onsuccess: Cb | null;
  onerror: Cb | null;
  onupgradeneeded: Cb | null;
}

const fakeBacking = new Map<string, Record<string, unknown>>();
let failOpen = false;
let failTx = false;

function fireReq(req: FakeReq, ok: boolean): void {
  queueMicrotask(() => {
    if (ok) req.onsuccess?.({ target: req });
    else req.onerror?.({ target: req });
  });
}

function fakeStoreReq(result: unknown): FakeReq {
  const req: FakeReq = {
    result,
    error: failTx ? new Error('tx fail') : null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  fireReq(req, !failTx);
  return req;
}

function fakeObjectStore() {
  return {
    put(rec: Record<string, unknown>) {
      if (!failTx) fakeBacking.set(rec.key as string, rec);
      return fakeStoreReq(undefined);
    },
    get(key: string) {
      return fakeStoreReq(failTx ? undefined : fakeBacking.get(key));
    },
    getAll() {
      return fakeStoreReq(failTx ? undefined : [...fakeBacking.values()]);
    },
    delete(key: string) {
      if (!failTx) fakeBacking.delete(key);
      return fakeStoreReq(undefined);
    },
    clear() {
      if (!failTx) fakeBacking.clear();
      return fakeStoreReq(undefined);
    },
  };
}

function fakeTx() {
  const tx = {
    error: null as unknown,
    oncomplete: null as Cb | null,
    onerror: null as Cb | null,
    onabort: null as Cb | null,
    objectStore: (_name: string) => fakeObjectStore(),
  };
  // Complete on a macrotask (after store-request microtasks) so
  // `await idbReq(...)` resolves before `idbTxDone(tx)` handlers are set.
  // Firing completion in a microtask would run before the awaiting code
  // attaches `oncomplete` and hang forever.
  setTimeout(() => {
    if (failTx) {
      tx.error = new Error('tx fail');
      tx.onerror?.({});
      tx.onabort?.({});
    } else {
      tx.oncomplete?.({});
    }
  }, 1);
  return tx;
}

function fakeDb() {
  return {
    // Report "no store yet" so the onUpgrade createObjectStore branch runs.
    objectStoreNames: { contains: (_name: string) => false },
    createObjectStore: (_name: string, _opts?: unknown) => ({}),
    close: () => {},
    transaction: (_store: string, _mode?: string) => fakeTx(),
  };
}

function installFakeIndexedDb(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.indexedDB = {
    open: (_name: string, _version: number) => {
      const req: FakeReq = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (failOpen) {
          req.error = new Error('open fail');
          req.onerror?.({ target: req });
          return;
        }
        req.result = fakeDb();
        try {
          req.onupgradeneeded?.({ target: req, oldVersion: 0 });
        } catch {
          /* upgrade callback errors surface via onerror below */
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

const hadIndexedDb = 'indexedDB' in globalThis;
const savedIndexedDb = (globalThis as unknown as Record<string, unknown>).indexedDB;

function seedIdb(rec: {
  key: string;
  sourceId: string;
  symbol: string;
  interval: string;
  bars: Bar[];
  updatedAt: number;
}): void {
  fakeBacking.set(rec.key, rec as unknown as Record<string, unknown>);
}

function seedBars(
  sourceId: string,
  symbol: string,
  interval: string,
  times: number[],
): string {
  const key = barsCacheKey(sourceId, symbol, interval);
  seedIdb({
    key,
    sourceId,
    symbol: symbol.toUpperCase(),
    interval,
    bars: times.map((t) => bar(t)),
    updatedAt: Date.now(),
  });
  return key;
}

describe('bars-cache coverage', () => {
  beforeEach(async () => {
    failOpen = false;
    failTx = false;
    installFakeIndexedDb();
    fakeBacking.clear();
    await _resetBarsCacheForTests();
    // _reset with fake IDB clears the backing store; re-install afterwards
    // is unnecessary since _reset only clears, never removes the global.
    installFakeIndexedDb();
    fakeBacking.clear();
  });

  afterAll(async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    if (hadIndexedDb) g.indexedDB = savedIndexedDb;
    else delete g.indexedDB;
    failOpen = false;
    failTx = false;
    await _resetBarsCacheForTests();
  });

  it('mergeBars falls back to Map merge for unsorted inputs and skips junk', () => {
    // `a` unsorted → short-circuits the sorted fast paths.
    const a = [bar(3, 30), bar(1, 10), null, { time: Number.NaN }] as unknown as Bar[];
    const b = [bar(2, 20), bar(3, 99)] as Bar[];
    const m = mergeBars(a, b);
    expect(m.map((x) => x.time)).toEqual([1, 2, 3]);
    expect(m[2]!.close).toBe(99);

    // `a` sorted but `b` unsorted → still Map path, last-write wins.
    const c = mergeBars([bar(1, 1), bar(2, 2)], [bar(4, 4), bar(3, 3), bar(2, 22)]);
    expect(c.map((x) => x.time)).toEqual([1, 2, 3, 4]);
    expect(c[1]!.close).toBe(22);
  });

  it('mergeAndCap trims via capNewest and handles mid inserts / empty cleans', () => {
    // Empty incoming with a tight cap → capNewest slice (keep newest).
    expect(
      mergeAndCap([bar(1), bar(2), bar(3)], [], 2).map((b) => b.time),
    ).toEqual([2, 3]);

    // Single mid-series tick falls through to the full merge.
    expect(
      mergeAndCap([bar(1), bar(2), bar(4)], [bar(3)], 100).map((b) => b.time),
    ).toEqual([1, 2, 3, 4]);

    // All-invalid incoming → cleaned empty → base capped copy.
    const junk = [{ time: Number.NaN, open: 1, high: 1, low: 1, close: 1 }] as unknown as Bar[];
    expect(mergeAndCap([bar(1), bar(2), bar(3)], junk, 2).map((b) => b.time)).toEqual([
      2, 3,
    ]);
    expect(mergeAndCap([], junk)).toEqual([]);
  });

  it('evicts oldest series past BARS_CACHE_MAX_SERIES', async () => {
    const total = BARS_CACHE_MAX_SERIES + 8;
    for (let i = 0; i < total; i++) {
      await putCachedBars('evict-src', `SYM${i}`, '1h', [bar(100 + i)]);
    }
    await flushPendingIdbPuts();
    // Everything remains readable (IDB fallback) even after memory trim.
    expect(await getCachedBarCount('evict-src', 'SYM0', '1h')).toBe(1);
    expect(await getCachedBarCount('evict-src', `SYM${total - 1}`, '1h')).toBe(1);
    const list = await listCachedSeries();
    expect(list.length).toBeGreaterThanOrEqual(total);
  });

  it('persists batched puts and serves cold reads from IDB', async () => {
    await putCachedBars('cold-src', 'AAA', '1h', [bar(10), bar(20)]);
    await flushPendingIdbPuts();

    // Force a cold read: evict memory via over-cap inserts, keep IDB warm.
    for (let i = 0; i < BARS_CACHE_MAX_SERIES + 2; i++) {
      await putCachedBars('cold-src', `FILL${i}`, '1h', [bar(i)]);
    }
    const cold = await getCachedBars('cold-src', 'AAA', '1h');
    expect(cold.map((b) => b.time)).toEqual([10, 20]);
    // Second read is warm-memory served.
    expect((await getCachedBars('cold-src', 'AAA', '1h')).map((b) => b.time)).toEqual([
      10, 20,
    ]);
  });

  it('cold get merges IDB base with new puts', async () => {
    seedBars('merge-src', 'BBB', '1h', [10, 20]);
    const merged = await putCachedBars('merge-src', 'BBB', '1h', [bar(30)]);
    expect(merged.map((b) => b.time)).toEqual([10, 20, 30]);
  });

  it('cold miss returns empty bars / count 0 / null range', async () => {
    expect(await getCachedBars('no-src', 'MISSING', '1h')).toEqual([]);
    expect(await getCachedBarCount('no-src', 'MISSING', '1h')).toBe(0);
    expect(await getCachedRange('no-src', 'MISSING', '1h')).toBeNull();
  });

  it('cold range and count read through IDB', async () => {
    // Range first on a cold key: hydrate has not warmed memory yet, so the
    // cold `getCachedBars` fallback below the warm check is exercised.
    seedBars('range-src', 'CCC', '1d', [5, 15, 25]);
    expect(await getCachedRange('range-src', 'CCC', '1d')).toEqual({
      count: 3,
      oldestSec: 5,
      newestSec: 25,
    });
    seedBars('range-src', 'CCD', '1d', [6, 16]);
    expect(await getCachedBarCount('range-src', 'CCD', '1d')).toBe(2);
  });

  it('scheduleIdbPut debounce timer auto-flushes', async () => {
    await putCachedBars('deb-src', 'DDD', '1h', [bar(42)]);
    // No manual flush — the 120ms debounce should persist to IDB.
    await new Promise((r) => setTimeout(r, 250));
    // Evict from memory, then confirm IDB has the record.
    for (let i = 0; i < BARS_CACHE_MAX_SERIES + 2; i++) {
      await putCachedBars('deb-src', `Q${i}`, '1h', [bar(i)]);
    }
    await flushPendingIdbPuts();
    expect((await getCachedBars('deb-src', 'DDD', '1h')).map((b) => b.time)).toEqual([
      42,
    ]);
  });

  it('listCachedSeries merges memory + IDB, skips keyless rows, prefers fresher', async () => {
    // Stale IDB row for a key that memory will hold fresher.
    seedBars('list-src', 'EEE', '1h', [1]);
    await putCachedBars('list-src', 'EEE', '1h', [bar(1), bar(2)]);
    // Keyless junk row in IDB is ignored.
    fakeBacking.set('junk', { updatedAt: 1 } as unknown as Record<string, unknown>);
    // Fresher IDB-only row (seeded directly) wins over nothing in memory.
    seedBars('list-src', 'FFF', '1h', [7]);
    await flushPendingIdbPuts();

    const list = await listCachedSeries();
    const eee = list.find((r) => r.symbol === 'EEE');
    expect(eee?.count).toBe(2);
    expect(eee?.newestSec).toBe(2);
    expect(list.find((r) => r.symbol === 'FFF')?.count).toBe(1);
    expect(list.find((r) => r.key === 'junk')).toBeUndefined();
    // Newest-updated first.
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.updatedAt).toBeGreaterThanOrEqual(list[i]!.updatedAt);
    }
  });

  it('getCachedRecord covers memory, IDB, miss, and empty-memory fallback', async () => {
    await putCachedBars('rec-src', 'GGG', '1h', [bar(11), bar(22)]);
    expect((await getCachedRecord('rec-src', 'GGG', '1h'))?.bars.map((b) => b.time)).toEqual([
      11, 22,
    ]);

    seedBars('rec-src', 'HHH', '1h', [33]);
    // Evict memory so HHH reads cold from IDB.
    for (let i = 0; i < BARS_CACHE_MAX_SERIES + 2; i++) {
      await putCachedBars('rec-src', `Z${i}`, '1h', [bar(i)]);
    }
    await flushPendingIdbPuts();
    expect((await getCachedRecord('rec-src', 'HHH', '1h'))?.bars.map((b) => b.time)).toEqual([
      33,
    ]);

    expect(await getCachedRecord('rec-src', 'NOPE', '1h')).toBeNull();

    // Memory entry with empty bars + IDB miss → empty record (not null).
    await putCachedBars('rec-src', 'EMPTY', '1h', []);
    const empty = await getCachedRecord('rec-src', 'EMPTY', '1h');
    expect(empty?.bars).toEqual([]);
  });

  it('clearCachedBars removes memory and IDB rows', async () => {
    await putCachedBars('clr-src', 'III', '1h', [bar(9)]);
    await flushPendingIdbPuts();
    await clearCachedBars('clr-src', 'III', '1h');
    expect(await getCachedBars('clr-src', 'III', '1h')).toEqual([]);
    expect(await getCachedRecord('clr-src', 'III', '1h')).toBeNull();
  });

  it('_resetBarsCacheForTests clears pending timers, memory, and IDB', async () => {
    await putCachedBars('rst-src', 'JJJ', '1h', [bar(1)]);
    // Leave the debounce timer pending, then reset (clears timer + IDB).
    await _resetBarsCacheForTests();
    expect(await getCachedBars('rst-src', 'JJJ', '1h')).toEqual([]);
    expect(await listCachedSeries()).toEqual([]);
  });

  it('flush failure keeps memory usable (openSharedBarsDb catch)', async () => {
    await putCachedBars('fail-src', 'KKK', '1h', [bar(5)]);
    failOpen = true;
    await flushPendingIdbPuts(); // open fails → warn + keep memory
    failOpen = false;
    expect((await getCachedBars('fail-src', 'KKK', '1h')).map((b) => b.time)).toEqual([5]);
  });

  it('IDB open failure falls back to memory / empty on reads', async () => {
    await putCachedBars('fb-src', 'LLL', '1h', [bar(8)]);
    await flushPendingIdbPuts();
    failOpen = true;
    // Warm memory still served despite IDB outage.
    expect((await getCachedBars('fb-src', 'LLL', '1h')).map((b) => b.time)).toEqual([8]);
    // Cold miss with IDB down → empty, null record/range.
    expect(await getCachedBars('fb-src', 'ZZZ', '1h')).toEqual([]);
    expect(await getCachedRecord('fb-src', 'ZZZ', '1h')).toBeNull();
    expect(await getCachedRange('fb-src', 'ZZZ', '1h')).toBeNull();
    expect(await listCachedSeries()).toHaveLength(1);
    await clearCachedBars('fb-src', 'LLL', '1h'); // IDB delete ignored, memory cleared
    expect(await getCachedBars('fb-src', 'LLL', '1h')).toEqual([]);
    failOpen = false;
  });

  it('transaction failure degrades to memory-only', async () => {
    await putCachedBars('tx-src', 'MMM', '1h', [bar(3)]);
    await flushPendingIdbPuts();
    failTx = true;
    await flushPendingIdbPuts(); // no pending → early return, still fine
    expect((await getCachedBars('tx-src', 'MMM', '1h')).map((b) => b.time)).toEqual([3]);
    // Cold read with failing tx → empty fallback.
    expect(await getCachedBars('tx-src', 'QQQ', '1h')).toEqual([]);
    expect((await listCachedSeries()).find((r) => r.symbol === 'MMM')).toBeDefined();
    expect(await getCachedRecord('tx-src', 'QQQ', '1h')).toBeNull();
    failTx = false;
  });
});
