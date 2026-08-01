// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure debug-pin parsing: bar_index/time extraction, pin collapse, LWC markers.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseBarIndexFromText,
  parseTimeFromText,
  normalizePinTime,
  resolveDebugPinTarget,
  pinsFromDebugEntries,
  debugPinsToMarkers,
  pinsFromLastRun,
  type DebugPin,
} from '../src/results/debug-pins.ts';

describe('parseBarIndexFromText', () => {
  it('parses common bar_index patterns', () => {
    expect(parseBarIndexFromText('value at bar_index=12')).toBe(12);
    expect(parseBarIndexFromText('bar_index: 7 foo')).toBe(7);
    expect(parseBarIndexFromText('barIndex=3')).toBe(3);
    expect(parseBarIndexFromText('[bar 5] signal')).toBe(5);
    expect(parseBarIndexFromText('bar: 9 closed')).toBe(9);
    expect(parseBarIndexFromText('crossover @ 42')).toBe(42);
  });

  it('returns null when absent', () => {
    expect(parseBarIndexFromText('no bar here')).toBeNull();
    expect(parseBarIndexFromText('')).toBeNull();
    expect(parseBarIndexFromText('line 12 error')).toBeNull();
  });
});

describe('parseTimeFromText', () => {
  it('parses time / ts / bar_time', () => {
    expect(parseTimeFromText('time=1700000000')).toBe(1700000000);
    expect(parseTimeFromText('ts: 99')).toBe(99);
    expect(parseTimeFromText('bar_time=1234.5')).toBe(1234.5);
  });

  it('returns null when absent', () => {
    expect(parseTimeFromText('hello world')).toBeNull();
  });
});

describe('normalizePinTime', () => {
  it('converts ms to seconds', () => {
    expect(normalizePinTime(1_700_000_000_000)).toBe(1_700_000_000);
    expect(normalizePinTime(1_700_000_000)).toBe(1_700_000_000);
    expect(normalizePinTime(null)).toBeNull();
    expect(normalizePinTime(NaN)).toBeNull();
  });
});

describe('resolveDebugPinTarget', () => {
  const bars = [{ time: 100 }, { time: 200 }, { time: 300 }];

  it('resolves time from barIndex', () => {
    expect(resolveDebugPinTarget({ barIndex: 1 }, bars)).toEqual({
      time: 200,
      barIndex: 1,
    });
  });

  it('resolves barIndex from exact time', () => {
    expect(resolveDebugPinTarget({ time: 300 }, bars)).toEqual({
      time: 300,
      barIndex: 2,
    });
  });

  it('picks nearest bar when time is off', () => {
    expect(resolveDebugPinTarget({ time: 210 }, bars).barIndex).toBe(1);
  });

  it('works without bars', () => {
    expect(resolveDebugPinTarget({ barIndex: 4, time: null })).toEqual({
      time: null,
      barIndex: 4,
    });
  });
});

describe('pinsFromDebugEntries', () => {
  it('uses structured barIndex / time', () => {
    const pins = pinsFromDebugEntries([
      { level: 'info', message: 'ok', barIndex: 3, time: 1000 },
      { level: 'error', message: 'boom', bar_index: 10 },
    ]);
    expect(pins).toHaveLength(2);
    expect(pins[0]).toMatchObject({ barIndex: 3, time: 1000, level: 'info' });
    expect(pins[1]).toMatchObject({ barIndex: 10, level: 'error' });
  });

  it('parses bar_index from message when field missing', () => {
    const pins = pinsFromDebugEntries([
      { level: 'warning', message: 'rsi high bar_index=55' },
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.barIndex).toBe(55);
    expect(pins[0]!.level).toBe('warning');
  });

  it('skips entries with no bar/time (graceful)', () => {
    const pins = pinsFromDebugEntries([
      { level: 'info', message: 'hello only' },
      { level: 'error', message: 'line 8 fail' },
    ]);
    expect(pins).toEqual([]);
  });

  it('keeps line-only when includeLineOnly', () => {
    const pins = pinsFromDebugEntries(
      [{ level: 'error', message: 'x', line: 8 }],
      { includeLineOnly: true },
    );
    expect(pins).toHaveLength(1);
    expect(pins[0]!.line).toBe(8);
    expect(pins[0]!.label).toBe('L8');
  });

  it('collapses same bar to highest severity', () => {
    const pins = pinsFromDebugEntries([
      { level: 'info', message: 'a', barIndex: 1 },
      { level: 'error', message: 'b', barIndex: 1 },
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.level).toBe('error');
    expect(pins[0]!.message).toBe('b');
  });

  it('resolves times via bars option', () => {
    const bars = [{ time: 10 }, { time: 20 }, { time: 30 }];
    const pins = pinsFromDebugEntries([{ message: 'x', barIndex: 2 }], { bars });
    expect(pins[0]!.time).toBe(30);
  });

  it('accepts InlineDebugAnnotation-like objects', () => {
    const pins = pinsFromDebugEntries([
      { line: 12, level: 'debug', message: 'v=1 bar_index=4', barIndex: 4 },
    ]);
    expect(pins[0]).toMatchObject({ line: 12, barIndex: 4, label: 'L12', level: 'debug' });
  });

  it('respects maxPins', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      message: `m${i}`,
      barIndex: i,
    }));
    expect(pinsFromDebugEntries(entries, { maxPins: 5 })).toHaveLength(5);
  });

  it('returns empty for null/empty input', () => {
    expect(pinsFromDebugEntries(null)).toEqual([]);
    expect(pinsFromDebugEntries([])).toEqual([]);
    expect(pinsFromDebugEntries(undefined)).toEqual([]);
  });
});

describe('debugPinsToMarkers', () => {
  it('maps pins with time to TradeMarker shape', () => {
    const pins: DebugPin[] = [
      { time: 100, barIndex: 0, label: 'L1', level: 'error', message: 'boom' },
      { time: 200, label: '#2', level: 'info' },
    ];
    const markers = debugPinsToMarkers(pins);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      time: 100,
      position: 'aboveBar',
      shape: 'circle',
      text: 'L1',
      color: '#e85d4c',
    });
    expect(markers[1]!.color).toBe('#8b8e9c');
  });

  it('drops pins without resolvable time', () => {
    expect(
      debugPinsToMarkers([{ barIndex: 3, label: '#3', level: 'info' }]),
    ).toEqual([]);
  });

  it('resolves barIndex via bars for markers', () => {
    const markers = debugPinsToMarkers(
      [{ barIndex: 1, label: 'L9', level: 'warning' }],
      [{ time: 50 }, { time: 60 }],
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]!.time).toBe(60);
    expect(markers[0]!.color).toBe('#e8a03a');
  });
});

describe('pinsFromLastRun', () => {
  it('extracts pins from engine logs payload', () => {
    const pins = pinsFromLastRun(
      {
        logs: [
          { level: 'info', message: 'a', barIndex: 1, time: 100 },
          { level: 'error', message: 'no pin' },
        ],
      },
      { bars: [{ time: 100 }, { time: 200 }] },
    );
    expect(pins.some((p) => p.barIndex === 1 && p.time === 100)).toBe(true);
    // message-only log has no bar/time
    expect(pins.every((p) => p.barIndex != null || p.time != null)).toBe(true);
  });

  it('merges annotations option', () => {
    const pins = pinsFromLastRun(
      { logs: [] },
      {
        annotations: [
          { line: 3, level: 'warning', message: 'w', barIndex: 7 },
        ],
      },
    );
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ line: 3, barIndex: 7, label: 'L3' });
  });
});
