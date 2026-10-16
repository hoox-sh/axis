/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine-owned live paint: the venue stream is only a trigger. Each flush ticks
 * the chart's engine data session and paints the engine's bars — and must also
 * advance `store.bars`, because the runner builds the overlay time axis from it
 * (`getOhlcvTimesForApply`). Without the sync the axis froze at the load window
 * and indicator/strategy series never gained the new bars.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import {
  _resetStreamRegistrationFlag,
  registerDynamicStream,
} from '../src/streams/catalog';
import {
  _resetEngineRegistrationFlag,
  _setCachedEngineCapabilitiesForTests,
  DEFAULT_ENGINE_CAPABILITIES,
} from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetDataSessionMemo } from '../src/engines/data-sessions';
import { _resetChartDataSessionForTests } from '../src/engines/chart-data-session';
import { setStore, setActivePlugin, clearLogs, store } from '../src/store';
import {
  startLive,
  stopLive,
  _resetMultiplexForTests,
  diffEngineOwnedBars,
  _awaitEnginePaintForTests,
  _getRerunAttemptCountForTests,
} from '../src/streams/multiplex';
import { SAMPLE_BARS } from './fixtures/bars';
import type { Bar } from '../src/store/types';

const ENDPOINT = 'http://pro.test';

async function waitFor(
  pred: () => boolean,
  timeoutMs: number,
  stepMs = 20,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  clearLogs();
  _resetMultiplexForTests();
  _resetDataSessionMemo();
  _resetChartDataSessionForTests();
  setStore('bars', SAMPLE_BARS.map((b) => ({ ...b })));
  setStore('endpoint', ENDPOINT);
  setStore('source', 'binance-rest');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1h');
  setStore('scripts', []);
  setStore('live', {
    active: false,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'eo-stream',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
  setStore('stream', { status: 'disconnected' });
  setActivePlugin('engine', 'server');
  _setCachedEngineCapabilitiesForTests({
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: ['every-tick', 'bar-close'],
    ownsData: true,
    dataSession: true,
  });
});

afterEach(() => {
  stopLive();
  _resetMultiplexForTests();
  _setCachedEngineCapabilitiesForTests(null);
  restoreFetch?.();
  restoreFetch = null;
});

describe('engine-owned live paint', () => {
  it('advances store.bars from the engine series on each trigger', async () => {
    const last = SAMPLE_BARS[SAMPLE_BARS.length - 1]!;
    const engineBars: Bar[] = [
      ...SAMPLE_BARS.map((b) => ({ ...b })),
      {
        time: last.time + 3600,
        open: last.close,
        high: last.close + 2,
        low: last.close - 1,
        close: last.close + 1,
        volume: 4242,
      },
    ];

    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1', cache: 'hit' });
      }
      if (method === 'POST' && url.pathname === '/data/session/chart1/tick') {
        return jsonResponse({
          status: 'success',
          session_id: 'chart1',
          appended: 1,
          forming: true,
        });
      }
      if (method === 'GET' && url.pathname === '/data/series/bars') {
        return jsonResponse({ status: 'success', bars: engineBars });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    registerDynamicStream({
      id: 'eo-stream',
      name: 'EO stream',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        // A venue tick that carries NO new closed bar — the engine's own feed
        // owns the series, so only the engine paint may advance the store.
        const t = setTimeout(
          () =>
            onBar({
              time: last.time,
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close,
              volume: last.volume,
            }),
          10,
        );
        return () => clearTimeout(t);
      },
    });

    startLive('eo-stream', 'BTCUSDT', '1h');

    const advanced = await waitFor(() => store.bars.length === engineBars.length, 4000);
    expect(advanced).toBe(true);
    const tip = store.bars[store.bars.length - 1]!;
    expect(tip.time).toBe(engineBars[engineBars.length - 1]!.time);
    expect(tip.close).toBe(engineBars[engineBars.length - 1]!.close);
  });

  it('skips the bar re-read when the engine tick reports unchanged', async () => {
    const last = SAMPLE_BARS[SAMPLE_BARS.length - 1]!;
    let barsGets = 0;
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1', cache: 'hit' });
      }
      if (method === 'POST' && url.pathname === '/data/session/chart1/tick') {
        return jsonResponse({
          status: 'success',
          session_id: 'chart1',
          appended: 0,
          forming: true,
          unchanged: true,
        });
      }
      if (method === 'GET' && url.pathname === '/data/series/bars') {
        barsGets += 1;
        return jsonResponse({ status: 'success', bars: SAMPLE_BARS });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    registerDynamicStream({
      id: 'eo-stream',
      name: 'EO stream',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        const t = setTimeout(
          () =>
            onBar({
              time: last.time,
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close + 0.5,
              volume: last.volume,
            }),
          10,
        );
        return () => clearTimeout(t);
      },
    });

    startLive('eo-stream', 'BTCUSDT', '1h');
    // Let the tick round trip settle (tick ~instant in mocks, then no GET).
    await new Promise((r) => setTimeout(r, 300));
    expect(store.bars.length).toBe(SAMPLE_BARS.length);
    expect(barsGets).toBe(0);
  });

  it('updates only the forming tip in place (no full setData per tick)', async () => {
    const last = SAMPLE_BARS[SAMPLE_BARS.length - 1]!;
    const revisedClose = last.close + 7;
    const engineBars: Bar[] = SAMPLE_BARS.map((b) => ({ ...b }));
    engineBars[engineBars.length - 1] = {
      ...last,
      high: revisedClose + 1,
      close: revisedClose,
    };

    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1', cache: 'hit' });
      }
      if (method === 'POST' && url.pathname === '/data/session/chart1/tick') {
        return jsonResponse({
          status: 'success',
          session_id: 'chart1',
          appended: 0,
          forming: true,
        });
      }
      if (method === 'GET' && url.pathname === '/data/series/bars') {
        return jsonResponse({ status: 'success', bars: engineBars });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    registerDynamicStream({
      id: 'eo-tip-stream',
      name: 'EO tip stream',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        const t = setTimeout(
          () =>
            onBar({
              time: last.time,
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close,
              volume: last.volume,
            }),
          10,
        );
        return () => clearTimeout(t);
      },
    });

    const before = store.bars;
    startLive('eo-tip-stream', 'BTCUSDT', '1h');

    const painted = await waitFor(
      () => store.bars[store.bars.length - 1]!.close === revisedClose,
      4000,
    );
    expect(painted).toBe(true);
    // Same window: length unchanged and the store array updated in place
    // (`appendBar` path-set) rather than replaced via `setBarsQuiet`.
    expect(store.bars.length).toBe(SAMPLE_BARS.length);
    expect(store.bars).toBe(before);
  });

  it('skips paint and re-run when the engine window is unchanged', async () => {
    const last = SAMPLE_BARS[SAMPLE_BARS.length - 1]!;
    const engineBars: Bar[] = SAMPLE_BARS.map((b) => ({ ...b }));

    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1', cache: 'hit' });
      }
      if (method === 'POST' && url.pathname === '/data/session/chart1/tick') {
        return jsonResponse({
          status: 'success',
          session_id: 'chart1',
          appended: 0,
          forming: true,
        });
      }
      if (method === 'GET' && url.pathname === '/data/series/bars') {
        return jsonResponse({ status: 'success', bars: engineBars });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    registerDynamicStream({
      id: 'eo-noop-stream',
      name: 'EO noop stream',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        const t = setTimeout(
          () =>
            onBar({
              time: last.time,
              open: last.open,
              high: last.high,
              low: last.low,
              close: last.close,
              volume: last.volume,
            }),
          10,
        );
        return () => clearTimeout(t);
      },
    });

    const before = store.bars;
    startLive('eo-noop-stream', 'BTCUSDT', '1h');

    // Let the queued flush run so the paint is actually in flight, then wait
    // for the chain to settle.
    await new Promise((r) => setTimeout(r, 60));
    await _awaitEnginePaintForTests();
    // Unchanged window: no store write (same reference), no dirty re-run flag.
    expect(store.bars).toBe(before);
    expect(store.bars.length).toBe(SAMPLE_BARS.length);
    expect(store.live.needsRerun).toBe(false);
  });

  it('schedules indicator re-runs only after the paint settles', async () => {
    let pushBar: ((b: Bar) => void) | null = null;
    registerDynamicStream({
      id: 'eo-wait-stream',
      name: 'EO wait stream',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        pushBar = onBar;
        return () => {
          pushBar = null;
        };
      },
    });

    const last = SAMPLE_BARS[SAMPLE_BARS.length - 1]!;
    const engineBars: Bar[] = [
      ...SAMPLE_BARS.map((b) => ({ ...b })),
      {
        time: last.time + 3600,
        open: last.close,
        high: last.close + 2,
        low: last.close - 1,
        close: last.close + 1,
        volume: 7,
      },
    ];

    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({ status: 'success', session_id: 'chart1', cache: 'hit' });
      }
      if (method === 'POST' && url.pathname === '/data/session/chart1/tick') {
        return jsonResponse({
          status: 'success',
          session_id: 'chart1',
          appended: 1,
          forming: true,
        });
      }
      if (method === 'GET' && url.pathname === '/data/series/bars') {
        // Slower than the 400ms re-run debounce: with the old fire-and-forget
        // scheduling the cycle would already have attempted before the paint
        // settles.
        await new Promise((r) => setTimeout(r, 700));
        return jsonResponse({ status: 'success', bars: engineBars });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    // No scripts yet, so the startup scheduleRerun no-ops — only the
    // paint-triggered schedule below is observed.
    startLive('eo-wait-stream', 'BTCUSDT', '1h');
    expect(pushBar).not.toBeNull();
    setStore('scripts', [
      {
        id: 'ind-wait',
        name: 'w',
        code: 'plot(close)',
        paneId: 'price',
        visible: true,
        plots: {},
      },
    ]);
    pushBar!({
      time: last.time,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
      volume: last.volume,
    });
    // Let the queued flush run so the paint is actually in flight.
    await new Promise((r) => setTimeout(r, 60));
    await _awaitEnginePaintForTests();
    // The paint applied the new bar, but the debounced re-run has not fired
    // yet — it was scheduled at settle time, not at flush time.
    expect(store.bars.length).toBe(engineBars.length);
    expect(_getRerunAttemptCountForTests()).toBe(0);
    const ran = await waitFor(() => _getRerunAttemptCountForTests() >= 1, 4000);
    expect(ran).toBe(true);
  });
});

describe('diffEngineOwnedBars', () => {
  const b = (time: number, close: number): Bar => ({
    time,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
  });
  const makeWin = (n: number, t0 = 1000): Bar[] =>
    Array.from({ length: n }, (_, i) => b(t0 + i * 60, 100 + i));

  it('noop on empty next, full on empty cur', () => {
    expect(diffEngineOwnedBars(makeWin(3), []).kind).toBe('noop');
    expect(diffEngineOwnedBars([], makeWin(3)).kind).toBe('full');
  });

  it('noop on an identical window', () => {
    expect(diffEngineOwnedBars(makeWin(5), makeWin(5)).kind).toBe('noop');
  });

  it('tip when only the forming bar moved', () => {
    const cur = makeWin(5);
    const next = makeWin(5);
    next[next.length - 1] = { ...next[next.length - 1]!, close: 999, high: 1000 };
    expect(diffEngineOwnedBars(cur, next).kind).toBe('tip');
  });

  it('full when same length but times shifted', () => {
    const cur = makeWin(5, 1000);
    const next = makeWin(5, 1060);
    expect(diffEngineOwnedBars(cur, next).kind).toBe('full');
  });

  it('full when the window shrank', () => {
    expect(diffEngineOwnedBars(makeWin(5), makeWin(3)).kind).toBe('full');
  });

  it('append for a few new bars with an aligned prefix', () => {
    const cur = makeWin(5);
    const next = [...makeWin(5), b(1000 + 5 * 60, 200), b(1000 + 6 * 60, 201)];
    const diff = diffEngineOwnedBars(cur, next);
    expect(diff.kind).toBe('append');
    if (diff.kind === 'append') {
      expect(diff.newBars.length).toBe(2);
      expect(diff.reviseTip).toBe(false);
    }
  });

  it('append revises a tip that closed with final values', () => {
    const cur = makeWin(5);
    const next = [...makeWin(5), b(1000 + 5 * 60, 200)];
    next[cur.length - 1] = { ...next[cur.length - 1]!, close: 555, high: 556 };
    const diff = diffEngineOwnedBars(cur, next);
    expect(diff.kind).toBe('append');
    if (diff.kind === 'append') {
      expect(diff.newBars.length).toBe(1);
      expect(diff.reviseTip).toBe(true);
    }
  });

  it('full on a large catch-up beyond the append cap', () => {
    const cur = makeWin(5);
    const next = [...makeWin(5)];
    for (let i = 0; i < 20; i++) next.push(b(1000 + (5 + i) * 60, 300 + i));
    expect(diffEngineOwnedBars(cur, next).kind).toBe('full');
  });

  it('full when longer but the prefix is misaligned', () => {
    const cur = makeWin(5, 1000);
    const next = [...makeWin(8, 2000)];
    expect(diffEngineOwnedBars(cur, next).kind).toBe('full');
  });
});
