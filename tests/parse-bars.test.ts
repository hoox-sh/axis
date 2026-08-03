/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * OHLCV CSV/text parse helpers for upload source.
 * Guards headerless/header rows, time formats, empty/invalid lines,
 * partial OHLCV, bad timestamps, and normalizeHistoricalBars.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseOhlcvText,
  parseOhlcvFile,
  normalizeBarTime,
  sanitizeBar,
  normalizeHistoricalBars,
} from '../src/data/parse-bars';

describe('parseOhlcvText', () => {
  it('parses headerless CSV', () => {
    const csv = `1700000000,1,2,0.5,1.5,10
1700086400,1.5,2.5,1,2,20`;
    const bars = parseOhlcvText(csv, 'data.csv');
    expect(bars).toHaveLength(2);
    expect(bars[0].open).toBe(1);
    expect(bars[1].close).toBe(2);
  });

  it('parses CSV with header', () => {
    const csv = `time,open,high,low,close,volume
2024-01-01T00:00:00Z,10,12,9,11,100`;
    const bars = parseOhlcvText(csv, 'x.csv');
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(11);
  });

  it('parses JSON array of objects', () => {
    const bars = parseOhlcvText(
      JSON.stringify([
        { time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 },
      ]),
      'x.json',
    );
    expect(bars[0].volume).toBe(9);
  });

  it('parses JSON { bars: [...] }', () => {
    const bars = parseOhlcvText(
      JSON.stringify({ bars: [[1700000000, 1, 2, 0.5, 1.5]] }),
      'x.json',
    );
    expect(bars).toHaveLength(1);
  });

  it('converts ms timestamps', () => {
    const bars = parseOhlcvText(
      JSON.stringify([{ t: 1700000000000, o: 1, h: 2, l: 0.5, c: 1.5 }]),
      'x.json',
    );
    expect(bars[0].time).toBe(1700000000);
  });

  it('throws on empty', () => {
    expect(() => parseOhlcvText('   ')).toThrow(/empty/i);
  });

  it('throws when no valid rows', () => {
    expect(() => parseOhlcvText('not,enough\n1,2', 'x.csv')).toThrow(/No valid/);
  });

  it('skips partial OHLCV rows and keeps valid ones', () => {
    const csv = `time,open,high,low,close
1700000000,1,2,0.5,1.5
1700000100,1,,,
1700000200,2,3,1,2.5
`;
    const bars = parseOhlcvText(csv, 'x.csv');
    expect(bars).toHaveLength(2);
    expect(bars[0]!.close).toBe(1.5);
    expect(bars[1]!.close).toBe(2.5);
  });

  it('skips bad timestamps (NaN, negative, empty)', () => {
    const json = JSON.stringify([
      { time: 'nope', open: 1, high: 2, low: 0.5, close: 1 },
      { time: -5, open: 1, high: 2, low: 0.5, close: 1 },
      { time: null, open: 1, high: 2, low: 0.5, close: 1 },
      { time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.2 },
    ]);
    const bars = parseOhlcvText(json, 'x.json');
    expect(bars).toHaveLength(1);
    expect(bars[0]!.close).toBe(1.2);
  });

  it('throws when every row is partial OHLCV', () => {
    expect(() =>
      parseOhlcvText(
        JSON.stringify([
          { time: 1, open: 1, high: null, low: 1, close: 1 },
          { open: 1, high: 1, low: 1, close: 1 },
        ]),
        'x.json',
      ),
    ).toThrow(/No valid/);
  });

  it('parseOhlcvFile reads File', async () => {
    const f = new File(
      ['[{"time":1,"open":1,"high":1,"low":1,"close":1}]'],
      'bars.json',
      { type: 'application/json' },
    );
    const bars = await parseOhlcvFile(f);
    expect(bars).toHaveLength(1);
  });
});

describe('normalizeBarTime', () => {
  it('converts ms and rejects junk', () => {
    expect(normalizeBarTime(1_700_000_000_000)).toBe(1_700_000_000);
    expect(normalizeBarTime(1_700_000_000)).toBe(1_700_000_000);
    expect(normalizeBarTime(NaN)).toBeNull();
    expect(normalizeBarTime(Infinity)).toBeNull();
    expect(normalizeBarTime(-1)).toBeNull();
    expect(normalizeBarTime(0)).toBeNull();
    expect(normalizeBarTime('')).toBeNull();
    expect(normalizeBarTime(null)).toBeNull();
    expect(normalizeBarTime('not-a-date')).toBeNull();
  });

  it('parses ISO strings', () => {
    const t = normalizeBarTime('2024-01-01T00:00:00Z');
    expect(t).toBeGreaterThan(1_700_000_000);
    expect(t!).toBeLessThan(1e12);
  });
});

describe('sanitizeBar', () => {
  it('returns null for partial / non-object', () => {
    expect(sanitizeBar(null)).toBeNull();
    expect(sanitizeBar(undefined)).toBeNull();
    expect(sanitizeBar('x')).toBeNull();
    expect(sanitizeBar([1, 2])).toBeNull();
    expect(sanitizeBar({ time: 1, open: 1, high: NaN, low: 1, close: 1 })).toBeNull();
    expect(sanitizeBar({ time: 1, open: 1, high: 1, low: 1 })).toBeNull(); // no close
  });

  it('repairs mild high/low vs open/close', () => {
    const b = sanitizeBar({
      time: 1700000000,
      open: 10,
      high: 9, // below open
      low: 11, // above open
      close: 10.5,
    });
    expect(b).not.toBeNull();
    expect(b!.high).toBeGreaterThanOrEqual(b!.open);
    expect(b!.high).toBeGreaterThanOrEqual(b!.close);
    expect(b!.low).toBeLessThanOrEqual(b!.open);
    expect(b!.low).toBeLessThanOrEqual(b!.close);
  });

  it('accepts array tuples', () => {
    const b = sanitizeBar([1700000000, 1, 2, 0.5, 1.5, 9]);
    expect(b).toEqual({
      time: 1700000000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 9,
    });
  });
});

describe('normalizeHistoricalBars', () => {
  it('returns empty for non-array / empty', () => {
    expect(normalizeHistoricalBars(null)).toEqual([]);
    expect(normalizeHistoricalBars(undefined)).toEqual([]);
    expect(normalizeHistoricalBars({})).toEqual([]);
    expect(normalizeHistoricalBars([])).toEqual([]);
  });

  it('drops invalid, sorts, dedupes, clamps limit', () => {
    const raw = [
      { time: 1700000300, open: 4, high: 5, low: 3, close: 4.5 },
      { time: 1700000200, open: 3, high: 4, low: 2, close: 3.5 },
      { time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 1700000000, open: 1.1, high: 2.1, low: 0.6, close: 1.6 }, // same t, last wins
      { time: NaN, open: 1, high: 1, low: 1, close: 1 },
      { time: 1700000100, open: 2, high: NaN, low: 1, close: 2 }, // partial → drop
    ];
    // Valid after sanitize+dedupe: t=0 (last), t=200, t=300 → limit 2 keeps newest
    const bars = normalizeHistoricalBars(raw, { limit: 2 });
    expect(bars).toHaveLength(2);
    expect(bars[0]!.time).toBe(1700000200);
    expect(bars[1]!.time).toBe(1700000300);
    expect(bars[0]!.close).toBe(3.5);
  });

  it('ms→seconds for all rows', () => {
    const bars = normalizeHistoricalBars([
      { time: 1_700_000_000_000, open: 1, high: 1, low: 1, close: 1 },
      { time: 1_700_086_400_000, open: 2, high: 2, low: 2, close: 2 },
    ]);
    expect(bars.every((b) => b.time < 1e12)).toBe(true);
    expect(bars[0]!.time).toBe(1_700_000_000);
  });
});
