// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Coverage stretch for data pure/early-return/sink branches:
 * - src/data/expand-cache.ts
 * - src/data/dataset-sinks.ts
 *
 * Does NOT modify sources; exercises uncovered lines via public API only.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

import {
  canExpandFromSource,
  expandCachedSeriesToNow,
  noteDataManagerLiveBar,
  _flushDataManagerLiveBarForTests,
} from '../src/data/expand-cache.ts';
import {
  sessionSink,
  localSink,
  remoteSink,
  sinkForMode,
  datasetKey,
  onSinkError,
  _resetDatasetSinksForTests,
  type PersistenceMode,
} from '../src/data/dataset-sinks.ts';
import {
  _resetBarsCacheForTests,
  putCachedBars,
  getCachedBars,
} from '../src/data/bars-cache.ts';
import {
  clearDataManagerSelection,
  setDataManagerSelection,
  DATA_MANAGER_SOURCE_ID,
} from '../src/data/data-manager-source.ts';
import {
  ensureSourcesRegistered,
  _resetSourceRegistrationFlag,
} from '../src/sources/catalog.ts';
import { registry } from '../src/plugins/registry.ts';
import { setActivePlugin, setStore, store } from '../src/store/index.ts';
import type { SourcePlugin } from '../src/plugins/types.ts';
import type { StoragePlugin } from '../src/plugins/types.ts';
import type { Bar } from '../src/store/types.ts';

function bar(t: number, c = 100): Bar {
  return { time: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1 };
}

// ── expand-cache ────────────────────────────────────────────────────────────

describe('expand-cache coverage', () => {
  beforeEach(async () => {
    await _resetBarsCacheForTests();
    clearDataManagerSelection();
    _resetSourceRegistrationFlag();
    ensureSourcesRegistered();
  });

  afterEach(() => {
    for (const id of [
      'cov-err',
      'cov-str',
      'cov-unknown-throw',
      'cov-offline',
      'cov-nofetch',
      'cov-near',
      'cov-near-empty',
      'cov-near-err',
      'cov-stall',
      'cov-oldpage',
    ]) {
      try {
        registry.unregisterSource(id);
      } catch {
        /* ignore */
      }
    }
    _flushDataManagerLiveBarForTests();
  });

  it('canExpandFromSource trims and rejects blanks / offline ids', () => {
    expect(canExpandFromSource('')).toBe(false);
    expect(canExpandFromSource('  ')).toBe(false);
    expect(canExpandFromSource('csv-upload')).toBe(false);
    expect(canExpandFromSource('binance-rest')).toBe(true);
  });

  it('returns empty without cache', async () => {
    const r = await expandCachedSeriesToNow('binance-rest', 'BTCUSDT', '1h');
    expect(r).toEqual({ bars: [], added: 0, expanded: false });
  });

  it('no-ops for offline sources with cached bars', async () => {
    await putCachedBars('csv-upload', 'BTCUSDT', '1h', [bar(1000), bar(4600)]);
    const r = await expandCachedSeriesToNow('csv-upload', 'BTCUSDT', '1h');
    expect(r.expanded).toBe(false);
    expect(r.bars.length).toBe(2);
  });

  it('no-ops for unknown sources with cached bars', async () => {
    await putCachedBars('cov-missing-src', 'BTCUSDT', '1h', [bar(1000), bar(4600)]);
    const r = await expandCachedSeriesToNow('cov-missing-src', 'BTCUSDT', '1h', {
      nowSec: 1_800_000_000,
    });
    expect(r.expanded).toBe(false);
    expect(r.bars.length).toBe(2);
  });

  // NOTE: registry._assertSource requires fetchHistorical, so a registered
  // source without it is unreachable; the !source?.fetchHistorical branch is
  // covered by the unknown-source test above. Kept skipped as documentation.
  it.skip('no-ops for sources without fetchHistorical', async () => {
    await putCachedBars('cov-nofetch', 'BTCUSDT', '1h', [bar(1000), bar(4600)]);
    registry.registerSource({
      id: 'cov-nofetch',
      name: 'No Fetch',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
    } as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-nofetch', 'BTCUSDT', '1h', {
      nowSec: 1_800_000_000,
    });
    expect(r.expanded).toBe(false);
  });

  it('no-ops for offline-capability sources', async () => {
    await putCachedBars('cov-offline', 'BTCUSDT', '1h', [bar(1000), bar(4600)]);
    registry.registerSource({
      id: 'cov-offline',
      name: 'Offline',
      kind: 'source',
      builtIn: false,
      capabilities: { offline: true },
      async fetchHistorical() {
        return [];
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-offline', 'BTCUSDT', '1h', {
      nowSec: 1_800_000_000,
    });
    expect(r.expanded).toBe(false);
  });

  it('near-now refresh merges the forming candle', async () => {
    const nowSec = 1_700_010_000;
    // Newest (nowSec-3700) is within 1.5 steps so the near-now path runs, and
    // the incoming bar (nowSec-100) sits in a newer bucket so it appends.
    await putCachedBars('cov-near', 'BTCUSDT', '1h', [bar(nowSec - 7200), bar(nowSec - 3700)]);
    registry.registerSource({
      id: 'cov-near',
      name: 'Near',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical() {
        return [bar(nowSec - 100, 777)];
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-near', 'BTCUSDT', '1h', { nowSec });
    expect(r.expanded).toBe(true);
    expect(r.bars[r.bars.length - 1]!.close).toBe(777);
  });

  it('near-now with empty refresh page does not expand', async () => {
    const nowSec = 1_700_010_000;
    await putCachedBars('cov-near-empty', 'BTCUSDT', '1h', [
      bar(nowSec - 3600),
      bar(nowSec - 100),
    ]);
    registry.registerSource({
      id: 'cov-near-empty',
      name: 'Near Empty',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical() {
        return [];
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-near-empty', 'BTCUSDT', '1h', {
      nowSec,
    });
    expect(r).toMatchObject({ added: 0, expanded: false });
  });

  it('near-now fetch errors surface Error / string / unknown messages', async () => {
    const nowSec = 1_700_010_000;
    const mk = (id: string, err: unknown) => {
      registry.registerSource({
        id,
        name: id,
        kind: 'source',
        builtIn: false,
        capabilities: { needsNetwork: true },
        async fetchHistorical(): Promise<Bar[]> {
          throw err;
        },
      } as unknown as SourcePlugin);
    };
    for (const [id, err, msg] of [
      ['cov-err', new Error('boom'), 'boom'],
      ['cov-str', 'oops-string', 'oops-string'],
      ['cov-unknown-throw', 42, 'Expand failed'],
    ] as const) {
      await putCachedBars(id, 'BTCUSDT', '1h', [bar(nowSec - 3600), bar(nowSec - 100)]);
      mk(id, err);
      const r = await expandCachedSeriesToNow(id, 'BTCUSDT', '1h', { nowSec });
      expect(r.expanded).toBe(false);
      expect(r.error).toBe(msg);
      try {
        registry.unregisterSource(id);
      } catch {
        /* ignore */
      }
    }
  });

  it('walk loop records fetch errors far from now', async () => {
    const t0 = 1_700_000_000;
    await putCachedBars('cov-err', 'BTCUSDT', '1h', [bar(t0), bar(t0 + 3600)]);
    registry.registerSource({
      id: 'cov-err',
      name: 'Walk Err',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical(): Promise<Bar[]> {
        throw new Error('walk-boom');
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-err', 'BTCUSDT', '1h', {
      nowSec: t0 + 3600 * 50,
    });
    // Walk attempted one page (expanded) and surfaced the fetch error.
    expect(r.expanded).toBe(true);
    expect(r.error).toBe('walk-boom');
  });

  it('walk loop breaks on stalled cursors', async () => {
    const t0 = 1_700_000_000;
    await putCachedBars('cov-stall', 'BTCUSDT', '1h', [bar(t0), bar(t0 + 3600)]);
    let calls = 0;
    registry.registerSource({
      id: 'cov-stall',
      name: 'Stall',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical({ endTime }: { endTime?: number }) {
        calls += 1;
        const end = Math.floor(Number(endTime) || 0);
        // Same old page regardless of cursor: newest overlap never reached,
        // cursor never advances → stall break.
        return [bar(end - 7200, 1), bar(end - 3600, 2)];
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-stall', 'BTCUSDT', '1h', {
      nowSec: t0 + 3600 * 50,
    });
    expect(calls).toBeGreaterThan(1);
    expect(r.expanded).toBe(true);
  });

  it('walk loop skips pages fully older than the cache', async () => {
    const t0 = 1_700_000_000;
    await putCachedBars('cov-oldpage', 'BTCUSDT', '1h', [bar(t0), bar(t0 + 3600)]);
    registry.registerSource({
      id: 'cov-oldpage',
      name: 'Old Page',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical() {
        // Entirely older than cache newest but overlapping within one step → done.
        return [bar(t0 - 7200, 1), bar(t0 + 100, 2)];
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-oldpage', 'BTCUSDT', '1h', {
      nowSec: t0 + 3600 * 50,
    });
    expect(r.expanded).toBe(true);
  });

  it('honors an already-aborted caller signal', async () => {
    const t0 = 1_700_000_000;
    await putCachedBars('cov-near', 'BTCUSDT', '1h', [bar(t0), bar(t0 + 3600)]);
    registry.registerSource({
      id: 'cov-near',
      name: 'Near',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical() {
        return [bar(t0 + 7200, 9)];
      },
    } as unknown as SourcePlugin);
    const ac = new AbortController();
    ac.abort();
    const r = await expandCachedSeriesToNow('cov-near', 'BTCUSDT', '1h', {
      nowSec: t0 + 3600 * 50,
      signal: ac.signal,
    });
    expect(r.bars.length).toBeGreaterThanOrEqual(2);
  });

  it('uses budgetMs and default nowSec', async () => {
    const t0 = Math.floor(Date.now() / 1000) - 3600 * 2;
    await putCachedBars('cov-near', 'BTCUSDT', '1h', [bar(t0 - 3600), bar(t0)]);
    registry.registerSource({
      id: 'cov-near',
      name: 'Near',
      kind: 'source',
      builtIn: false,
      capabilities: { needsNetwork: true },
      async fetchHistorical() {
        return [];
      },
    } as unknown as SourcePlugin);
    const r = await expandCachedSeriesToNow('cov-near', 'BTCUSDT', '1h', {
      budgetMs: 5000,
    });
    // Empty first page still counts as an attempted expand (pages > 0).
    expect(r.expanded).toBe(true);
  });
});

describe('noteDataManagerLiveBar coverage', () => {
  const prevSource = store.source;

  beforeEach(async () => {
    await _resetBarsCacheForTests();
    _flushDataManagerLiveBarForTests();
    clearDataManagerSelection();
  });

  afterEach(() => {
    _flushDataManagerLiveBarForTests();
    clearDataManagerSelection();
    setStore('source', prevSource);
  });

  it('ignores invalid bars', () => {
    setStore('source', DATA_MANAGER_SOURCE_ID);
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    expect(() => noteDataManagerLiveBar(null as never)).not.toThrow();
    expect(() => noteDataManagerLiveBar({ time: NaN } as never)).not.toThrow();
  });

  it('no-ops when chart source is not Data Manager', () => {
    setStore('source', 'binance-rest');
    setActivePlugin('source', 'binance-rest');
    setDataManagerSelection('binance-rest', 'BTCUSDT', '1h');
    expect(() => noteDataManagerLiveBar(bar(1000))).not.toThrow();
  });

  it('no-ops without a selection', () => {
    setStore('source', DATA_MANAGER_SOURCE_ID);
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    clearDataManagerSelection();
    expect(() => noteDataManagerLiveBar(bar(1000))).not.toThrow();
  });

  it('no-ops for csv-upload selections', () => {
    setStore('source', DATA_MANAGER_SOURCE_ID);
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    setDataManagerSelection('csv-upload', 'BTCUSDT', '1h');
    expect(() => noteDataManagerLiveBar({ ...bar(1000), closed: true })).not.toThrow();
  });

  it('coalesces open-bar ticks and flushes closed bars promptly', async () => {
    await putCachedBars('binance-rest', 'ETHUSDT', '1m', [bar(1000), bar(1060)]);
    setDataManagerSelection('binance-rest', 'ETHUSDT', '1m');
    setStore('source', DATA_MANAGER_SOURCE_ID);
    setActivePlugin('source', DATA_MANAGER_SOURCE_ID);
    // open-bar tick schedules a debounced write…
    noteDataManagerLiveBar(bar(1120, 10));
    // …second open tick coalesces (already scheduled)…
    noteDataManagerLiveBar(bar(1120, 11));
    // …closed bar for the same key flushes promptly instead.
    noteDataManagerLiveBar({ ...bar(1120, 12), closed: true });
    await new Promise((r) => setTimeout(r, 40));
    const cached = await getCachedBars('binance-rest', 'ETHUSDT', '1m');
    expect(cached.map((b) => b.time)).toContain(1120);
    expect(cached[cached.length - 1]!.close).toBe(12);
  });
});

// ── dataset-sinks ───────────────────────────────────────────────────────────

describe('dataset-sinks coverage', () => {
  let origGit: StoragePlugin | undefined;
  let origCloud: StoragePlugin | undefined;

  beforeEach(async () => {
    _resetDatasetSinksForTests();
    await _resetBarsCacheForTests();
    onSinkError(null);
    origGit = registry.getStorage('git');
    origCloud = registry.getStorage('cloud');
  });

  afterEach(() => {
    _resetDatasetSinksForTests();
    onSinkError(null);
    if (origGit) registry.registerStorage(origGit);
    if (origCloud) registry.registerStorage(origCloud);
  });

  function stubStorage(
    id: 'git' | 'cloud',
    impl: Partial<Pick<StoragePlugin, 'list' | 'read' | 'write' | 'remove'>> & {
      writes?: Bar[][];
      docs?: Map<string, { content: string }>;
    } = {},
  ): { writes: { doc: unknown }[]; docs: Map<string, { content: string }> } {
    const writes: { doc: unknown }[] = [];
    const docs = impl.docs ?? new Map<string, { content: string }>();
    registry.registerStorage({
      id,
      name: `${id} stub`,
      kind: 'storage',
      builtIn: false,
      async list() {
        return [];
      },
      async read(docId: string) {
        const d = docs.get(docId);
        if (!d) return null as never;
        return { id: docId, content: d.content } as never;
      },
      async write(doc: { content: string; id: string }) {
        writes.push({ doc });
        docs.set(doc.id, { content: doc.content });
        return { id: doc.id } as never;
      },
      async remove(docId: string) {
        docs.delete(docId);
      },
      ...impl,
    } as unknown as StoragePlugin);
    return { writes, docs };
  }

  it('session sink merges, dedupes, replaces and removes', async () => {
    const key = 's|BTC|1h';
    expect(await sessionSink.get(key)).toBeNull();
    await sessionSink.put(key, [bar(3000, 3), bar(1000, 1)]);
    await sessionSink.put(key, [bar(2000, 2), bar(3000, 33), { time: NaN } as never, null as never]);
    expect((await sessionSink.get(key))!.map((b) => b.time)).toEqual([1000, 2000, 3000]);
    expect((await sessionSink.get(key))!.find((b) => b.time === 3000)!.close).toBe(33);
    await sessionSink.replace(key, [bar(5000, 5)]);
    expect((await sessionSink.get(key))!.map((b) => b.time)).toEqual([5000]);
    await sessionSink.remove(key);
    expect(await sessionSink.get(key)).toBeNull();
  });

  it('local sink handles empty keys and empty caches', async () => {
    expect(await localSink.get('')).toBeNull();
    expect(await localSink.put('', [bar(1)])).toBe(0);
    await localSink.replace('', [bar(1)]);
    await localSink.remove('');
    expect(await localSink.get('x|BTC|1h')).toBeNull();
    const n = await localSink.put('x|BTC|1h', [bar(1000, 1)]);
    expect(n).toBe(1);
    await localSink.replace('x|BTC|1h', [bar(2000, 2)]);
    expect((await localSink.get('x|BTC|1h'))!.map((b) => b.time)).toEqual([2000]);
    await localSink.remove('x|BTC|1h');
    expect(await localSink.get('x|BTC|1h')).toBeNull();
  });

  it('sinkForMode resolves every mode and datasetKey builds canonical keys', () => {
    expect(sinkForMode('session').mode).toBe('session');
    expect(sinkForMode('local').mode).toBe('local');
    expect(sinkForMode('git').mode).toBe('git');
    expect(sinkForMode('worker').mode).toBe('worker');
    expect(sinkForMode('bogus' as PersistenceMode).mode).toBe('local');
    expect(datasetKey('binance-rest', 'BTCUSDT', '1h')).toBe('binance-rest|BTCUSDT|1h');
  });

  it('remote replace flushes through the storage plugin', async () => {
    const { writes } = stubStorage('git');
    const sink = remoteSink('git');
    const key = 'binance-rest|BTCUSDT|1d';
    await sink.replace(key, [bar(60, 1), bar(120, 2)]);
    expect(writes.length).toBe(1);
    // get merges remote content
    const got = await sink.get(key);
    expect(got!.map((b) => b.time)).toEqual([60, 120]);
  });

  it('remote put buffers and get returns pending before flush', async () => {
    stubStorage('git');
    const sink = remoteSink('git');
    const key = 'binance-rest|ETHUSDT|1d';
    await sink.put(key, [bar(60, 1)]);
    await sink.put(key, [bar(120, 2)]);
    const got = await sink.get(key);
    expect(got!.map((b) => b.time)).toEqual([60, 120]);
  });

  it('remote get falls back to local when plugin is missing content', async () => {
    stubStorage('cloud');
    const sink = remoteSink('worker');
    const key = 'binance-rest|SOLUSDT|1d';
    await localSink.put(key, [bar(10, 1)]);
    const got = await sink.get(key);
    expect(got!.map((b) => b.time)).toEqual([10]);
  });

  it('remote get survives read failures with pending and local fallbacks', async () => {
    stubStorage('git', {
      async read() {
        throw new Error('read-boom');
      },
    });
    const sink = remoteSink('git');
    const key = 'binance-rest|AVAXUSDT|1d';
    await sink.put(key, [bar(60, 1)]);
    expect((await sink.get(key))!.map((b) => b.time)).toEqual([60]);
    _resetDatasetSinksForTests();
    await localSink.put(key, [bar(70, 7)]);
    // Pending write [60] survives the reset; remote read throws so local [70]
    // merges in — get returns the union via fallbacks.
    expect((await sink.get(key))!.map((b) => b.time)).toEqual([60, 70]);
  });

  it('remote replace retries once on write failure without throwing', async () => {
    const errors: unknown[] = [];
    onSinkError((_mode, _key, err) => {
      errors.push(err);
    });
    stubStorage('git', {
      async write() {
        throw new Error('write-boom');
      },
    });
    const sink = remoteSink('git');
    await sink.replace('binance-rest|BTCUSDT|1d', [bar(60, 1)]);
    // first failure only schedules a retry (cap 3) — no sink error yet, no throw
    expect(errors).toEqual([]);
  });

  it('remote remove deletes pending + remote and reports failures', async () => {
    const seen: { mode: PersistenceMode; key: string }[] = [];
    onSinkError((mode, key) => {
      seen.push({ mode, key });
      throw new Error('listener-boom');
    });
    stubStorage('git', {
      async remove() {
        throw new Error('remove-boom');
      },
    });
    const sink = remoteSink('git');
    const key = 'binance-rest|BTCUSDT|1d';
    await sink.put(key, [bar(60, 1)]);
    await sink.remove(key);
    // throwing listener is swallowed; failure still reported via warn path
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ mode: 'git', key });
    expect(await sink.get(key)).toBeNull();
  });

  it('remote remove succeeds when the plugin removes cleanly', async () => {
    const removed: string[] = [];
    stubStorage('git', {
      async remove(id: string) {
        removed.push(id);
      },
    });
    const sink = remoteSink('git');
    const key = 'binance-rest|BTCUSDT|1d';
    await sink.put(key, [bar(60, 1)]);
    await sink.remove(key);
    expect(removed).toEqual(['datasets/binance-rest__BTCUSDT__1d']);
  });

  it('concurrent put during flush reschedules the push', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    stubStorage('git', {
      async write(doc: { content: string; id: string }) {
        await gate;
        return { id: doc.id } as never;
      },
    });
    const sink = remoteSink('git');
    const key = 'binance-rest|BTCUSDT|1d';
    const pending = sink.replace(key, [bar(60, 1)]);
    await Promise.resolve();
    await sink.put(key, [bar(120, 2)]);
    release();
    await pending;
    // gen changed mid-flush → pending kept for the debounced retry
    const got = await sink.get(key);
    expect(got!.map((b) => b.time)).toEqual([60, 120]);
  });
});
