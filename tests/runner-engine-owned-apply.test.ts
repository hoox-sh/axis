/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine-owned apply alignment: a data-session result evaluates the engine's
 * own series, which slides independently of the local chart window. Every
 * apply-path zip is index-based, so the series tail must be pinned to the
 * newest chart bar or each value lands `slack` bars early — the "indicator
 * stays as on the first print" freeze.
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
import { _resetChartDataSessionForTests } from '../src/engines/chart-data-session';
import { reconcile } from 'solid-js/store';
import { setStore, setActivePlugin, clearLogs } from '../src/store';
import {
  runAndApply,
  _resetRunEpochForTests,
  tailAlignSeriesToWindow,
} from '../src/indicators/runner';
import { setManager, setDrawingLayer } from '../src/chart/manager-access';
import { SAMPLE_BARS } from './fixtures/bars';

const ENDPOINT = 'http://run.test:5002';
const SCRIPT = 'indicator("eo", overlay=true)\nplot(close)';

interface CapturedApply {
  paneId: string;
  lines: Array<{ name: string; data: Array<{ time: number; value?: number }> }>;
}

let restoreFetch: (() => void) | null = null;
let captured: CapturedApply[] = [];

beforeEach(() => {
  registry.clear();
  _resetSourceRegistrationFlag();
  _resetStreamRegistrationFlag();
  _resetEngineRegistrationFlag();
  _resetStorageRegistrationFlag();
  _resetBootstrapFlag();
  ensureBuiltins();
  clearLogs();
  _resetRunEpochForTests();
  _resetDataSessionMemo();
  _resetChartDataSessionForTests();
  captured = [];
  setStore('bars', SAMPLE_BARS.map((b) => ({ ...b })));
  setStore('endpoint', ENDPOINT);
  setStore('source', 'binance-rest');
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1h');
  setStore('pluginsConfig', { 'engine:server': { mode: 'interpret', preferWs: false } });
  setStore('profilerEnabled', false);
  setStore('scripts', []);
  setStore('live', 'rerunOn', 'every-tick');
  setStore('resultsPanel', { open: false, height: 220 });
  setStore('resultsFocusId', null);
  setStore('runResults', {});
  setStore('lastRun', null);
  setActivePlugin('engine', 'server');
  _setCachedEngineCapabilitiesForTests({
    ...DEFAULT_ENGINE_CAPABILITIES,
    liveModes: ['every-tick', 'bar-close'],
    ownsData: true,
    dataSession: true,
  });
  setDrawingLayer(undefined);
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  setManager(undefined);
  setDrawingLayer(undefined);
  _setCachedEngineCapabilitiesForTests(null);
  // This file writes `engine:server.preferWs: false`; Bun shares module state
  // across test files — reconcile({}) replaces the bag instead of merging.
  setStore('pluginsConfig', reconcile({}));
});

describe('tailAlignSeriesToWindow', () => {
  it('trims a longer series to its newest values', () => {
    expect(tailAlignSeriesToWindow([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  it('head-pads a shorter series with na whitespace', () => {
    expect(tailAlignSeriesToWindow([1, 2], 4)).toEqual([null, null, 1, 2]);
  });

  it('returns equal-length and empty input untouched', () => {
    const same = [1, 2, 3];
    expect(tailAlignSeriesToWindow(same, 3)).toBe(same);
    expect(tailAlignSeriesToWindow(undefined, 3)).toEqual([]);
    expect(tailAlignSeriesToWindow([], 3)).toEqual([]);
    expect(tailAlignSeriesToWindow([1], 0)).toEqual([1]);
  });
});

describe('engine-owned series apply', () => {
  it('maps the engine series tail onto the newest chart bars', async () => {
    const bars = SAMPLE_BARS;
    const engineSeries = Array.from({ length: bars.length + 3 }, (_, i) => i + 1);
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({
          status: 'success',
          session_id: 'eo1',
          cache: 'hit',
          plots: [],
          series: { plot0: engineSeries },
          plot_meta: { plot0: {} },
          events: [],
          drawings: [],
          alerts: [],
          inputs: [],
          mode: 'interpret',
          overlay: true,
          script_name: 'eo',
          count: engineSeries.length,
          meta: {},
        });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });

    setManager({
      getPane: (id: string) =>
        id === 'price'
          ? { id: 'price', type: 'price', chart: {}, series: {}, priceLines: {} }
          : undefined,
      syncOverlayLines: (paneId: string, lines: CapturedApply['lines']) => {
        captured.push({ paneId, lines });
      },
      syncBgcolorBands: () => {},
    } as never);

    const r = await runAndApply(SCRIPT, undefined, { silent: true, openResults: false });
    expect(r.status).toBe('success');

    // The editor run applies under `__editor__` first, then promotes the same
    // aligned series to the new indicator id — both carries must be aligned.
    expect(captured.length).toBeGreaterThanOrEqual(1);
    for (const apply of captured) expect(apply.paneId).toBe('price');
    const line = captured[captured.length - 1]!.lines[0]!;
    // One point per chart bar — the series was trimmed to the window.
    expect(line.data).toHaveLength(bars.length);
    // Index 0 of the chart window now carries the series' 4th value
    // (3 leading engine bars are older than the window), and the tip carries
    // the newest engine value on the newest bar's time.
    expect(line.data[0]!.time).toBe(bars[0]!.time);
    expect(line.data[0]!.value).toBe(4);
    const tip = line.data[line.data.length - 1]!;
    expect(tip.time).toBe(bars[bars.length - 1]!.time);
    expect(tip.value).toBe(bars.length + 3);
  });

  it('keeps the 1:1 mapping for a bars-in run without a data session', async () => {
    const bars = SAMPLE_BARS;
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname.startsWith('/run')) {
        return jsonResponse({
          status: 'success',
          plots: [],
          series: { plot0: bars.map((_, i) => i + 1) },
          plot_meta: { plot0: {} },
          events: [],
          series_map: {},
          overlay: true,
          script_name: 'eo',
          mode: 'interpret',
        });
      }
      return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
    });
    _setCachedEngineCapabilitiesForTests({
      ...DEFAULT_ENGINE_CAPABILITIES,
      liveModes: ['bar-close'],
      ownsData: false,
      dataSession: false,
    });

    setManager({
      getPane: (id: string) =>
        id === 'price'
          ? { id: 'price', type: 'price', chart: {}, series: {}, priceLines: {} }
          : undefined,
      syncOverlayLines: (paneId: string, lines: CapturedApply['lines']) => {
        captured.push({ paneId, lines });
      },
      syncBgcolorBands: () => {},
    } as never);

    const r = await runAndApply(SCRIPT, undefined, { silent: true, openResults: false });
    expect(r.status).toBe('success');
    const line = captured[0]!.lines[0]!;
    expect(line.data).toHaveLength(bars.length);
    expect(line.data[0]!.value).toBe(1);
    expect(line.data[line.data.length - 1]!.value).toBe(bars.length);
  });
});
