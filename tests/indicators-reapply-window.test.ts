/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Reapply dedupe — the guard compares the bar **window identity** (head time +
 * length), not the length alone.
 *
 * The rolling window slides with a constant length, so a length-only check
 * looked "unchanged" for every later reapply: the UI re-run button and the MCP
 * `indicators.run` capability became no-ops, the indicators kept the window
 * they were last computed on, and the chart — which keeps advancing — left
 * them displaced against its tail.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import {
  _resetEngineRegistrationFlag,
  _setCachedEngineCapabilitiesForTests,
  DEFAULT_ENGINE_CAPABILITIES,
} from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { _resetDataSessionMemo } from '../src/engines/data-sessions';
import { reconcile } from 'solid-js/store';
import { setStore, setActivePlugin, addIndicator, clearLogs } from '../src/store';
import {
  reapplyChartScripts,
  _resetReapplyGuardForTests,
} from '../src/indicators/reapply';
import { setManager, setDrawingLayer } from '../src/chart/manager-access';

const ENDPOINT = 'http://reapply.test:5002';

let restoreFetch: (() => void) | null = null;
/** Engine round trips seen by the mock (one per script run / batch). */
let calls = 0;

function bar(time: number) {
  return { time, open: 1, high: 1, low: 1, close: 1, volume: 1 };
}

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  _resetDataSessionMemo();
  _resetReapplyGuardForTests();
  ensureBuiltins();
  clearLogs();
  calls = 0;
  setStore('bars', [bar(1000), bar(1060)]);
  setStore('endpoint', ENDPOINT);
  setStore('source', 'binance-rest');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1m');
  setStore('pluginsConfig', { 'engine:server': { mode: 'interpret', preferWs: false } });
  setStore('profilerEnabled', false);
  setStore('scripts', []);
  setStore('resultsPanel', { open: false, height: 220 });
  setStore('resultsFocusId', null);
  setStore('runResults', {});
  setStore('lastRun', null);
  setActivePlugin('engine', 'server');
  _setCachedEngineCapabilitiesForTests({
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: ['every-tick', 'bar-close'],
  });
  setManager(undefined);
  setDrawingLayer(undefined);
  restoreFetch = mockFetch(async () => {
    calls += 1;
    return jsonResponse({
      status: 'success',
      plots: [],
      series: {},
      plot_meta: {},
      events: [],
      drawings: [],
      alerts: [],
      inputs: [],
      mode: 'interpret',
      overlay: true,
      count: 2,
      meta: {},
    });
  });
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  setManager(undefined);
  setDrawingLayer(undefined);
  _setCachedEngineCapabilitiesForTests(null);
  setStore('pluginsConfig', reconcile({}));
  _resetReapplyGuardForTests();
});

describe('reapplyChartScripts window dedupe', () => {
  it('runs the visible scripts once for a fresh window', async () => {
    addIndicator('A', 'indicator("A")\nplot(close)', 'price', {});
    expect(await reapplyChartScripts()).toBe(1);
    expect(calls).toBeGreaterThan(0);
  });

  it('skips a repeated reapply on the same bar window', async () => {
    addIndicator('A', 'indicator("A")\nplot(close)', 'price', {});
    expect(await reapplyChartScripts()).toBe(1);
    const after = calls;
    expect(await reapplyChartScripts()).toBe(0);
    expect(calls).toBe(after);
  });

  it('re-runs after the window slides even though its length is unchanged', async () => {
    addIndicator('A', 'indicator("A")\nplot(close)', 'price', {});
    expect(await reapplyChartScripts()).toBe(1);

    // The rolling window slides: the oldest bar is dropped and a new one is
    // appended, so the length is identical but the window is not.
    setStore('bars', [bar(1060), bar(1120)]);
    expect(await reapplyChartScripts()).toBe(1);
  });

  it('keeps re-running on every slide of the rolling window', async () => {
    addIndicator('A', 'indicator("A")\nplot(close)', 'price', {});
    expect(await reapplyChartScripts()).toBe(1);
    for (let i = 1; i <= 3; i++) {
      setStore('bars', [bar(1000 + i * 60), bar(1000 + (i + 1) * 60)]);
      expect(await reapplyChartScripts()).toBe(1);
    }
  });
});
