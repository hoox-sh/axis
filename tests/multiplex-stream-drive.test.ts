/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Stream-path engine-series drive.
 *
 * The stream plane **replicates** the engine's series — the wire has no
 * client-side tick — so the engine's own store only moves when something asks
 * it to. On the engine-owned path the chart data session is ticked on every
 * venue flush, but the stream branch returns before that branch, so nothing
 * drove the engine there: its series froze a few bars behind the venue, the
 * script sessions that evaluate over it froze with it, and the apply path
 * tail-aligned the stale values onto the chart's tail — indicators displaced
 * by the freeze gap, growing with every new bar.
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
import { _resetSeriesDriveForTests } from '../src/engines/series-drive';
import { setStore, setActivePlugin, clearLogs } from '../src/store';
import { startLive, stopLive, _resetMultiplexForTests } from '../src/streams/multiplex';
import { SAMPLE_BARS } from './fixtures/bars';

const ENDPOINT = 'http://stream-drive.test';

let restoreFetch: (() => void) | null = null;
/** `POST /data/session/{id}/tick` calls seen by the mock. */
let tickCalls = 0;
/** `POST /data/session` calls seen by the mock. */
let sessionCalls = 0;

async function waitFor(pred: () => boolean, timeoutMs: number, stepMs = 20): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return pred();
}

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetMultiplexForTests();
  _resetDataSessionMemo();
  _resetChartDataSessionForTests();
  _resetSeriesDriveForTests();
  ensureBuiltins();
  clearLogs();
  tickCalls = 0;
  sessionCalls = 0;
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
    streamId: 'stream-drive',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
  setStore('stream', { status: 'disconnected' });
  setStore('pluginsConfig', {
    'engine:server': { mode: 'interpret', preferWs: false, endpoint: ENDPOINT, apiKey: 'test-key' },
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
  restoreFetch?.();
  restoreFetch = null;
});

describe('stream-path engine-series drive', () => {
  it('ticks the chart data session on a venue flush', async () => {
    const last = SAMPLE_BARS[SAMPLE_BARS.length - 1]!;
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        sessionCalls += 1;
        return jsonResponse({ status: 'success', session_id: 'drive1', cache: 'hit' });
      }
      if (method === 'POST' && url.pathname === '/data/session/drive1/tick') {
        tickCalls += 1;
        return jsonResponse({
          status: 'success',
          session_id: 'drive1',
          appended: 1,
          forming: true,
        });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    registerDynamicStream({
      id: 'stream-drive',
      name: 'Stream drive',
      kind: 'stream',
      start({ onBar, onStatus }) {
        onStatus({ state: 'open' });
        const t = setTimeout(
          () =>
            onBar({
              time: last.time + 3600,
              open: last.close,
              high: last.close + 2,
              low: last.close - 1,
              close: last.close + 1,
              volume: 4242,
            }),
          10,
        );
        return () => clearTimeout(t);
      },
    });

    startLive('stream-drive', 'BTCUSDT', '1h');

    const driven = await waitFor(() => tickCalls > 0, 5000);
    expect(driven).toBe(true);
    expect(sessionCalls).toBeGreaterThan(0);
  });
});
