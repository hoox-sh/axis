/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * MCP live-plane capabilities (`src/mcp/live.ts`): `chart.bars`, `chart.lag`,
 * the `engine.*` plane, and `stream.*`.
 *
 * Engine HTTP is mocked at `globalThis.fetch` — no test may reach a real
 * engine, and every engine call must keep the API key off the URL.
 */

import './setup';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { putDatasetBars, _resetDatasetStoreForTests } from '../src/data/dataset-store';
import { _resetChartDataSessionForTests } from '../src/engines/chart-data-session';
import { _resetSeriesDriveForTests } from '../src/engines/series-drive';
import { invokeCapability } from '../src/mcp/dispatch';
import { APP_CAPABILITIES, findCapability } from '../src/mcp/catalog';
import { McpInvokeError } from '../src/mcp/protocol';
import { getActiveEngineId } from '../src/plugins/active';
import {
  ENGINE_SERVER_API_KEY_SLOT,
  forgetSecret,
  getSecret,
  putSecret,
  setEngineApiKey,
} from '../src/storage/vault';
import { setStore, store } from '../src/store';

const realFetch = globalThis.fetch;

/** Loose view over a capability result — tests only (assertions read fields freely). */
// biome-ignore lint/suspicious/noExplicitAny: test-only loose capability-result view
type CapResult = Record<string, any>;

const orig = {
  endpoint: store.endpoint,
  bars: store.bars,
  pluginsConfig: store.pluginsConfig,
  lastTick: store.telemetry?.lastTick ?? null,
  engineSecret: getSecret(ENGINE_SERVER_API_KEY_SLOT),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function engineCfgKey(): string {
  return `engine:${getActiveEngineId()}`;
}

/**
 * Point the active engine at `endpoint` + plant its key **in both places**:
 * the config bag and the session vault (`getActiveEngineConfig` reads the
 * vault first, so setting only the bag would leave a previous test's key
 * authoritative — and every test's key would leak into the next one).
 */
function setEngine(endpoint: string, apiKey = ''): void {
  setStore('pluginsConfig', engineCfgKey(), { endpoint, apiKey });
  setEngineApiKey(getActiveEngineId(), apiKey);
}

/** Ascending bars around the current wall-clock slot (60 s step). */
function slotNow(stepSec = 60): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % stepSec);
}

function makeBars(times: number[]) {
  return times.map((time) => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }));
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(McpInvokeError);
    expect((err as McpInvokeError).code).toBe(code);
  }
}

beforeEach(() => {
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('exchange', 'binance');
  setStore('bars', []);
  setStore('endpoint', '');
  setEngine('', '');
  setStore('live', 'active', false);
  setStore('live', 'feeds', {});
  setStore('live', 'scriptStatus', {});
  setStore('telemetry', 'lastTick', null);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setStore('endpoint', orig.endpoint);
  setStore('bars', orig.bars);
  setStore('pluginsConfig', orig.pluginsConfig);
  setStore('telemetry', 'lastTick', orig.lastTick);
  // Restore the pre-suite engine secret (tests planted their own).
  if (orig.engineSecret) putSecret(ENGINE_SERVER_API_KEY_SLOT, orig.engineSecret);
  else forgetSecret(ENGINE_SERVER_API_KEY_SLOT);
  _resetChartDataSessionForTests();
  _resetSeriesDriveForTests();
  _resetDatasetStoreForTests();
});

describe('MCP live-plane catalog', () => {
  it('ships the diagnostics with the right domains and mutation flags', () => {
    const ids = APP_CAPABILITIES.map((c) => c.id);
    for (const id of [
      'chart.bars',
      'chart.lag',
      'engine.get',
      'engine.series',
      'engine.tick',
      'engine.repair',
      'stream.get',
      'stream.reset',
    ]) {
      expect(ids).toContain(id);
    }
    expect(findCapability('chart.bars')?.domain).toBe('chart');
    expect(findCapability('engine.get')?.domain).toBe('engine');
    expect(findCapability('stream.get')?.domain).toBe('stream');
    expect(findCapability('engine.series')?.mutates).toBe(false);
    expect(findCapability('chart.lag')?.mutates).toBe(false);
    expect(findCapability('engine.tick')?.mutates).toBe(true);
    expect(findCapability('engine.repair')?.mutates).toBe(true);
    expect(findCapability('stream.reset')?.mutates).toBe(true);
  });

  it('denies mutating live capabilities to the in-page read-only host', async () => {
    await expectCode(
      invokeCapability('engine.tick', {}, { allowMutations: false }),
      'MUTATION_DENIED',
    );
    await expectCode(
      invokeCapability('stream.reset', {}, { allowMutations: false }),
      'MUTATION_DENIED',
    );
  });
});

describe('chart.bars', () => {
  it('returns the tail, the forming-bar flag and the missing-slot map', async () => {
    const slot = slotNow();
    setStore('bars', makeBars([slot - 300, slot - 240, slot - 180, slot - 120, slot]));
    const r = (await invokeCapability('chart.bars')) as CapResult;

    expect(r.summary.count).toBe(5);
    expect(r.summary.lastTime).toBe(slot);
    expect(r.stepSec).toBe(60);
    expect(r.tail).toHaveLength(5);
    expect(r.tail[4].time).toBe(slot);
    expect(r.formingBar).toEqual({ time: slot, current: true });
    expect(r.gaps.total).toBe(1);
    expect(r.gaps.slots[0]).toEqual({ after: slot - 120, to: slot, missing: 1 });
  });

  it('bounds tail/head independently and honours gaps: false', async () => {
    const slot = slotNow();
    setStore('bars', makeBars([slot - 240, slot - 180, slot - 120, slot - 60, slot]));
    const tail = (await invokeCapability('chart.bars', { limit: 2, head: 2, gaps: false })) as CapResult;
    expect(tail.tail.map((b: { time: number }) => b.time)).toEqual([slot - 60, slot]);
    expect(tail.head.map((b: { time: number }) => b.time)).toEqual([slot - 240, slot - 180]);
    expect('gaps' in tail).toBe(false);
  });

  it('reports an empty chart instead of throwing', async () => {
    const r = (await invokeCapability('chart.bars')) as CapResult;
    expect(r.summary.count).toBe(0);
    expect(r.formingBar).toBeNull();
  });
});

describe('chart.lag', () => {
  it('is live when the chart tail is the current forming bar', async () => {
    const slot = slotNow();
    setStore('bars', makeBars([slot - 180, slot - 120, slot - 60, slot]));
    const r = (await invokeCapability('chart.lag', { engine: false })) as CapResult;
    expect(r.verdict).toMatchObject({ code: 'live', bars: 0 });
    expect(r.chart.hasFormingBar).toBe(true);
    expect(r.engine).toEqual({ skipped: true, reason: 'disabled' });
  });

  it('calls out exactly one missing bar when the tail is the last closed bar', async () => {
    const slot = slotNow();
    setStore('bars', makeBars([slot - 240, slot - 180, slot - 120, slot - 60]));
    const r = (await invokeCapability('chart.lag', { engine: false })) as CapResult;
    expect(r.verdict).toMatchObject({ code: 'one-bar-behind', bars: 1 });
    expect(r.chart.lagBars).toBe(1);
    expect(r.chart.hasFormingBar).toBe(false);
  });

  it('uses a fresh venue tick over the wall clock (session venues)', async () => {
    const slot = slotNow();
    // Chart ends at the forming bar per the *tick* clock, but the wall clock
    // already rolled into the next interval — the tick must win.
    setStore('bars', makeBars([slot - 60, slot]));
    setStore('telemetry', 'lastTick', {
      time: slot,
      price: 5,
      dir: 'up',
      at: Date.now(),
      symbol: 'BTCUSDT',
    });
    const r = (await invokeCapability('chart.lag', { engine: false })) as CapResult;
    expect(r.venue.source).toBe('tick');
    expect(r.verdict).toMatchObject({ code: 'live' });
  });

  it('reports the engine as skipped without an endpoint', async () => {
    setStore('bars', makeBars([slotNow() - 60, slotNow()]));
    const r = (await invokeCapability('chart.lag')) as CapResult;
    expect(r.engine).toEqual({ skipped: true, reason: 'no-endpoint' });
  });

  it('reports the engine series bounds and staleness when reachable', async () => {
    const slot = slotNow();
    setStore('bars', makeBars([slot - 60, slot]));
    setEngine('https://mock-engine.test/lag', 'SECRET_LAG_KEY');
    const seen: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(urlOf(input));
      return json({ key: 'binance|spot|BTCUSDT|1m', count: 9, oldest: 1, newest: slot - 600, updated_at: slot - 600 });
    }) as typeof fetch;

    const r = (await invokeCapability('chart.lag')) as CapResult;
    expect(r.engine.newest).toBe(slot - 600);
    expect(r.engine.stale).toBe(true);
    expect(r.engine.formingHold).toBe(false);
    expect(typeof r.engineLagBars).toBe('number');
    expect(seen[0]).toContain('/data/series?');
    expect(seen[0]).not.toContain('SECRET_LAG_KEY');
  });

  it('verdict is empty for an empty chart', async () => {
    const r = (await invokeCapability('chart.lag', { engine: false })) as CapResult;
    expect(r.verdict).toMatchObject({ code: 'empty' });
  });
});

describe('engine.get', () => {
  it('exposes the plane without leaking the API key', async () => {
    setStore('endpoint', 'https://example-engine.test');
    setEngine('https://example-engine.test', 'SECRET_ENGINE_KEY');
    const r = (await invokeCapability('engine.get')) as CapResult;

    expect(r.id).toBe(getActiveEngineId());
    expect(r.endpoint).toBe('https://example-engine.test');
    expect(r.hasApiKey).toBe(true);
    expect('apiKey' in r).toBe(false);
    expect(r.configFields).toContain('endpoint');
    expect(typeof r.route.useStream).toBe('boolean');
    expect(r.live).toHaveProperty('rerunOn');
    expect(r.telemetry).toHaveProperty('state');
    expect(JSON.stringify(r)).not.toContain('SECRET_ENGINE_KEY');
    expect(r.session === null || typeof r.session.sessionId === 'string').toBe(true);
  });

  it('reports no-endpoint state honestly', async () => {
    const r = (await invokeCapability('engine.get')) as CapResult;
    expect(r.endpoint).toBeNull();
    expect(r.hasApiKey).toBe(false);
  });
});

describe('engine.series', () => {
  it('fails with NO_ENDPOINT when the engine is unconfigured', async () => {
    await expectCode(invokeCapability('engine.series'), 'NO_ENDPOINT');
  });

  it('reads the engine bounds and never puts the key on the URL', async () => {
    setEngine('https://mock-engine.test/series', 'SECRET_SERIES_KEY');
    let seenUrl = '';
    let seenAuth: unknown = null;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seenUrl = urlOf(input);
      seenAuth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return json({ key: 'binance|spot|BTCUSDT|1m', count: 42, oldest: 1792000000, newest: 1792003600, updated_at: 1792003610 });
    }) as typeof fetch;

    const r = (await invokeCapability('engine.series')) as CapResult;
    expect(r.count).toBe(42);
    expect(r.newest).toBe(1792003600);
    expect(r.stale).toBe(true);
    expect(r.matchesChart).toBe(true);
    expect(r.requested).toBe('binance|spot|BTCUSDT|1m');
    expect(typeof r.lagBars).toBe('number');
    expect(seenUrl).toContain('/data/series?');
    expect(seenUrl).toContain('symbol=BTCUSDT');
    expect(seenUrl).toContain('interval=1m');
    expect(seenUrl).not.toContain('SECRET_SERIES_KEY');
    expect(seenAuth).toBe('Bearer SECRET_SERIES_KEY');
  });

  it('accepts an explicit series key and reports it does not match the chart', async () => {
    setEngine('https://mock-engine.test/series2');
    globalThis.fetch = (async () =>
      json({ key: 'binance|spot|ETHUSDT|15m', count: 3, oldest: 1, newest: 2, updated_at: 2 })) as typeof fetch;
    const r = (await invokeCapability('engine.series', { symbol: 'ETHUSDT', interval: '15m' })) as CapResult;
    expect(r.matchesChart).toBe(false);
    expect(r.requested).toBe('binance|spot|ETHUSDT|15m');
  });

  it('fails with ENGINE_UNREACHABLE when the engine errors', async () => {
    setEngine('https://mock-engine.test/series3');
    globalThis.fetch = (async () => json({ error: 'nope' }, 500)) as typeof fetch;
    await expectCode(invokeCapability('engine.series'), 'ENGINE_UNREACHABLE');
  });
});

describe('engine.tick', () => {
  it('fails with NO_ENDPOINT when the engine is unconfigured', async () => {
    await expectCode(invokeCapability('engine.tick'), 'NO_ENDPOINT');
  });

  it('forces a drive tick and reports before/after bounds + the envelope', async () => {
    setEngine('https://mock-engine.test/drv', 'SECRET_TICK_KEY');
    let statusCalls = 0;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      const method = String(init?.method || 'GET');
      requests.push(`${method} ${url}`);
      if (url.includes('/data/series?')) {
        statusCalls += 1;
        const newest = statusCalls <= 1 ? 1792230000 : 1792230120;
        return json({ key: 'binance|spot|BTCUSDT|1m', count: 20, oldest: 1, newest, updated_at: newest });
      }
      if (url.endsWith('/tick')) {
        return json({ status: 'ok', appended: 3, forming: true, unchanged: false, stale: false });
      }
      if (url.endsWith('/data/session')) return json({ session_id: 'sess_mcp_tick', status: 'ok' });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const r = (await invokeCapability('engine.tick')) as CapResult;
    expect(r.outcome).toBe('ticked');
    expect(r.tick).toMatchObject({ ok: true, appended: 3, forming: true });
    expect(r.before.newest).toBe(1792230000);
    expect(r.after.newest).toBe(1792230120);
    expect(r.advancedBars).toBe(120);
    expect(typeof r.ms).toBe('number');
    expect(requests.some((q) => q.startsWith('POST ') && q.includes('/data/session/sess_mcp_tick/tick'))).toBe(true);
    expect(requests.every((q) => !q.includes('SECRET_TICK_KEY'))).toBe(true);
  });

  it('maps a stale envelope to the stale outcome', async () => {
    setEngine('https://mock-engine.test/drv-stale');
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = urlOf(input);
      if (url.includes('/data/series?')) return json({ key: 'k', count: 0, oldest: null, newest: null, updated_at: null });
      if (url.endsWith('/tick')) return json({ status: 'ok', stale: true });
      if (url.endsWith('/data/session')) return json({ session_id: 'sess_stale', status: 'ok' });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const r = (await invokeCapability('engine.tick')) as CapResult;
    expect(r.outcome).toBe('stale');
    expect(r.tick).toMatchObject({ ok: true, stale: true });
    // Both status reads succeeded but neither reported bounds → no advance.
    expect(r.advancedBars).toBe(0);
    expect(r.after.newest).toBeNull();
  });
});

describe('engine.repair', () => {
  it('fails with NO_ENDPOINT when the engine is unconfigured', async () => {
    await expectCode(invokeCapability('engine.repair'), 'NO_ENDPOINT');
  });

  it('forces the broker and reports the outcome with before/after bounds', async () => {
    setEngine('https://mock-engine.test/repair', 'SECRET_REPAIR_KEY');
    // Fresh local window: the broker prefers uploading AXIS' own bars over
    // asking the engine to fetch from its exchange feed.
    const slot = slotNow();
    await putDatasetBars('binance-rest', 'BTCUSDT', '1m', makeBars([slot - 240, slot - 180, slot - 120, slot - 60, slot]));
    let statusCalls = 0;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input);
      const method = String(init?.method || 'GET');
      requests.push(`${method} ${url}`);
      if (url.includes('/data/series?')) {
        statusCalls += 1;
        const newest = statusCalls <= 1 ? 1792220000 : 1792230000;
        return json({ key: 'k', count: 7, oldest: 1, newest, updated_at: newest });
      }
      if (url.includes('/data/series/provide')) return json({ added: 5, updated: 2, count: 7 });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const r = (await invokeCapability('engine.repair')) as CapResult;
    expect(r.repaired).toBe(true);
    expect(r.via).toBe('local');
    expect(r.bars).toBe(5);
    expect(r.advancedBars).toBe(10000);
    expect(requests.some((q) => q.startsWith('POST ') && q.includes('/data/series/provide'))).toBe(true);
    expect(requests.every((q) => !q.includes('SECRET_REPAIR_KEY'))).toBe(true);
  });
});

describe('stream.get / stream.reset', () => {
  it('reports route, wire, feeds and telemetry', async () => {
    const r = (await invokeCapability('stream.get')) as CapResult;
    expect(typeof r.routeActive).toBe('boolean');
    expect(typeof r.route.useStream).toBe('boolean');
    expect(r.feeds).toEqual({});
    expect(r.scriptStatus).toEqual({});
    expect(r.live).toMatchObject({ active: false });
    expect(r.telemetry).toHaveProperty('stream');
    expect('apiKey' in r).toBe(false);
  });

  it('stream.reset reports the drop and why it did not resubscribe', async () => {
    const off = (await invokeCapability('stream.reset', { resubscribe: false })) as CapResult;
    expect(off.ok).toBe(true);
    expect(off.resubscribe).toMatchObject({ requested: false, reason: 'disabled' });
    expect(typeof off.hadWire).toBe('boolean');
    expect(typeof off.unsubscribed).toBe('number');

    const liveOff = (await invokeCapability('stream.reset')) as CapResult;
    expect(liveOff.resubscribe).toMatchObject({ requested: false, reason: 'live-off' });
  });
});
