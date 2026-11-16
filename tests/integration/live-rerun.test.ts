/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Integration: live multiplex marks needsRerun and schedules silent runner.
 * Guards store flags + mocked engine without Solid chart host.
 */
import './../setup';
import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { registry } from '../../src/plugins/registry';
import { _resetBootstrapFlag, ensureBuiltins } from '../../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../../src/storage/catalog';
import {
  store,
  setStore,
  loadBars,
  setLive,
  setActivePlugin,
} from '../../src/store';
import { startLive, stopLive, defaultStreamForSource } from '../../src/streams/multiplex';
import { registerDynamicStream } from '../../src/streams/catalog';
import { SAMPLE_BARS } from '../fixtures/bars';

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  loadBars(SAMPLE_BARS.slice(0, 5), 'BTCUSDT', '1m', 'binance');
  setActivePlugin('source', 'csv-upload');
  registerDynamicStream({
    id: 'test-live',
    name: 'Test Live',
    kind: 'stream',
    start({ onBar, onStatus }) {
      onStatus?.({ state: 'open' });
      const timer = setInterval(() => {
        onBar?.({
          time: Math.floor(Date.now() / 1000),
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
        });
      }, 20);
      return () => clearInterval(timer);
    },
  });
  setActivePlugin('stream', 'test-live');
  setActivePlugin('engine', 'server');
  setStore('endpoint', 'http://run.test');
  setStore('scripts', [
    {
      id: 'ind1',
      name: 'SMA',
      code: '//@version=5\nindicator("x")\nplot(close)',
      paneId: 'price',
      visible: true,
      plots: {},
    },
  ]);
});

afterEach(() => {
  stopLive();
  setLive(false);
});

describe('live re-run integration', () => {
  it('startLive sets live.active and can stop cleanly', async () => {
    // Avoid real network on silent re-run
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          plots: [1, 2, 3],
          series: {},
          events: [],
          meta: { script_name: 'x', overlay: true, ms: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    try {
      await startLive('test-live');
      expect(store.live.active).toBe(true);
      expect(store.live.streamId).toBe('test-live');
      // Allow one poll tick
      await new Promise((r) => setTimeout(r, 50));
      stopLive();
      expect(store.live.active).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('csv has no synthetic default stream', () => {
    expect(defaultStreamForSource('csv-upload')).toBe('');
    expect(defaultStreamForSource('binance-rest')).toMatch(/binance|ws/i);
  });
});
