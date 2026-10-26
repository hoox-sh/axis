/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Stream-path script eval backoff after StreamFallbackError.
 *
 * REST full-window fallback is forbidden while the socket owns the script;
 * multiplex arms per-script retry-after so later ticks re-attempt instead of
 * leaving `scriptStatus = degraded · websocket` forever — without hammering
 * /ws/live every debounce cycle.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { installChartHostMock } from './helpers/mock-chart-host';
import { StreamFallbackError } from '../src/engine/live-wire';

installChartHostMock();

const evalScript = mock(async (_ind: { id: string }) => {});

mock.module('../src/streams/stream-live', () => ({
  streamEvalScript: (ind: { id: string }) => evalScript(ind),
  streamRouteActive: () => true,
  streamSeriesTick: async () => false,
  streamDriveSeries: async () => {},
  streamStop: () => {},
  StreamFallbackError,
}));

const {
  SCRIPT_STREAM_RETRY_MS,
  scriptStreamRetryDelay,
  shouldAttemptScriptStream,
  noteScriptStreamFallback,
  clearScriptStreamRetry,
  _getScriptStreamRetryForTests,
  _resetMultiplexForTests,
  scheduleLiveRerun,
  stopLive,
  startLive,
} = await import('../src/streams/multiplex');
const { setStore, store, setScriptStatus } = await import('../src/store');
const { registry } = await import('../src/plugins/registry');
const { ensureBuiltins, _resetBootstrapFlag } = await import('../src/plugins/bootstrap');
const { _resetSourceRegistrationFlag } = await import('../src/sources/catalog');
const { _resetStreamRegistrationFlag, registerDynamicStream } = await import(
  '../src/streams/catalog'
);
const { _resetEngineRegistrationFlag, _setCachedEngineCapabilitiesForTests, DEFAULT_ENGINE_CAPABILITIES } =
  await import('../src/engines/catalog');
const { _resetStorageRegistrationFlag } = await import('../src/storage/catalog');
const { setActivePlugin } = await import('../src/store');

async function waitFor(pred: () => boolean, timeoutMs: number, stepMs = 20): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

beforeEach(() => {
  evalScript.mockReset();
  evalScript.mockImplementation(async () => {});
  _resetMultiplexForTests();
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  setStore('bars', [{ time: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
  setStore('scripts', [
    {
      id: 'ind-ws',
      name: 'WS',
      code: 'plot(close)',
      paneId: 'price',
      visible: true,
      plots: {},
    },
  ]);
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'retry-stream',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
    scriptStatus: {},
  });
  setStore('stream', { status: 'disconnected' });
  setStore('endpoint', 'http://retry.test');
  setStore('pluginsConfig', {
    'engine:server': {
      mode: 'interpret',
      preferWs: true,
      endpoint: 'http://retry.test',
      apiKey: 'test-key',
    },
  });
  setActivePlugin('engine', 'server');
  _setCachedEngineCapabilitiesForTests({
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: ['every-tick', 'bar-close'],
    ownsData: true,
    dataSession: true,
    liveStream: true,
  });
});

afterEach(() => {
  stopLive();
  _resetMultiplexForTests();
  _setCachedEngineCapabilitiesForTests(null);
});

describe('script stream retry policy', () => {
  it('uses 1s → 2s → 5s … capped at 30s', () => {
    expect(SCRIPT_STREAM_RETRY_MS[0]).toBe(1000);
    expect(SCRIPT_STREAM_RETRY_MS[1]).toBe(2000);
    expect(SCRIPT_STREAM_RETRY_MS[2]).toBe(5000);
    expect(SCRIPT_STREAM_RETRY_MS[SCRIPT_STREAM_RETRY_MS.length - 1]).toBe(30_000);
    expect(scriptStreamRetryDelay(0)).toBe(1000);
    expect(scriptStreamRetryDelay(1)).toBe(2000);
    expect(scriptStreamRetryDelay(2)).toBe(5000);
    expect(scriptStreamRetryDelay(5)).toBe(30_000);
    expect(scriptStreamRetryDelay(99)).toBe(30_000);
    expect(scriptStreamRetryDelay(-1)).toBe(1000);
  });

  it('arms retry-after and skips until elapsed', () => {
    const map = new Map();
    const t0 = 1_000_000;
    expect(shouldAttemptScriptStream('a', t0, map)).toBe(true);
    const noted = noteScriptStreamFallback('a', 'snapshot-timeout', t0, map);
    expect(noted.delayMs).toBe(1000);
    expect(noted.retryAfter).toBe(t0 + 1000);
    expect(noted.attempts).toBe(1);
    expect(noted.message).toBe('websocket · snapshot-timeout');
    expect(shouldAttemptScriptStream('a', t0 + 500, map)).toBe(false);
    expect(shouldAttemptScriptStream('a', t0 + 1000, map)).toBe(true);

    const second = noteScriptStreamFallback('a', 'cooldown', t0 + 1000, map);
    expect(second.delayMs).toBe(2000);
    expect(second.attempts).toBe(2);
    expect(second.message).toBe('websocket · cooldown');
    expect(shouldAttemptScriptStream('a', t0 + 2999, map)).toBe(false);
    expect(shouldAttemptScriptStream('a', t0 + 3000, map)).toBe(true);
  });

  it('clears backoff so the next tick may attempt immediately', () => {
    const map = new Map();
    noteScriptStreamFallback('b', 'eval', 5000, map);
    expect(shouldAttemptScriptStream('b', 5000, map)).toBe(false);
    clearScriptStreamRetry('b', map);
    expect(shouldAttemptScriptStream('b', 5000, map)).toBe(true);
  });

  it('keeps a plain websocket label when the reason is already websocket', () => {
    const noted = noteScriptStreamFallback('c', 'websocket', 0, new Map());
    expect(noted.message).toBe('websocket');
  });
});

describe('multiplex stream eval backoff', () => {
  it('degrades with reason, skips mid-backoff, then retries and recovers to live', async () => {
    let failuresLeft = 1;
    evalScript.mockImplementation(async (ind) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new StreamFallbackError('snapshot-timeout', 'no snapshot');
      }
      setScriptStatus(ind.id, 'live');
    });

    let pushBar: ((closed?: boolean) => void) | null = null;
    registerDynamicStream({
      id: 'retry-stream',
      name: 'Retry',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        pushBar = (closed = true) => {
          const last = store.bars[store.bars.length - 1];
          const t = (last?.time ?? 1000) + 60;
          onBar({
            time: t,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            volume: 1,
            closed,
          });
        };
        return () => {
          pushBar = null;
        };
      },
    });

    startLive('retry-stream', 'BTCUSDT', '1m');
    expect(store.live.active).toBe(true);

    pushBar?.(true);
    const failed = await waitFor(
      () => store.live.scriptStatus['ind-ws']?.status === 'degraded',
      2500,
    );
    expect(failed).toBe(true);
    expect(store.live.scriptStatus['ind-ws']?.message).toBe('websocket · snapshot-timeout');
    const armed = _getScriptStreamRetryForTests('ind-ws');
    expect(armed?.attempts).toBe(1);
    expect(armed?.retryAfter).toBeGreaterThan(Date.now() - 50);
    const callsAfterFail = evalScript.mock.calls.length;
    expect(callsAfterFail).toBeGreaterThanOrEqual(1);

    // Mid-backoff ticks must not call streamEvalScript again.
    pushBar?.(true);
    scheduleLiveRerun();
    await new Promise((r) => setTimeout(r, 500));
    expect(evalScript.mock.calls.length).toBe(callsAfterFail);
    expect(store.live.scriptStatus['ind-ws']?.status).toBe('degraded');

    // Elapse backoff and push another closed bar — next attempt succeeds.
    const waitMs = Math.max(0, (armed?.retryAfter ?? Date.now()) - Date.now() + 20);
    await new Promise((r) => setTimeout(r, waitMs));
    pushBar?.(true);
    const recovered = await waitFor(
      () => store.live.scriptStatus['ind-ws']?.status === 'live',
      2500,
    );
    expect(recovered).toBe(true);
    expect(evalScript.mock.calls.length).toBeGreaterThan(callsAfterFail);
    expect(_getScriptStreamRetryForTests('ind-ws')).toBeUndefined();

    stopLive();
  });

  it('clears retry state on stopLive / reset', () => {
    noteScriptStreamFallback('ind-ws', 'cooldown');
    expect(_getScriptStreamRetryForTests('ind-ws')).toBeDefined();
    stopLive();
    expect(_getScriptStreamRetryForTests('ind-ws')).toBeUndefined();
    noteScriptStreamFallback('ind-ws', 'cooldown');
    _resetMultiplexForTests();
    expect(_getScriptStreamRetryForTests('ind-ws')).toBeUndefined();
  });
});
