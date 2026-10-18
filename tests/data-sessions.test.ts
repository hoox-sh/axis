/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine-owned data sessions: capability parsing, the cache-miss broker
 * (local upload → engine fetch), identity-only ticks, session memo, and the
 * guarantee that the engine-owned run path never ships bars.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import {
  canonicalSeriesKey,
  seriesKeyString,
  provideDataSeries,
  createDataSession,
  tickDataSession,
  ensureDataSession,
  runDataSession,
  seriesIsStale,
  repairStaleEngineSeries,
  _resetDataSessionMemo,
  _resetSeriesProvisionMemoForTests,
  _resetSeriesRepairCooldownForTests,
  _getSeriesProvisionForTests,
  _resetDataSessionCooldownForTests,
  DATA_PROVIDE_CHUNK,
} from '../src/engines/data-sessions';
import {
  capabilitiesFromHealth,
  serverEngine,
  DEFAULT_ENGINE_CAPABILITIES,
} from '../src/engines/catalog';
import { putDatasetBars, _resetDatasetStoreForTests } from '../src/data/dataset-store';
import { _resetDatasetSinksForTests } from '../src/data/dataset-sinks';
import { _resetBarsCacheForTests } from '../src/data/bars-cache';
import { setStore } from '../src/store';
import type { Bar } from '../src/store/types';

const ENDPOINT = 'http://pro.test';
const KEY = { exchange: 'Binance', symbol: 'btc/usdt', interval: '1h' };
/** Broker input shape: `key` identity + `historyBars`. */
const REQ = { key: KEY, historyBars: 3 };

function bar(time: number): Bar {
  return { time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
}

/** Step of the freshness-aware fixtures (1h — matches `KEY.interval`). */
const HOUR = 3600;

/**
 * `count` bars ending at the current 1h slot.
 *
 * The provisioning gate treats a deep-but-frozen local tail as stale and tops
 * it up from the engine's own feed (`/data/series/fetch`), so any fixture that
 * means "a live local window" must end near now — ancient times would exercise
 * the staleness path instead of the cache-miss/upload path under test.
 */
function freshBars(count: number): Bar[] {
  const last = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
  return Array.from({ length: count }, (_, i) => bar(last - (count - 1 - i) * HOUR));
}

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

/** Record every request; answer with `respond`. */
function recorder(
  respond: (call: Call) => Response | Promise<Response>,
): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const restore = mockFetch(async (input, init) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: `${url.pathname}${url.search}`,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
    };
    calls.push(call);
    return respond(call);
  });
  return { calls, restore };
}

let restore: (() => void) | null = null;

/** First recorded call matching `pred`; fails the test with a clear message if absent. */
function must(calls: Call[], pred: (c: Call) => boolean): Call {
  const c = calls.find(pred);
  if (!c) throw new Error('expected request was not made');
  return c;
}

/** `bars` array from a provide/ticker-style request body. */
function bodyBars(c: Call): Array<Record<string, unknown>> {
  const bars = c.body?.bars;
  return Array.isArray(bars) ? (bars as Array<Record<string, unknown>>) : [];
}

beforeEach(() => {
  _resetDataSessionMemo();
  _resetSeriesProvisionMemoForTests();
  _resetDataSessionCooldownForTests();
});

afterEach(() => {
  restore?.();
  restore = null;
});

describe('capabilitiesFromHealth', () => {
  it('advertises every-tick + bar-close for a data-session engine', () => {
    const caps = capabilitiesFromHealth({
      features: { live_modes: ['every-tick', 'bar-close'], data_session: true, data_exchanges: ['binance'] },
    });
    expect(caps.liveModes).toEqual(['every-tick', 'bar-close']);
    expect(caps.ownsData).toBe(true);
    expect(caps.dataSession).toBe(true);
    expect(caps.dataExchanges).toEqual(['binance']);
  });

  it('drops every-tick unless the engine owns the data', () => {
    const caps = capabilitiesFromHealth({
      features: { live_modes: ['every-tick', 'bar-close'] },
    });
    expect(caps.liveModes).toEqual(['bar-close']);
    expect(caps.ownsData).toBe(false);
  });

  it('falls back to bar-close for a health body without features (pyne-worker, Pyodide)', () => {
    expect(capabilitiesFromHealth({ status: 'ok', worker: 'pyne-worker' })).toEqual(
      DEFAULT_ENGINE_CAPABILITIES,
    );
    expect(capabilitiesFromHealth(null).liveModes).toEqual(['bar-close']);
  });

  it('ignores unknown live modes and never infers from the service name', () => {
    const caps = capabilitiesFromHealth({
      service: 'pynescript-pro-api',
      features: { live_modes: ['tick-storm', 42], data_session: 'yes' },
    });
    expect(caps.liveModes).toEqual(['bar-close']);
    expect(caps.ownsData).toBe(false);
  });
});

describe('canonicalSeriesKey', () => {
  it('normalizes venue, market, symbol and defaults market to spot', () => {
    expect(canonicalSeriesKey(KEY)).toEqual({
      exchange: 'binance',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1h',
    });
    expect(seriesKeyString({ ...KEY, market: 'Swap' })).toBe('binance|swap|BTC/USDT|1h');
  });

  it('maps compact load-form majors to pair-form', () => {
    expect(canonicalSeriesKey({ exchange: 'binance', symbol: 'BNBUSDT', interval: '1m' })).toEqual({
      exchange: 'binance',
      market: 'spot',
      symbol: 'BNB/USDT',
      interval: '1m',
    });
    expect(seriesKeyString({ exchange: 'Binance', symbol: 'btcusdt', interval: '1m' })).toBe(
      'binance|spot|BTC/USDT|1m',
    );
  });
});

describe('createDataSession', () => {
  it('returns the session id on a hit', async () => {
    const rec = recorder(() => jsonResponse({ status: 'success', session_id: 'ses1', cache: 'hit' }));
    restore = rec.restore;
    const r = await createDataSession(ENDPOINT, '', { key: KEY, historyBars: 3, script: 's' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sessionId).toBe('ses1');
    const [first] = rec.calls;
    expect(first?.path).toBe('/data/session');
    expect(first?.body).toMatchObject({ exchange: 'binance', symbol: 'BTC/USDT', history_bars: 3 });
    expect(first?.body).not.toHaveProperty('data');
  });

  it('maps 409 DATA_MISS to a structured miss', async () => {
    restore = recorder(() =>
      jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'binance|spot|BTC/USDT|1h', have: 1, need: 3 }, 409),
    ).restore;
    const r = await createDataSession(ENDPOINT, '', { key: KEY, historyBars: 3, script: 's' });
    expect(r).toEqual({ ok: false, miss: { key: 'binance|spot|BTC/USDT|1h', have: 1, need: 3 } });
  });

  it('surfaces other failures as errors', async () => {
    restore = recorder(() => jsonResponse({ status: 'error', message: 'bad pine' }, 400)).restore;
    const r = await createDataSession(ENDPOINT, '', { key: KEY, historyBars: 3, script: 's' });
    expect(r).toEqual({ ok: false, error: 'bad pine' });
  });

  it('binds pair-form even when the key and input.symbol are compact load-form', async () => {
    const rec = recorder(() => jsonResponse({ status: 'success', session_id: 'ses-bnb', cache: 'hit' }));
    restore = rec.restore;
    const r = await createDataSession(ENDPOINT, '', {
      key: { exchange: 'binance', symbol: 'BNBUSDT', interval: '1m' },
      historyBars: 3,
      script: 's',
      symbol: 'BNBUSDT',
    });
    expect(r.ok).toBe(true);
    expect(rec.calls[0]?.body).toMatchObject({
      exchange: 'binance',
      market: 'spot',
      symbol: 'BNB/USDT',
      interval: '1m',
    });
  });
});

describe('tickDataSession', () => {
  it('sends only exchange and symbol — never bars', async () => {
    const rec = recorder(() => jsonResponse({ status: 'success', session_id: 'ses1', appended: 0 }));
    restore = rec.restore;
    const r = await tickDataSession(ENDPOINT, '', 'ses1', { exchange: 'BINANCE', symbol: 'btc/usdt' });
    expect(r.ok).toBe(true);
    expect(rec.calls[0]?.path).toBe('/data/session/ses1/tick');
    expect(rec.calls[0]?.body).toEqual({ exchange: 'binance', symbol: 'BTC/USDT' });
  });

  it('looks up compact load-form as the canonical pair-form', async () => {
    const rec = recorder(() => jsonResponse({ status: 'success', session_id: 'ses1', appended: 0 }));
    restore = rec.restore;
    const r = await tickDataSession(ENDPOINT, '', 'ses1', { exchange: 'binance', symbol: 'BNBUSDT' });
    expect(r.ok).toBe(true);
    expect(rec.calls[0]?.body).toEqual({ exchange: 'binance', symbol: 'BNB/USDT' });
  });

  it('marks an expired session as gone', async () => {
    restore = recorder(() => jsonResponse({ status: 'error', code: 'NO_SESSION', message: 'gone' }, 404)).restore;
    const r = await tickDataSession(ENDPOINT, '', 'ses1', { exchange: 'binance', symbol: 'BTC/USDT' });
    expect(r).toEqual({ ok: false, error: 'gone', gone: true });
  });
});

describe('provideDataSeries', () => {
  it('chunks uploads to the contract limit', async () => {
    const total = DATA_PROVIDE_CHUNK + 10;
    const bars = Array.from({ length: total }, (_, i) => bar(1_700_000_000 + i * 3600));
    const rec = recorder((c) => {
      const n = bodyBars(c).length;
      return jsonResponse({ status: 'success', added: n, updated: 0, count: n });
    });
    restore = rec.restore;
    const out = await provideDataSeries(ENDPOINT, '', KEY, bars, 'axis-local');
    expect(rec.calls.map((c) => bodyBars(c).length)).toEqual([DATA_PROVIDE_CHUNK, 10]);
    expect(rec.calls[0]?.body).toMatchObject({ exchange: 'binance', source: 'axis-local' });
    expect(out.added).toBe(total);
  });
});

describe('ensureDataSession broker', () => {
  const local = (bars: Bar[]) => async () => bars;

  it('creates directly on a hit (nothing provisioned)', async () => {
    const rec = recorder(() => jsonResponse({ status: 'success', session_id: 's1' }));
    restore = rec.restore;
    const h = await ensureDataSession({ endpoint: ENDPOINT, apiKey: '', ...REQ, script: 's', localBars: local([]) });
    expect(h).toMatchObject({ sessionId: 's1', provisioned: 'none' });
    expect(rec.calls.map((c) => c.path)).toEqual(['/data/session']);
  });

  it('uploads the newest local bars on a miss, then retries', async () => {
    const localBars = freshBars(5);
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return creates === 1
          ? jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409)
          : jsonResponse({ status: 'success', session_id: 's2' });
      }
      return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
    });
    restore = rec.restore;
    const h = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      ...REQ,
      script: 's',
      localBars: local(localBars),
    });
    expect(h).toMatchObject({ sessionId: 's2', provisioned: 'local' });
    const provide = must(rec.calls, (c) => c.path === '/data/series/provide');
    expect(bodyBars(provide).map((b) => b.time)).toEqual(localBars.slice(-3).map((b) => b.time));
    // The fresh tail needs no engine-side catch-up.
    expect(rec.calls.some((c) => c.path === '/data/series/fetch')).toBe(false);
  });

  it('asks the engine to fetch when no local data exists', async () => {
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return creates === 1
          ? jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409)
          : jsonResponse({ status: 'success', session_id: 's3' });
      }
      return jsonResponse({ status: 'success', fetched: 3, count: 3 });
    });
    restore = rec.restore;
    const h = await ensureDataSession({ endpoint: ENDPOINT, apiKey: '', ...REQ, script: 's', localBars: local([]) });
    expect(h).toMatchObject({ sessionId: 's3', provisioned: 'fetch' });
    const fetchCall = must(rec.calls, (c) => c.path === '/data/series/fetch');
    expect(fetchCall.body).toMatchObject({ exchange: 'binance', history_bars: 3 });
  });

  it('tops up a stale local window from the engine feed after the upload', async () => {
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return creates === 1
          ? jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409)
          : jsonResponse({ status: 'success', session_id: 's-top' });
      }
      if (c.path === '/data/series/provide') {
        return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
      }
      if (c.path === '/data/series/fetch') {
        return jsonResponse({ status: 'success', fetched: 3, count: 6 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    // Ancient local times: deep enough for `need`, but frozen days back. The
    // broker uploads them and then asks the engine to catch up to now — a stale
    // upload must never become the engine's frozen tail (engine-owned live
    // paints the chart from that series).
    const h = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      ...REQ,
      script: 's',
      localBars: local([bar(1), bar(2), bar(3)]),
    });
    expect(h).toMatchObject({ sessionId: 's-top', provisioned: 'local' });
    expect(rec.calls.map((c) => c.path)).toEqual([
      '/data/session',
      '/data/series/provide',
      '/data/series/fetch',
      '/data/session',
    ]);
  });

  it('does not fetch when a local upload left the engine short (no ccxt needed)', async () => {
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 1, need: 3 }, 409);
      }
      return jsonResponse({ status: 'success', added: 1, fetched: 0, count: 1 });
    });
    restore = rec.restore;
    await expect(
      ensureDataSession({ endpoint: ENDPOINT, apiKey: '', ...REQ, script: 's', localBars: local([freshBars(1)[0]!]) }),
    ).rejects.toThrow(/still short after local upload/);
    expect(rec.calls.filter((c) => c.path === '/data/session').length).toBe(3);
    // The exchange fetch is never attempted for data the host may not download.
    expect(rec.calls.filter((c) => c.path === '/data/series/fetch').length).toBe(0);
  });

  it('clamps the session window to the uploaded count when the engine reports short', async () => {
    const requested: number[] = [];
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        const body = c.body as { history_bars?: number } | null;
        requested.push(Number(body?.history_bars || 0));
        // First two creates ask for 5; the third asks for what was uploaded (2).
        if (requested.length <= 2) {
          return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 2, need: 5 }, 409);
        }
        return jsonResponse({ status: 'success', session_id: 's-clamped' });
      }
      return jsonResponse({ status: 'success', added: 2, updated: 0, count: 2 });
    });
    restore = rec.restore;
    const h = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: { exchange: 'binance', symbol: 'BTCUSDT', interval: '1h' },
      historyBars: 5,
      script: 's',
      localBars: local(freshBars(2)),
    });
    expect(h).toMatchObject({ sessionId: 's-clamped', provisioned: 'local' });
    expect(requested).toEqual([5, 5, 2]);
    expect(rec.calls.some((c) => c.path === '/data/series/fetch')).toBe(false);
  });

  it('finds the local dataset under the source plugin id, not the bare venue', async () => {
    // Regression: datasets are keyed `binance-rest|…`, but the broker used to
    // ask for `binance|…` — it never matched, skipped the local upload and went
    // straight to the engine fetch (which needs ccxt on the host).
    _resetDatasetStoreForTests();
    _resetDatasetSinksForTests();
    await _resetBarsCacheForTests();
    await putDatasetBars('binance-rest', 'BTCUSDT', '1h', freshBars(3));
    setStore('source', 'binance-rest');
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return creates === 1
          ? jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409)
          : jsonResponse({ status: 'success', session_id: 's-local' });
      }
      return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
    });
    restore = rec.restore;
    // No `localBars` seam: exercises the default Data Manager lookup.
    const h = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: { exchange: 'binance', symbol: 'BTCUSDT', interval: '1h' },
      historyBars: 3,
      script: 's',
    });
    expect(h).toMatchObject({ sessionId: 's-local', provisioned: 'local' });
    expect(rec.calls.some((c) => c.path === '/data/series/provide')).toBe(true);
    expect(rec.calls.some((c) => c.path === '/data/series/fetch')).toBe(false);
  });

  it('finds a load-form local dataset from a pair-form series key', async () => {
    _resetDatasetStoreForTests();
    _resetDatasetSinksForTests();
    await _resetBarsCacheForTests();
    await putDatasetBars('binance-rest', 'BNBUSDT', '1h', freshBars(3));
    setStore('source', 'binance-rest');
    let creates = 0;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates++;
        return creates === 1
          ? jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409)
          : jsonResponse({ status: 'success', session_id: 's-pair' });
      }
      return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
    });
    restore = rec.restore;
    const h = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: { exchange: 'binance', symbol: 'BNB/USDT', interval: '1h' },
      historyBars: 3,
      script: 's',
    });
    expect(h).toMatchObject({ sessionId: 's-pair', provisioned: 'local' });
    expect(rec.calls.some((c) => c.path === '/data/series/provide')).toBe(true);
    const provide = rec.calls.find((c) => c.path === '/data/series/provide');
    expect(provide?.body).toMatchObject({ symbol: 'BNB/USDT' });
  });
});

describe('runDataSession memo', () => {
  function engine(opts: { tickGone?: boolean } = {}) {
    let n = 0;
    return recorder((c) => {
      if (c.method === 'DELETE') return jsonResponse({ status: 'success' });
      if (c.path === '/data/session') {
        n++;
        return jsonResponse({ status: 'success', session_id: `s${n}`, mode: 'interpret' });
      }
      if (c.path.endsWith('/tick')) {
        if (opts.tickGone) return jsonResponse({ status: 'error', code: 'NO_SESSION' }, 404);
        return jsonResponse({ status: 'success', session_id: 's1', appended: 0, unchanged: true });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
  }
  const req = { ...KEY, historyBars: 3 };

  it('reuses the owner session on a live tick (identity only)', async () => {
    const rec = engine();
    restore = rec.restore;
    const a = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's' });
    const b = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's', tick: true });
    expect(a).toMatchObject({ ok: true, via: 'data-session-create' });
    expect(b).toMatchObject({ ok: true, via: 'data-session-tick', sessionId: 's1' });
    const tick = must(rec.calls, (c) => c.path.endsWith('/tick'));
    // Identity + delta opt-in; the unchanged tick reuses the create payload.
    expect(tick.body).toEqual({ exchange: 'binance', symbol: 'BTC/USDT', delta: true });
    expect(rec.calls.filter((c) => c.path === '/data/session').length).toBe(1);
  });

  it('binds and ticks pair-form when the request symbol is compact load-form', async () => {
    const rec = engine();
    restore = rec.restore;
    const compact = { exchange: 'binance', symbol: 'BNBUSDT', interval: '1m', historyBars: 3 };
    const a = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind1',
      request: compact,
      script: 's',
    });
    const b = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind1',
      request: compact,
      script: 's',
      tick: true,
    });
    expect(a).toMatchObject({ ok: true, via: 'data-session-create' });
    expect(b).toMatchObject({ ok: true, via: 'data-session-tick' });
    const create = must(rec.calls, (c) => c.path === '/data/session');
    expect(create.body).toMatchObject({ exchange: 'binance', market: 'spot', symbol: 'BNB/USDT', interval: '1m' });
    const tick = must(rec.calls, (c) => c.path.endsWith('/tick'));
    expect(tick.body).toMatchObject({ exchange: 'binance', symbol: 'BNB/USDT' });
  });

  it('merges delta tails onto the cached full payload', async () => {
    const full = {
      status: 'success',
      session_id: 's1',
      count: 3,
      plots: [1, 2, 3],
      series: { a: [10, 20, 30] },
      events: [],
      mode: 'interpret',
    };
    let ticks = 0;
    const rec = recorder((c) => {
      if (c.method === 'DELETE') return jsonResponse({ status: 'success' });
      if (c.path === '/data/session') return jsonResponse({ ...full });
      if (c.path.endsWith('/tick')) {
        ticks++;
        return jsonResponse({
          status: 'success',
          session_id: 's1',
          count: 4,
          plots: [4],
          series: { a: [40] },
          events: [],
          appended: 1,
          forming: true,
          unchanged: false,
          delta: { base_index: 3, count: 4, tail_len: 1 },
        });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's' });
    const r = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's', tick: true });
    expect(r).toMatchObject({ ok: true, via: 'data-session-tick' });
    expect(ticks).toBe(1);
    // One cell traveled; the applied payload is the full merged window.
    expect(r.ok && (r.payload.plots as number[])).toEqual([1, 2, 3, 4]);
    expect(r.ok && (r.payload.series as Record<string, number[]>).a).toEqual([10, 20, 30, 40]);
    expect(r.ok && r.payload.count).toBe(4);
    expect(r.ok && 'delta' in r.payload).toBe(false);
  });

  it('recreates when a delta cannot merge (rebased session)', async () => {
    let creates = 0;
    const rec = recorder((c) => {
      if (c.method === 'DELETE') return jsonResponse({ status: 'success' });
      if (c.path === '/data/session') {
        creates++;
        return jsonResponse({
          status: 'success',
          session_id: `s${creates}`,
          count: 3,
          plots: [1, 2, 3],
          series: { a: [10, 20, 30] },
          events: [],
          mode: 'interpret',
        });
      }
      // Shrunk count the cache cannot honor — never applied as-is.
      return jsonResponse({
        status: 'success',
        session_id: 's1',
        count: 2,
        plots: [9, 8],
        series: { a: [90, 80] },
        events: [],
        appended: 0,
        delta: { base_index: 0, count: 2, tail_len: 2 },
      });
    });
    restore = rec.restore;
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's' });
    const r = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's', tick: true });
    expect(r).toMatchObject({ ok: true, via: 'data-session-create', sessionId: 's2' });
    expect(creates).toBe(2);
  });

  it('retries plain when the backend rejects the delta flag, then remembers', async () => {
    const tickBodies: unknown[] = [];
    const rec = recorder((c) => {
      if (c.method === 'DELETE') return jsonResponse({ status: 'success' });
      if (c.path === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 's1', count: 3, plots: [1, 2, 3], series: {}, events: [] });
      }
      if (c.path.endsWith('/tick')) {
        tickBodies.push(c.body);
        const body = c.body as { delta?: boolean } | null;
        if (body?.delta === true) {
          return jsonResponse({ status: 'error', code: 'UNKNOWN_FIELDS', message: 'unknown field: delta' }, 400);
        }
        return jsonResponse({ status: 'success', session_id: 's1', count: 3, plots: [1, 2, 3], series: {}, events: [] });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's' });
    const r1 = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's', tick: true });
    expect(r1).toMatchObject({ ok: true, via: 'data-session-tick' });
    expect(tickBodies).toEqual([
      { exchange: 'binance', symbol: 'BTC/USDT', delta: true },
      { exchange: 'binance', symbol: 'BTC/USDT' },
    ]);
    // Remembered: the next tick goes plain immediately (one request).
    tickBodies.length = 0;
    const r2 = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's', tick: true });
    expect(r2).toMatchObject({ ok: true, via: 'data-session-tick' });
    expect(tickBodies).toEqual([{ exchange: 'binance', symbol: 'BTC/USDT' }]);
  });

  it('keeps sibling indicators on separate sessions', async () => {
    const rec = engine();
    restore = rec.restore;
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's' });
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind2', request: req, script: 's' });
    expect(rec.calls.filter((c) => c.path === '/data/session').length).toBe(2);
    expect(rec.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('recreates a session the engine expired', async () => {
    const rec = engine({ tickGone: true });
    restore = rec.restore;
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's' });
    const r = await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 's', tick: true });
    expect(r).toMatchObject({ ok: true, via: 'data-session-create' });
    expect(rec.calls.filter((c) => c.path === '/data/session').length).toBe(2);
  });

  it('releases the old session when the script changes', async () => {
    const rec = engine();
    restore = rec.restore;
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 'v1' });
    await runDataSession({ endpoint: ENDPOINT, apiKey: '', owner: 'ind1', request: req, script: 'v2', tick: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.calls.some((c) => c.method === 'DELETE' && c.path === '/session/s1')).toBe(true);
  });

  it('backs off provisioning failures on live ticks (no per-tick retry storm)', async () => {
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409);
      }
      // Host without an exchange feed: fetch cannot fill the store.
      return jsonResponse({ status: 'error', code: 'DATA_FETCH_FAILED', message: 'ccxt missing' }, 500);
    });
    restore = rec.restore;
    const first = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind1',
      request: req,
      script: 's',
      tick: true,
    });
    expect(first.ok).toBe(false);
    const afterFirst = rec.calls.length;
    // Every request of the failed provisioning chain was paid once…
    expect(afterFirst).toBeGreaterThan(1);
    const second = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind1',
      request: req,
      script: 's',
      tick: true,
    });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toContain('retrying in');
    // …and the next live tick fails fast without touching the network.
    expect(rec.calls.length).toBe(afterFirst);
    // An interactive (non-tick) run still retries immediately.
    const interactive = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind1',
      request: req,
      script: 's',
    });
    expect(interactive.ok).toBe(false);
    expect(rec.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe('series provisioning memo (shared across owners)', () => {
  const local = (bars: Bar[]) => async () => bars;
  const bars5 = freshBars(5);

  /** Variant of `recorder` that also captures the request host (endpoint isolation). */
  function hostRecorder(
    respond: (call: Call & { host: string }, host: string) => Response | Promise<Response>,
  ): { calls: (Call & { host: string })[]; restore: () => void } {
    const calls: (Call & { host: string })[] = [];
    const restore = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const call: Call & { host: string } = {
        method: init?.method ?? 'GET',
        path: `${url.pathname}${url.search}`,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
        host: url.host,
      };
      calls.push(call);
      return respond(call, url.host);
    });
    return { calls, restore };
  }

  it('shares one upload across concurrent owners (sessions stay separate)', async () => {
    const provided = new Set<string>();
    let sessions = 0;
    const rec = hostRecorder((c, host) => {
      if (c.path === '/data/session') {
        if (!provided.has(host)) {
          return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409);
        }
        sessions += 1;
        return jsonResponse({ status: 'success', session_id: `s${sessions}` });
      }
      if (c.path === '/data/series/provide') {
        provided.add(host);
        return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const base = { endpoint: ENDPOINT, apiKey: '', key: KEY, historyBars: 3 };
    const [a, b] = await Promise.all([
      ensureDataSession({ ...base, script: 'script-a', localBars: local(bars5) }),
      ensureDataSession({ ...base, script: 'script-b', localBars: local(bars5) }),
    ]);
    // Evaluation isolation: each script instance keeps its own session…
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.provisioned).toBe('local');
    expect(b.provisioned).toBe('local');
    // …but the identical window is uploaded exactly once.
    expect(rec.calls.filter((c) => c.path === '/data/series/provide')).toHaveLength(1);
    expect(_getSeriesProvisionForTests(ENDPOINT, KEY)).toMatchObject({ historyBars: 3, via: 'local' });
  });

  it('reuses provisioning for a later owner without re-uploading', async () => {
    let creates = 0;
    let provides = 0;
    let staleMissOnce = false;
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        creates += 1;
        if (creates === 1 || staleMissOnce) {
          staleMissOnce = false;
          return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409);
        }
        return jsonResponse({ status: 'success', session_id: `s${creates}` });
      }
      provides += 1;
      return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
    });
    restore = rec.restore;
    const first = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      historyBars: 3,
      script: 'a',
      localBars: local(bars5),
    });
    expect(first.provisioned).toBe('local');
    expect(provides).toBe(1);
    // A stale miss despite recorded coverage (restarted engine view): the
    // memo retries the create, which hits — no second upload.
    staleMissOnce = true;
    const second = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      historyBars: 3,
      script: 'b',
      localBars: local(bars5),
    });
    expect(second.provisioned).toBe('local');
    expect(provides).toBe(1);
    expect(creates).toBe(4);
  });

  it('re-provisions (taking max) when a later owner needs a larger window', async () => {
    const providedSizes: number[] = [];
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        const need = Number((c.body as { history_bars?: number } | null)?.history_bars || 0);
        const have = providedSizes.length ? providedSizes[providedSizes.length - 1]! : 0;
        if (have >= need) return jsonResponse({ status: 'success', session_id: `s${need}` });
        return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have, need }, 409);
      }
      const n = bodyBars(c).length;
      providedSizes.push(n);
      return jsonResponse({ status: 'success', added: n, updated: 0, count: n });
    });
    restore = rec.restore;
    const six = [...bars5, bar(bars5[bars5.length - 1]!.time + HOUR)];
    const first = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      historyBars: 3,
      script: 'a',
      localBars: local(six),
    });
    expect(first.provisioned).toBe('local');
    const second = await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      historyBars: 5,
      script: 'b',
      localBars: local(six),
    });
    expect(second.provisioned).toBe('local');
    // The 3-bar tail first, then the wider 5-bar window: coverage takes max.
    expect(providedSizes).toEqual([3, 5]);
    expect(_getSeriesProvisionForTests(ENDPOINT, KEY)).toMatchObject({ historyBars: 5, via: 'local' });
  });

  it('does not leak provisioning across endpoints', async () => {
    const providedHosts: string[] = [];
    const missed = new Set<string>();
    const rec = hostRecorder((c, host) => {
      if (c.path === '/data/session') {
        if (!missed.has(host)) {
          missed.add(host);
          return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409);
        }
        return jsonResponse({ status: 'success', session_id: `s-${host}` });
      }
      providedHosts.push(host);
      return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
    });
    restore = rec.restore;
    const other = 'http://pro-other.test';
    await ensureDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      historyBars: 3,
      script: 'a',
      localBars: local(bars5),
    });
    expect(_getSeriesProvisionForTests(ENDPOINT, KEY)).toMatchObject({ historyBars: 3 });
    expect(_getSeriesProvisionForTests(other, KEY)).toBeNull();
    await ensureDataSession({
      endpoint: other,
      apiKey: '',
      key: KEY,
      historyBars: 3,
      script: 'a',
      localBars: local(bars5),
    });
    expect(providedHosts).toEqual(['pro.test', 'pro-other.test']);
  });

  it('runDataSession: a new script instance reuses the uploaded series', async () => {
    let creates = 0;
    let provides = 0;
    const rec = recorder((c) => {
      if (c.method === 'DELETE') return jsonResponse({ status: 'success' });
      if (c.path === '/data/session') {
        creates += 1;
        if (creates === 1) {
          return jsonResponse({ status: 'miss', code: 'DATA_MISS', key: 'k', have: 0, need: 3 }, 409);
        }
        return jsonResponse({ status: 'success', session_id: `s${creates}` });
      }
      if (c.path === '/data/series/provide') {
        provides += 1;
        return jsonResponse({ status: 'success', added: 3, updated: 0, count: 3 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const req = { ...KEY, historyBars: 3 };
    const a = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind1',
      request: req,
      script: 'script-a',
      localBars: local(bars5),
    });
    const b = await runDataSession({
      endpoint: ENDPOINT,
      apiKey: '',
      owner: 'ind2',
      request: req,
      script: 'script-b',
      localBars: local(bars5),
    });
    expect(a).toMatchObject({ ok: true });
    expect(b).toMatchObject({ ok: true });
    // Adding indicator N+1 reuses the already-uploaded engine series.
    expect(provides).toBe(1);
    expect(creates).toBe(3);
  });
});

describe('serverEngine engine-owned run', () => {
  it('evaluates over the engine series without sending bars', async () => {
    const rec = recorder((c) => {
      if (c.path === '/data/session') {
        return jsonResponse({
          status: 'success',
          session_id: 'ses9',
          plots: [1, 2],
          series: {},
          events: [],
          meta: {},
        });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const r = await serverEngine.run({
      script: '//@version=6\nindicator("x")',
      bars: [],
      config: { endpoint: ENDPOINT, preferWs: false, mode: 'interpret' },
      dataSession: { exchange: 'binance', symbol: 'BTC/USDT', interval: '1h', historyBars: 3 },
    });
    expect(r.status).toBe('success');
    expect(r.meta).toMatchObject({ sessionVia: 'data-session-create', session_id: 'ses9' });
    const sent = rec.calls.filter((c) => c.method === 'POST');
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) expect(c.body).not.toHaveProperty('data');
  });

  it('reports a broker failure as a run error instead of falling back to bars', async () => {
    const rec = recorder(() => jsonResponse({ status: 'error', message: 'upstream down' }, 502));
    restore = rec.restore;
    const r = await serverEngine.run({
      script: 's',
      bars: [bar(1), bar(2)],
      config: { endpoint: ENDPOINT, preferWs: false },
      dataSession: { exchange: 'binance', symbol: 'BTC/USDT', interval: '1h', historyBars: 3 },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/upstream down/);
    expect(rec.calls.every((c) => c.path.startsWith('/data/session') || c.path.startsWith('/data/series'))).toBe(true);
  });
});

describe('seriesIsStale', () => {
  const now = 1_800_000_000;

  it('treats an unknown / non-positive bound as stale', () => {
    expect(seriesIsStale(null, '1h', now)).toBe(true);
    expect(seriesIsStale(undefined, '1h', now)).toBe(true);
    expect(seriesIsStale(0, '1h', now)).toBe(true);
    expect(seriesIsStale(Number.NaN, '1h', now)).toBe(true);
  });

  it('is fresh at the current slot and within the step tolerance', () => {
    expect(seriesIsStale(now, '1h', now)).toBe(false);
    expect(seriesIsStale(now - 3600, '1h', now)).toBe(false);
    expect(seriesIsStale(now - 2 * 3600, '1h', now)).toBe(false);
  });

  it('is stale once the tail lags beyond the tolerance', () => {
    expect(seriesIsStale(now - 3 * 3600, '1h', now)).toBe(true);
    // The live symptom: a tail frozen four days back on a 1m series.
    expect(seriesIsStale(now - 4 * 86_400, '1m', now)).toBe(true);
  });
});

describe('repairStaleEngineSeries', () => {
  const local = (bars: Bar[]) => async () => bars;
  const nowSec = () => Math.floor(Date.now() / 1000);
  /** `GET /data/series` — the advisory status read. */
  const isStatus = (c: Call) => c.path.startsWith('/data/series?');

  it('skips a series the engine already holds at now', async () => {
    const rec = recorder((c) => {
      if (isStatus(c)) return jsonResponse({ status: 'success', count: 100, newest: nowSec() - 60 });
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const r = await repairStaleEngineSeries({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      localBars: local(freshBars(5)),
    });
    expect(r).toEqual({ repaired: false, via: 'none', bars: 0 });
    expect(rec.calls.filter((c) => !isStatus(c))).toHaveLength(0);
  });

  it('uploads the local tail when the engine series is behind and AXIS is fresh', async () => {
    const localBars = freshBars(5);
    const rec = recorder((c) => {
      if (isStatus(c)) {
        return jsonResponse({ status: 'success', count: 100, newest: nowSec() - 5 * 86_400 });
      }
      if (c.path === '/data/series/provide') {
        return jsonResponse({ status: 'success', added: 5, updated: 0, count: 105 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const r = await repairStaleEngineSeries({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      localBars: local(localBars),
    });
    expect(r).toEqual({ repaired: true, via: 'local', bars: 5 });
    const provide = must(rec.calls, (c) => c.path === '/data/series/provide');
    expect(bodyBars(provide).map((b) => b.time)).toEqual(localBars.map((b) => b.time));
    // A fresh upload needs no engine-side catch-up.
    expect(rec.calls.some((c) => c.path === '/data/series/fetch')).toBe(false);
  });

  it('asks the engine to fetch when AXIS holds no fresh local window', async () => {
    const rec = recorder((c) => {
      if (isStatus(c)) return jsonResponse({ status: 'success', count: 100, newest: 1 });
      if (c.path === '/data/series/fetch') {
        return jsonResponse({ status: 'success', fetched: 10, count: 110 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const r = await repairStaleEngineSeries({
      endpoint: ENDPOINT,
      apiKey: '',
      key: KEY,
      localBars: local([bar(1), bar(2)]),
    });
    expect(r).toEqual({ repaired: true, via: 'fetch', bars: 0 });
    expect(rec.calls.some((c) => c.path === '/data/series/provide')).toBe(false);
  });

  it('repairs a stale series at most once per cooldown window', async () => {
    let statusReads = 0;
    const rec = recorder((c) => {
      if (isStatus(c)) {
        statusReads += 1;
        return jsonResponse({ status: 'success', count: 100, newest: 1 });
      }
      if (c.path === '/data/series/fetch') {
        return jsonResponse({ status: 'success', fetched: 10, count: 110 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const opts = { endpoint: ENDPOINT, apiKey: '', key: KEY, localBars: local([bar(1)]) };
    const first = await repairStaleEngineSeries(opts);
    const second = await repairStaleEngineSeries(opts);
    expect(first.repaired).toBe(true);
    expect(second).toEqual({ repaired: false, via: 'none', bars: 0 });
    // One status read + one fetch for the first attempt; the second is skipped
    // before it even reads the engine status.
    expect(statusReads).toBe(1);
    expect(rec.calls.filter((c) => c.path === '/data/series/fetch')).toHaveLength(1);
    // An explicit (user-driven) repair ignores the cooldown.
    const forced = await repairStaleEngineSeries({ ...opts, force: true });
    expect(forced.repaired).toBe(true);
    expect(statusReads).toBe(2);
  });

  it('is cooldown-guarded per (endpoint, series)', async () => {
    const other = 'http://pro-other.test';
    const fetches: string[] = [];
    const rec = recorder((c) => {
      if (isStatus(c)) return jsonResponse({ status: 'success', count: 100, newest: 1 });
      if (c.path === '/data/series/fetch') {
        fetches.push(c.body?.symbol ? String(c.body.symbol) : '?');
        return jsonResponse({ status: 'success', fetched: 1, count: 101 });
      }
      return jsonResponse({ status: 'error' }, 500);
    });
    restore = rec.restore;
    const base = { apiKey: '', historyBars: 3, localBars: local([bar(1)]) };
    await repairStaleEngineSeries({ ...base, endpoint: ENDPOINT, key: KEY });
    await repairStaleEngineSeries({ ...base, endpoint: other, key: KEY });
    expect(fetches).toHaveLength(2);
  });
});
