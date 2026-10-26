/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine-owned apply alignment: a session-backed result evaluates a bar window
 * that slides independently of the local chart window. Series are joined to
 * the chart by bar time (`alignSeriesToTimes` over the engine axis) so values
 * land on the correct bars even when the engine ran ahead or its session
 * outgrew the window; time-less payloads keep the index tail-align fallback.
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
  alignSeriesToTimes,
  extractEngineResultTimes,
  type RunResult,
} from '../src/indicators/runner';
import { alignApplySeries } from '../src/indicators/apply-context';
import { resolvePlotFillBands } from '../src/results/plot-visuals';
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
  setStore(
    'bars',
    SAMPLE_BARS.map((b) => ({ ...b })),
  );
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

  it('keeps the newest value on the newest bar (never tail-pads)', () => {
    // Regression guard: a perf pass flipped this to pad at the end, which
    // painted a `windowBars: 3` clamp on the three *oldest* bars and shifted
    // every value earlier (see the free-tier clamp case below). The tail-pin
    // contract is head-padding: the engine's last value is the newest bar's.
    expect(tailAlignSeriesToWindow([11, 12, 13], 5)).toEqual([null, null, 11, 12, 13]);
    expect(tailAlignSeriesToWindow([11, 12, 13], 5)[4]).toBe(13);
  });

  it('returns equal-length and empty input untouched', () => {
    const same = [1, 2, 3];
    expect(tailAlignSeriesToWindow(same, 3)).toBe(same);
    expect(tailAlignSeriesToWindow(undefined, 3)).toEqual([]);
    expect(tailAlignSeriesToWindow([], 3)).toEqual([]);
    expect(tailAlignSeriesToWindow([1], 0)).toEqual([1]);
  });
});

describe('alignApplySeries length mismatch', () => {
  it('pins a 5000-sample /run onto a 5003-bar chart so fill tail is the last bar', () => {
    const T = (i: number) => 1_700_000_000 + i * 300;
    const bars = Array.from({ length: 5003 }, (_, i) => ({
      time: T(i),
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    }));
    const upper = Array.from({ length: 5000 }, (_, i) => 100 + i);
    const lower = Array.from({ length: 5000 }, (_, i) => 90 + i);
    const result = {
      status: 'success',
      series: {
        Upper: upper,
        Lower: lower,
        fill: Array(5000).fill(null),
      },
      meta: {
        overlay: true,
        plot_meta: {
          Upper: { kind: 'plot', title: 'Upper' },
          Lower: { kind: 'plot', title: 'Lower' },
          fill: { kind: 'fill', title: 'fill', plot1: 'Upper', plot2: 'Lower' },
        },
      },
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("KC", overlay=true)\nplot(close)', result, bars, {
      silent: true,
    });
    expect(aligned.needsAlign).toBe(true);
    expect(aligned.chartWindowBars).toBe(5003);
    expect(aligned.seriesMap.Upper).toHaveLength(5003);
    expect(aligned.seriesMap.Upper?.slice(0, 3)).toEqual([null, null, null]);
    expect(aligned.seriesMap.Upper?.[5002]).toBe(upper[4999]);
    expect(aligned.seriesMap.Lower?.[5002]).toBe(lower[4999]);
    const bands = resolvePlotFillBands(aligned.seriesMap, aligned.plotMeta);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.upper).toHaveLength(5003);
    expect(bands[0]!.upper[5002]).toBe(upper[4999]);
    expect(bands[0]!.lower[5002]).toBe(lower[4999]);
  });
});

describe('alignApplySeries staleNoAxis', () => {
  const T = (i: number) => 1_700_000_000 + i * 300;
  const bars = Array.from({ length: 5 }, (_, i) => ({
    time: T(i),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
  }));
  const sessionMeta = (extra?: Record<string, unknown>) => ({
    sessionVia: 'session-tick',
    overlay: true,
    ...(extra ?? {}),
  });

  it('flags a live push without axis when the series is shorter than the chart', () => {
    const result = {
      status: 'success',
      series: { plot0: [1, 2, 3] },
      meta: sessionMeta(),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
      livePush: true,
    });
    expect(aligned.staleNoAxis).toBe(true);
    expect(aligned.resultTimes).toBeNull();
  });

  it('tail-clamps a live stream push when the engine series is longer than the chart (no axis)', () => {
    // DSM/replica often holds 20k while the rolling window is 5k — skipping
    // left overlays blank (tip cache never seeded).
    const result = {
      status: 'success',
      series: { plot0: Array.from({ length: 20 }, (_, i) => i) },
      meta: { ...sessionMeta(), sessionVia: 'stream-delta' },
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
      livePush: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
    expect(aligned.seriesMap.plot0).toEqual([15, 16, 17, 18, 19]);
  });

  it('keeps the tail-pin for a fresh full run without axis (values just computed)', () => {
    const result = {
      status: 'success',
      series: { plot0: [1, 2, 3] },
      meta: sessionMeta(),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
    expect(aligned.seriesMap.plot0).toEqual([null, null, 1, 2, 3]);
  });

  it('does not flag an equal-length session series without axis', () => {
    const result = {
      status: 'success',
      series: { plot0: [1, 2, 3, 4, 5] },
      meta: sessionMeta(),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
      livePush: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
  });

  it('does not flag a time-joined session run that ships an axis', () => {
    const times = bars.map((b) => b.time);
    const result = {
      status: 'success',
      series: { plot0: [1, 2, 3] },
      meta: sessionMeta({ engineTimes: times.slice(0, 3) }),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
      livePush: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
    expect(aligned.seriesMap.plot0).toEqual([1, 2, 3, 3, 3]);
  });

  it('does not flag a non-session length mismatch (free-tier clamp still tail-pins)', () => {
    const result = {
      status: 'success',
      series: { plot0: [11, 12, 13] },
      meta: { overlay: true, windowBars: 3 },
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
      livePush: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
    expect(aligned.seriesMap.plot0).toEqual([null, null, 11, 12, 13]);
  });

  it('skips a fresh full run whose window grossly mismatches without axis', () => {
    // 20-bar engine window on a 5-bar chart, no axis, not a live push: this
    // is a different window, not mid-run appends — pinning would displace
    // every value (the 9577-on-5000 desync).
    const result = {
      status: 'success',
      series: { plot0: Array.from({ length: 20 }, (_, i) => i) },
      meta: sessionMeta(),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
    });
    expect(aligned.staleNoAxis).toBe(true);
    expect(aligned.resultTimes).toBeNull();
  });

  it('skips a gross plots-array mismatch without axis', () => {
    const result = {
      status: 'success',
      plots: Array.from({ length: 20 }, (_, i) => i),
      series: {},
      meta: sessionMeta(),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
    });
    expect(aligned.staleNoAxis).toBe(true);
  });

  it('keeps pinning a deliberate free-tier clamp without axis (session windowBars)', () => {
    // The engine evaluated the newest 3 bars on purpose — tail-align is the
    // documented clamp behavior, not a stale window.
    const result = {
      status: 'success',
      series: { plot0: [11, 12, 13] },
      meta: sessionMeta({ windowBars: 3 }),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
    expect(aligned.seriesMap.plot0).toEqual([null, null, 11, 12, 13]);
  });

  it('pins a small mismatch without axis (bars appended mid-run)', () => {
    // 7-long series on a 5-bar chart: within tolerance, still a race.
    const result = {
      status: 'success',
      series: { plot0: [1, 2, 3, 4, 5, 6, 7] },
      meta: sessionMeta(),
    } as unknown as RunResult;
    const aligned = alignApplySeries('indicator("x", overlay=true)\nplot(close)', result, bars, {
      silent: true,
    });
    expect(aligned.staleNoAxis).toBe(false);
    expect(aligned.seriesMap.plot0).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('alignSeriesToTimes', () => {
  const T = (i: number) => 1_700_000_000 + i * 86_400;

  it('joins values to chart bars by time, dropping engine bars outside the window', () => {
    // Engine ran ahead: two newer bars the chart does not have yet.
    const out = alignSeriesToTimes(
      [1, 2, 3, 4, 5, 6, 7],
      [T(0), T(1), T(2), T(3), T(4), T(5), T(6)],
      [T(0), T(1), T(2), T(3), T(4)],
    );
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });

  it('extends the last value onto chart bars newer than the engine axis', () => {
    const out = alignSeriesToTimes([1, 2, 3], [T(0), T(1), T(2)], [T(0), T(1), T(2), T(3), T(4)]);
    expect(out).toEqual([1, 2, 3, 3, 3]);
  });

  it('normalizes Pine-ms engine times to chart seconds', () => {
    const out = alignSeriesToTimes(
      [1, 2, 3],
      [T(0) * 1000, T(1) * 1000, T(2) * 1000],
      [T(0), T(1), T(2)],
    );
    expect(out).toEqual([1, 2, 3]);
  });

  it('last wins on duplicate engine stamps', () => {
    expect(alignSeriesToTimes([1, 2], [T(0), T(0)], [T(0)])).toEqual([2]);
  });

  it('falls back to tail-align without a usable engine axis', () => {
    expect(alignSeriesToTimes([1, 2, 3, 4, 5], null, [T(0), T(1), T(2)])).toEqual([3, 4, 5]);
    expect(alignSeriesToTimes([1, 2], undefined, [T(0), T(1), T(2), T(3)])).toEqual([
      null,
      null,
      1,
      2,
    ]);
    // An axis that does not describe this series 1:1 cannot be joined either.
    expect(alignSeriesToTimes([1, 2, 3, 4], [T(0), T(1)], [T(0), T(1), T(2)])).toEqual([2, 3, 4]);
  });

  it('keeps equal-length aligned series on their own bars', () => {
    expect(alignSeriesToTimes([1, 2, 3], [T(0), T(1), T(2)], [T(0), T(1), T(2)])).toEqual([
      1, 2, 3,
    ]);
  });
});

describe('extractEngineResultTimes', () => {
  it('prefers meta.engineTimes and accepts loose fields', () => {
    expect(extractEngineResultTimes({ meta: { engineTimes: [10, 20] } })).toEqual([10, 20]);
    expect(extractEngineResultTimes({ meta: { bar_times: [10, 20] } })).toEqual([10, 20]);
    expect(extractEngineResultTimes({ times: [10, 20] })).toEqual([10, 20]);
    expect(extractEngineResultTimes({ meta: { bars: [{ time: 10 }, { time: 20 }] } })).toEqual([
      10, 20,
    ]);
    expect(extractEngineResultTimes({ bars: [[10], [20]] })).toEqual([10, 20]);
  });

  it('normalizes ms and drops junk', () => {
    expect(
      extractEngineResultTimes({ meta: { engineTimes: [1_700_000_000_000, 'oops', null] } }),
    ).toEqual([1_700_000_000]);
    expect(extractEngineResultTimes({ meta: {} })).toBeNull();
    expect(extractEngineResultTimes(null)).toBeNull();
    expect(extractEngineResultTimes({ meta: { engineTimes: ['na', null] } })).toBeNull();
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

  it('joins an engine-owned series by bar time when the engine ships its axis', async () => {
    // The engine's stored series can have gaps, so an index join displaces the
    // plot. With the engine's bar-time axis the values land on the bars they
    // belong to — even when the engine ran ahead of the chart.
    const bars = SAMPLE_BARS;
    const step = 60;
    // Engine window: two older bars, then the chart bars, then one newer bar
    // (the engine's newest closed bar is ahead of the chart's forming bar).
    const engineTimes = [
      bars[0]!.time - 2 * step,
      bars[0]!.time - step,
      ...bars.map((b) => b.time),
      bars[bars.length - 1]!.time + step,
    ];
    const engineSeries = engineTimes.map((_, i) => i + 1);
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({
          status: 'success',
          session_id: 'eo-axis',
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
          times: engineTimes,
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
    const line = captured[captured.length - 1]!.lines[0]!;
    expect(line.data).toHaveLength(bars.length);
    // Chart bar 0 carries the engine value whose *time* matches — the third
    // engine value (the two older engine bars are outside the chart window).
    expect(line.data[0]!.time).toBe(bars[0]!.time);
    expect(line.data[0]!.value).toBe(3);
    const tip = line.data[line.data.length - 1]!;
    expect(tip.time).toBe(bars[bars.length - 1]!.time);
    expect(tip.value).toBe(bars.length + 2);
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

  it('tail-aligns a free-tier clamped series (meta.windowBars) to the chart window', async () => {
    const bars = SAMPLE_BARS;
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname.startsWith('/run')) {
        return jsonResponse({
          status: 'success',
          plots: [],
          series: { plot0: [11, 12, 13] },
          plot_meta: { plot0: {} },
          events: [],
          overlay: true,
          script_name: 'eo',
          mode: 'interpret',
          meta: { windowBars: 3 },
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
    const line = captured[captured.length - 1]!.lines[0]!;
    // The clamped series covers the newest 3 bars; the two older chart bars
    // become `na` whitespace instead of shifting every value early.
    expect(line.data).toHaveLength(bars.length);
    expect(line.data[0]!.value).toBeUndefined();
    expect(line.data[1]!.value).toBeUndefined();
    expect(line.data[2]!.value).toBe(11);
    expect(line.data[bars.length - 1]!.value).toBe(13);
    expect(line.data[bars.length - 1]!.time).toBe(bars[bars.length - 1]!.time);
  });

  it('joins a longer engine-owned series by bar time when the engine ran ahead', async () => {
    const bars = SAMPLE_BARS;
    const t = (i: number) => bars[0]!.time + i * 86_400;
    // The engine feed is two bars ahead of the chart: its series is longer
    // AND newer, so index tail-align would pin future values onto stale bars.
    const engineTimes = [0, 1, 2, 3, 4, 5, 6].map(t);
    const engineSeries = [1, 2, 3, 4, 5, 6, 7];
    restoreFetch = mockFetch(async (input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method || 'GET').toUpperCase();
      if (method === 'POST' && url.pathname === '/data/session') {
        return jsonResponse({
          status: 'success',
          session_id: 'eo-ahead',
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
          times: engineTimes,
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
    // The top-level payload axis reaches the apply path via meta.engineTimes.
    expect(r.meta?.engineTimes).toEqual(engineTimes);

    const line = captured[captured.length - 1]!.lines[0]!;
    expect(line.data).toHaveLength(bars.length);
    // Time join: every chart bar carries its own engine value; the two future
    // engine bars are dropped instead of shifting the window (tail-align would
    // show [3, 4, 5, 6, 7] with future values on stale bars).
    expect(line.data.map((d) => d.value)).toEqual([1, 2, 3, 4, 5]);
    const tip = line.data[line.data.length - 1]!;
    expect(tip.time).toBe(bars[bars.length - 1]!.time);
    expect(tip.value).toBe(5);
  });

  it('tail-clamps a longer live series grown past the chart without an axis', async () => {
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

    // Live stream/session often holds a longer replica than the rolling chart
    // window. Tail-clamp paints the tip instead of skipping forever.
    const precomputed: RunResult = {
      status: 'success',
      plots: [],
      series: { plot0: [1, 2, 3, 4, 5, 6, 7] },
      events: [],
      meta: {
        sessionVia: 'stream-delta',
        session_id: 's9',
        overlay: true,
        script_name: 'eo',
        plot_meta: { plot0: {} },
      },
    };
    const r = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      liveTick: true,
      precomputedResult: precomputed,
    });
    expect(r.status).toBe('success');
    expect(r.meta?.skipped).not.toBe('stale-no-axis');
    expect(captured.length).toBeGreaterThan(0);
    const line = captured[captured.length - 1]!.lines[0]!;
    expect(line.data).toHaveLength(SAMPLE_BARS.length);
    expect(line.data.map((p) => p.value)).toEqual([3, 4, 5, 6, 7]);
  });

  it('skips a shorter session series when the chart grew without an axis (idle gap)', async () => {
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

    // Idle/backfill case: the chart holds 5 bars but the stale push only
    // evaluated 3. Tail-pinning would head-pad `na`s and shift every value;
    // LWC connects the gap as a diagonal from the last pre-break value.
    const precomputed: RunResult = {
      status: 'success',
      plots: [],
      series: { plot0: [1, 2, 3] },
      events: [],
      meta: {
        sessionVia: 'session-append',
        session_id: 's10',
        overlay: true,
        script_name: 'eo',
        plot_meta: { plot0: {} },
      },
    };
    const r = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      liveTick: true,
      precomputedResult: precomputed,
    });
    expect(r.status).toBe('success');
    expect(r.meta?.skipped).toBe('stale-no-axis');
    expect(captured).toHaveLength(0);
  });

  it('still paints an equal-length session series without an axis (same window)', async () => {
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

    // No axis and no length drift: the index zip is the only assumption
    // available, and painting keeps live ticks updating the tip.
    const precomputed: RunResult = {
      status: 'success',
      plots: [],
      series: { plot0: [1, 2, 3, 4, 5] },
      events: [],
      meta: {
        sessionVia: 'session-tick',
        session_id: 's11',
        overlay: true,
        script_name: 'eo',
        plot_meta: { plot0: {} },
      },
    };
    const r = await runAndApply(SCRIPT, undefined, {
      silent: true,
      openResults: false,
      liveTick: true,
      precomputedResult: precomputed,
    });
    expect(r.status).toBe('success');
    expect(r.meta?.skipped).toBeUndefined();
    const line = captured[captured.length - 1]!.lines[0]!;
    expect(line.data.map((d) => d.value)).toEqual([1, 2, 3, 4, 5]);
  });
});
