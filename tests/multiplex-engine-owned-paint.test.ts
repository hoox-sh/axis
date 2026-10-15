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
});
