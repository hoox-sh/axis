/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure run-pipeline helpers: plot coercion, engine payload normalize,
 * user-readable errors, concurrent-run epochs.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  beginRunEpoch,
  claimRunStatus,
  coercePlotSample,
  currentRunEpoch,
  coerceSeriesSample,
  formatRunError,
  getRunStatusEpoch,
  isRunEpochCurrent,
  lineDataHasSample,
  normalizeBarTime,
  normalizeEngineResult,
  normalizeEventsArray,
  normalizePlotsArray,
  normalizeSeriesMap,
  ownsRunStatus,
  releaseRunStatus,
  seriesValuesToLineData,
  _resetRunEpochForTests,
} from '../src/indicators/run-helpers';

describe('coercePlotSample', () => {
  it('keeps finite numbers', () => {
    expect(coercePlotSample(0)).toBe(0);
    expect(coercePlotSample(-1.5)).toBe(-1.5);
    expect(coercePlotSample(42)).toBe(42);
  });

  it('maps null/undefined/NaN/Infinity to null', () => {
    expect(coercePlotSample(null)).toBeNull();
    expect(coercePlotSample(undefined)).toBeNull();
    expect(coercePlotSample(NaN)).toBeNull();
    expect(coercePlotSample(Infinity)).toBeNull();
    expect(coercePlotSample(-Infinity)).toBeNull();
  });

  it('coerces numeric strings; rejects na/nan/garbage', () => {
    expect(coercePlotSample('3.14')).toBe(3.14);
    expect(coercePlotSample('  -2 ')).toBe(-2);
    expect(coercePlotSample('na')).toBeNull();
    expect(coercePlotSample('NA')).toBeNull();
    expect(coercePlotSample('nan')).toBeNull();
    expect(coercePlotSample('null')).toBeNull();
    expect(coercePlotSample('')).toBeNull();
    expect(coercePlotSample('nope')).toBeNull();
    expect(coercePlotSample({})).toBeNull();
    expect(coercePlotSample(true)).toBeNull();
  });
});

describe('normalizeBarTime', () => {
  it('keeps unix seconds', () => {
    expect(normalizeBarTime(1_700_000_000)).toBe(1_700_000_000);
  });

  it('converts milliseconds to seconds', () => {
    expect(normalizeBarTime(1_700_000_000_000)).toBe(1_700_000_000);
  });

  it('rejects non-finite', () => {
    expect(normalizeBarTime(null)).toBeNull();
    expect(normalizeBarTime(NaN)).toBeNull();
    expect(normalizeBarTime('x')).toBeNull();
  });
});

describe('seriesValuesToLineData', () => {
  it('emits whitespace for null/NaN and values for finite samples', () => {
    const times = [100, 200, 300, 400];
    const values = [null, NaN, '1.5', 2];
    const data = seriesValuesToLineData(times, values);
    expect(data).toEqual([
      { time: 100 },
      { time: 200 },
      { time: 300, value: 1.5 },
      { time: 400, value: 2 },
    ]);
  });

  it('handles empty bars and empty/non-array series', () => {
    expect(seriesValuesToLineData([], [1, 2])).toEqual([]);
    expect(seriesValuesToLineData([1, 2], null)).toEqual([{ time: 1 }, { time: 2 }]);
    expect(seriesValuesToLineData([1], undefined)).toEqual([{ time: 1 }]);
  });

  it('pads shorter series with whitespace', () => {
    const data = seriesValuesToLineData([1, 2, 3], [9]);
    expect(data).toEqual([{ time: 1, value: 9 }, { time: 2 }, { time: 3 }]);
  });

  it('skips non-finite times', () => {
    const data = seriesValuesToLineData([1, NaN, 3], [10, 20, 30]);
    expect(data).toEqual([
      { time: 1, value: 10 },
      { time: 3, value: 30 },
    ]);
  });
});

describe('lineDataHasSample', () => {
  it('detects finite values vs pure whitespace', () => {
    expect(lineDataHasSample([{ time: 1 }, { time: 2 }])).toBe(false);
    expect(lineDataHasSample([{ time: 1, value: 0 }])).toBe(true);
    expect(lineDataHasSample([])).toBe(false);
  });
});

describe('coerceSeriesSample', () => {
  it('passes CSS color strings through untouched (bgcolor/barcolor)', () => {
    expect(coerceSeriesSample('rgba(8, 153, 129, 0.298)')).toBe('rgba(8, 153, 129, 0.298)');
    expect(coerceSeriesSample('#089981')).toBe('#089981');
    expect(coerceSeriesSample('#08998126')).toBe('#08998126');
    expect(coerceSeriesSample('hsla(120, 50%, 50%, 0.3)')).toBe('hsla(120, 50%, 50%, 0.3)');
    expect(coerceSeriesSample(' color(#abc / 50%) ')).toBe('color(#abc / 50%)');
  });

  it('still coerces numeric strings and rejects garbage', () => {
    expect(coerceSeriesSample('3.14')).toBe(3.14);
    expect(coerceSeriesSample('na')).toBeNull();
    expect(coerceSeriesSample('nope')).toBeNull();
    expect(coerceSeriesSample(null)).toBeNull();
  });
});

describe('normalizeSeriesMap / plots / events', () => {
  it('drops non-array series entries and coerces samples', () => {
    const m = normalizeSeriesMap({
      a: [1, '2', null, NaN, 'na'],
      bad: 'not-array',
      __internal: [1],
      _skip: [1],
    });
    expect(m).toEqual({ a: [1, 2, null, null, null] });
    expect(normalizeSeriesMap(null)).toEqual({});
    expect(normalizeSeriesMap([])).toEqual({});
  });

  it('keeps bgcolor color samples as strings; na → null', () => {
    const m = normalizeSeriesMap({
      bgcolor: ['rgba(8, 153, 129, 0.298)', 'na', null, '#ff0000'],
    });
    expect(m).toEqual({
      bgcolor: ['rgba(8, 153, 129, 0.298)', null, null, '#ff0000'],
    });
  });

  it('normalizes plots array', () => {
    expect(normalizePlotsArray([1, NaN, '3', null])).toEqual([1, null, 3, null]);
    expect(normalizePlotsArray(undefined)).toEqual([]);
    expect(normalizePlotsArray('x')).toEqual([]);
  });

  it('normalizes events with valid times only', () => {
    const ev = normalizeEventsArray([
      { time: 100, type: 'entry', price: 1 },
      { time: NaN, type: 'exit' },
      null,
      { type: 'order' },
      { time: 1_700_000_000_000, type: 'exit' },
    ]);
    expect(ev).toHaveLength(2);
    expect(ev[0]!.time).toBe(100);
    expect(ev[1]!.time).toBe(1_700_000_000);
  });

  it('keeps pyne parity events that only have bar_time (not time)', () => {
    // Engine StrategyEvent.to_dict() emits bar_time — dropping these emptyed
    // Results / chart markers / strategy report for every strategy run.
    const ev = normalizeEventsArray([
      {
        kind: 'entry',
        id: 'Long',
        direction: 'long',
        qty: 1,
        bar_index: 33,
        bar_time: 1_700_118_800,
        ohlc: [100, 102, 99, 101],
      },
      {
        kind: 'close',
        id: 'Long',
        qty: 1,
        bar_time: 1_700_180_000,
        ohlc: [110, 112, 109, 111],
      },
      {
        kind: 'close',
        id: 'X',
        // no time and no bar_time → drop
        qty: 0,
      },
    ]);
    expect(ev).toHaveLength(2);
    expect(ev[0]!.time).toBe(1_700_118_800);
    expect(ev[0]!.type).toBe('entry');
    expect(ev[0]!.kind).toBe('entry');
    expect(ev[1]!.time).toBe(1_700_180_000);
    expect(ev[1]!.type).toBe('close');
  });

  it('normalizeEngineResult preserves pyne strategy events for markers/report', () => {
    const r = normalizeEngineResult({
      status: 'success',
      series: {},
      events: [
        {
          kind: 'entry',
          id: 'L',
          direction: 'long',
          qty: 1,
          bar_time: 1_700_000_000,
          ohlc: [1, 1, 1, 100],
        },
        {
          kind: 'close',
          id: 'L',
          qty: 1,
          bar_time: 1_700_000_100,
          ohlc: [1, 1, 1, 110],
        },
      ],
    });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]!.time).toBe(1_700_000_000);
    expect(String(r.events[0]!.type || r.events[0]!.kind)).toMatch(/entry/i);
  });
});

describe('normalizeEngineResult', () => {
  it('fills empty containers for sparse success payloads', () => {
    const r = normalizeEngineResult({
      status: 'success',
      series: { close: [1, 2, NaN] },
    });
    expect(r.status).toBe('success');
    expect(r.plots).toEqual([]);
    expect(r.events).toEqual([]);
    expect(r.series.close).toEqual([1, 2, null]);
  });

  it('handles null/invalid raw without throwing', () => {
    const r = normalizeEngineResult(null);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/invalid|empty/i);
    expect(r.series).toEqual({});
  });

  it('maps error status + message fields', () => {
    const r = normalizeEngineResult({ status: 'error', message: 'parse fail' });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/parse fail/);
  });

  it('keeps success status when a non-fatal warning sits in error/message', () => {
    const r = normalizeEngineResult({
      status: 'success',
      series: { x: [1, 2] },
      error: 'deprecated argument',
    });
    expect(r.status).toBe('success');
  });

  it('infers error from error/message when status is missing', () => {
    const r = normalizeEngineResult({ series: {}, error: 'boom' });
    expect(r.status).toBe('error');
  });

  it('lifts top-level plot_meta / script_name into meta', () => {
    const r = normalizeEngineResult({
      status: 'success',
      series: {},
      plot_meta: { x: { kind: 'plot' } },
      script_name: 'Demo',
      overlay: false,
    });
    expect(r.meta?.plot_meta).toEqual({ x: { kind: 'plot' } });
    expect(r.meta?.script_name).toBe('Demo');
    expect(r.meta?.overlay).toBe(false);
  });
});

describe('formatRunError', () => {
  it('maps timeout wording', () => {
    expect(formatRunError('The operation was aborted due to timeout')).toMatch(/timed out/i);
    expect(formatRunError(new DOMException('Timeout', 'TimeoutError'))).toMatch(/timed out/i);
  });

  it('maps abort without timeout to cancelled', () => {
    expect(formatRunError(new DOMException('Aborted', 'AbortError'))).toMatch(/cancelled/i);
  });

  it('maps network failures', () => {
    expect(formatRunError('Failed to fetch')).toMatch(/Cannot reach/i);
    expect(formatRunError('NetworkError when attempting to fetch')).toMatch(/Cannot reach/i);
  });

  it('passes through script errors and truncates long blobs', () => {
    expect(formatRunError('line 3: undeclared identifier `foo`')).toMatch(/undeclared/);
    const long = 'x'.repeat(400);
    expect(formatRunError(long).length).toBeLessThanOrEqual(280);
  });

  it('handles empty / unknown', () => {
    expect(formatRunError(null)).toBe('Engine error');
    expect(formatRunError('')).toBe('Engine error');
  });
});

describe('run epoch', () => {
  beforeEach(() => {
    _resetRunEpochForTests();
  });

  it('advances and invalidates prior epochs', () => {
    expect(currentRunEpoch()).toBe(0);
    const a = beginRunEpoch();
    expect(isRunEpochCurrent(a)).toBe(true);
    const b = beginRunEpoch();
    expect(isRunEpochCurrent(a)).toBe(false);
    expect(isRunEpochCurrent(b)).toBe(true);
    expect(b).toBeGreaterThan(a);
  });
});

describe('run status ownership', () => {
  beforeEach(() => {
    _resetRunEpochForTests();
  });

  it('claim / owns / release track interactive Run ownership', () => {
    const e = beginRunEpoch();
    expect(getRunStatusEpoch()).toBeNull();
    claimRunStatus(e);
    expect(getRunStatusEpoch()).toBe(e);
    expect(ownsRunStatus(e)).toBe(true);
    expect(ownsRunStatus(e + 1)).toBe(false);
    releaseRunStatus(e);
    expect(getRunStatusEpoch()).toBeNull();
    expect(ownsRunStatus(e)).toBe(false);
  });

  it('release without epoch always clears; mismatched epoch keeps claim', () => {
    const e = beginRunEpoch();
    claimRunStatus(e);
    releaseRunStatus(e + 99);
    expect(getRunStatusEpoch()).toBe(e);
    releaseRunStatus();
    expect(getRunStatusEpoch()).toBeNull();
  });
});
