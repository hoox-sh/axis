/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live start must warm /health capabilities so the stream route activates
 * without waiting for the Scripts panel to mount. A cold cache defaults to
 * liveStream:false → calculator → REST/WS /run every tick + Degraded chips.
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
  getCachedEngineCapabilities,
} from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { setStore, setActivePlugin, clearLogs } from '../src/store';
import { startLive, stopLive, _resetMultiplexForTests } from '../src/streams/multiplex';
import { streamRouteActive } from '../src/streams/stream-live';
import { SAMPLE_BARS } from './fixtures/bars';
import { routeEngineRun } from '../src/engine/router';

const ENDPOINT = 'http://live-caps-warm.test';

let restoreFetch: (() => void) | null = null;

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
  ensureBuiltins();
  clearLogs();
  // Cold cache — the bug: defaults keep liveStream false
  _setCachedEngineCapabilitiesForTests(null);
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
    streamId: 'caps-warm',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
  setStore('stream', { status: 'disconnected' });
  setStore('pluginsConfig', {
    'engine:server': { mode: 'interpret', preferWs: true, endpoint: ENDPOINT, apiKey: 'test-key' },
  });
  setActivePlugin('engine', 'server');
});

afterEach(() => {
  stopLive();
  _resetMultiplexForTests();
  _setCachedEngineCapabilitiesForTests(null);
  restoreFetch?.();
  restoreFetch = null;
});

describe('startLive warms engine capabilities', () => {
  it('flips the stream route on after /health advertises live_stream', async () => {
    expect(getCachedEngineCapabilities().liveStream).toBe(false);
    expect(routeEngineRun(getCachedEngineCapabilities()).reason).toBe('calculator');

    restoreFetch = mockFetch(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/health') {
        return jsonResponse({
          status: 'healthy',
          features: {
            live_stream: true,
            data_session: true,
            live_modes: ['every-tick', 'bar-close'],
          },
        });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    registerDynamicStream({
      id: 'caps-warm',
      name: 'Caps warm',
      kind: 'stream',
      start({ onStatus }) {
        onStatus({ state: 'open' });
        return () => {};
      },
    });

    startLive('caps-warm', 'BTCUSDT', '1h');

    const warmed = await waitFor(
      () => getCachedEngineCapabilities().liveStream === true,
      3000,
    );
    expect(warmed).toBe(true);
    expect(routeEngineRun(getCachedEngineCapabilities()).useStream).toBe(true);
    expect(streamRouteActive()).toBe(true);
  });
});
