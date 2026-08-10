/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Runner hardening: empty bars, malformed engine payloads, concurrent
 * supersession, timeout/network error status messages.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { registry } from '../src/plugins/registry';
import { ensureBuiltins, _resetBootstrapFlag } from '../src/plugins/bootstrap';
import { _resetSourceRegistrationFlag } from '../src/sources/catalog';
import { _resetStreamRegistrationFlag } from '../src/streams/catalog';
import { _resetEngineRegistrationFlag } from '../src/engines/catalog';
import { _resetStorageRegistrationFlag } from '../src/storage/catalog';
import { setStore, setActivePlugin, clearLogs, store, setLastRun } from '../src/store';
import {
  runScript,
  runAndApply,
  _resetRunEpochForTests,
} from '../src/indicators/runner';
import { SAMPLE_BARS } from './fixtures/bars';
import { lineSeriesToOverlayData } from '../src/results/plot-visuals';

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
  _resetRunEpochForTests();
  setStore('bars', SAMPLE_BARS);
  setStore('endpoint', 'http://run.test:5002');
  setStore('scripts', []);
  setStore('resultsPanel', { open: false, height: 220 });
  setLastRun(null);
  setActivePlugin('engine', 'server');
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe('runScript empty bars', () => {
  it('returns user-readable error without calling engine', async () => {
    setStore('bars', []);
    const r = await runScript('plot(close)', { silent: true });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/No bars loaded/i);
    expect(r.series).toEqual({});
    expect(r.plots).toEqual([]);
  });
});

describe('runScript defensive engine payload', () => {
  it('normalizes missing plots/series without throwing', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        // no plots, no series, no events
        meta: { script_name: 'sparse' },
      }),
    );
    const r = await runScript('plot(close)', { silent: true });
    expect(r.status).toBe('success');
    expect(Array.isArray(r.plots)).toBe(true);
    expect(r.plots).toEqual([]);
    expect(r.series).toEqual({});
    expect(Array.isArray(r.events)).toBe(true);
  });

  it('coerces NaN-like series samples via normalize', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => null),
        series: {
          s: SAMPLE_BARS.map((_, i) => (i === 0 ? 'na' : i === 1 ? null : 1.5)),
        },
        events: [],
        meta: { script_name: 'na-demo' },
      }),
    );
    const r = await runScript('plot(close)', { silent: true });
    expect(r.status).toBe('success');
    expect(r.series.s?.[0]).toBeNull();
    expect(r.series.s?.[1]).toBeNull();
    expect(r.series.s?.[2]).toBe(1.5);
  });

  it('surfaces network failure with readable message', async () => {
    restoreFetch = mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await runScript('plot(close)', { silent: false, openResults: false });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/Cannot reach|Failed to fetch|engine/i);
  });

  it('surfaces timeout wording clearly', async () => {
    restoreFetch = mockFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const r = await runScript('plot(close)', { silent: true });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/timed out/i);
  });
});

describe('runAndApply concurrent supersession', () => {
  it('stale completion does not clobber lastRun of newer run', async () => {
    let releaseSlow: (() => void) | null = null;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let call = 0;

    restoreFetch = mockFetch(async () => {
      call += 1;
      if (call === 1) {
        await slowGate;
        return jsonResponse({
          status: 'success',
          plots: SAMPLE_BARS.map(() => 1),
          series: { old: SAMPLE_BARS.map(() => 1) },
          events: [],
          meta: { script_name: 'old-run', overlay: true },
        });
      }
      return jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => 9),
        series: { fresh: SAMPLE_BARS.map(() => 9) },
        events: [],
        meta: { script_name: 'fresh-run', overlay: true },
      });
    });

    const p1 = runAndApply('//@version=5\nindicator("a")\nplot(1)', undefined, {
      openResults: false,
      silent: true,
    });
    // Let first request start and park on gate
    await new Promise((r) => setTimeout(r, 10));
    const p2 = runAndApply('//@version=5\nindicator("b")\nplot(9)', undefined, {
      openResults: false,
      silent: true,
    });
    const r2 = await p2;
    expect(r2.status).toBe('success');
    expect(r2.meta?.script_name).toBe('fresh-run');
    expect(store.lastRun?.meta?.script_name).toBe('fresh-run');

    releaseSlow!();
    const r1 = await p1;
    expect(r1.meta?.superseded).toBe(true);
    // lastRun must still be the newer run
    expect(store.lastRun?.meta?.script_name).toBe('fresh-run');
  });

  it('silent live re-run defers while interactive Run is in flight (MTF-safe)', async () => {
    let releaseSlow: (() => void) | null = null;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let call = 0;

    restoreFetch = mockFetch(async () => {
      call += 1;
      if (call === 1) {
        await slowGate;
        return jsonResponse({
          status: 'success',
          plots: SAMPLE_BARS.map(() => 1),
          series: { slow: SAMPLE_BARS.map(() => 1) },
          events: [],
          meta: { script_name: 'interactive', overlay: true },
        });
      }
      return jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => 2),
        series: { live: SAMPLE_BARS.map(() => 2) },
        events: [],
        meta: { script_name: 'live', overlay: true },
      });
    });

    // Interactive Run shows Running… and claims status ownership
    const interactive = runAndApply(
      '//@version=5\nindicator("a")\nplot(1)',
      undefined,
      { openResults: false, silent: false },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(store.status).toBe('running');

    // Live tick while interactive is still running: must NOT supersede (MTF RSI)
    const live = await runAndApply(
      '//@version=5\nindicator("b")\nplot(2)',
      undefined,
      { openResults: false, silent: true },
    );
    expect(live.meta?.deferred).toBe(true);
    expect(store.live.needsRerun).toBe(true);
    // Interactive still owns the engine
    expect(store.status).toBe('running');
    expect(call).toBe(1);

    releaseSlow!();
    const r1 = await interactive;
    expect(r1.meta?.superseded).not.toBe(true);
    expect(r1.status).toBe('success');
    expect(r1.meta?.script_name).toBe('interactive');
    // Button must not stay stuck on Running… after the interactive generation ends
    expect(store.status).not.toBe('running');
  });
});

describe('removeIndicator clears stuck running', () => {
  it('clears status when script is removed mid-run', async () => {
    const { removeIndicator, addIndicator } = await import('../src/store');
    let releaseSlow: (() => void) | null = null;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    restoreFetch = mockFetch(async () => {
      await slowGate;
      return jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => 1),
        series: { p: SAMPLE_BARS.map(() => 1) },
        events: [],
        meta: { script_name: 'slow', overlay: true },
      });
    });

    const id = addIndicator(
      'slow',
      '//@version=5\nindicator("s")\nplot(1)',
      'price',
      { p: { color: '#fff' } },
    );

    const p = runAndApply(
      '//@version=5\nindicator("s")\nplot(1)',
      id,
      { openResults: false, silent: false },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(store.status).toBe('running');

    removeIndicator(id);
    expect(store.status).not.toBe('running');
    expect(store.scripts.find((s) => s.id === id)).toBeUndefined();

    releaseSlow!();
    await p;
    // Must stay clear after the superseded run settles
    expect(store.status).not.toBe('running');
  });
});

describe('runAndApply never rejects', () => {
  it('returns error result when engine throws (no unhandled rejection)', async () => {
    restoreFetch = mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    // Must settle without rejecting — void fire-and-forget call sites rely on this
    const settled = await Promise.allSettled([
      runAndApply('plot(close)', undefined, { silent: true, openResults: false }),
    ]);
    expect(settled[0]?.status).toBe('fulfilled');
    if (settled[0]?.status === 'fulfilled') {
      expect(settled[0].value.status).toBe('error');
      expect(settled[0].value.error).toMatch(/Cannot reach|Failed to fetch|engine/i);
    }
  });

  it('headless success (no manager) still fulfills with series', async () => {
    restoreFetch = mockFetch(async () =>
      jsonResponse({
        status: 'success',
        plots: SAMPLE_BARS.map(() => 1),
        series: {
          plot: SAMPLE_BARS.map((_, i) => (i % 2 === 0 ? NaN : 2.5)),
        },
        events: [],
        meta: { script_name: 'headless', overlay: true },
      }),
    );
    const r = await runAndApply('plot(close)', undefined, {
      silent: true,
      openResults: false,
    });
    expect(r.status).toBe('success');
    // Non-finite samples coerced at normalize
    expect(r.series.plot?.[0]).toBeNull();
    expect(r.series.plot?.[1]).toBe(2.5);
  });
});

describe('lineSeriesToOverlayData hardening (plot-visuals)', () => {
  it('never emits NaN values', () => {
    const data = lineSeriesToOverlayData(
      [100, 200, 300, 400],
      [NaN, null, undefined, Infinity as unknown as number],
    );
    expect(data.every((d) => d.value === undefined || Number.isFinite(d.value))).toBe(true);
    expect(data.every((d) => d.value == null)).toBe(true);
  });

  it('coerces string numerics and rejects na', () => {
    const data = lineSeriesToOverlayData([1, 2, 3], ['1.5', 'na', '2']);
    expect(data[0]).toEqual({ time: 1, value: 1.5 });
    expect(data[1]).toEqual({ time: 2 });
    expect(data[2]).toEqual({ time: 3, value: 2 });
  });

  it('handles empty times', () => {
    expect(lineSeriesToOverlayData([], [1, 2])).toEqual([]);
  });

  it('pre-sized large arrays stay finite and dense', () => {
    const n = 5_000;
    const times = Array.from({ length: n }, (_, i) => 1_000 + i);
    const values = Array.from({ length: n }, (_, i) =>
      i % 100 === 0 ? NaN : i % 7 === 0 ? Infinity : i * 0.1,
    );
    const data = lineSeriesToOverlayData(times, values);
    expect(data.length).toBe(n);
    expect(data.every((d) => d.value === undefined || Number.isFinite(d.value!))).toBe(true);
    // Sample: first bar NaN → whitespace; second finite
    expect(data[0]).toEqual({ time: 1000 });
    expect(data[1]?.value).toBe(0.1);
  });
});
