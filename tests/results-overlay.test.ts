/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import type { ResultMeta } from '../src/plugins/types';
import {
  countEvents,
  eventDir,
  filterEvents,
  isCloseEvent,
  savedRunSearchText,
  sortSavedRuns,
  sparklinePath,
  summarizeSeries,
} from '../src/results/overlay';
import type { StreamEventView } from '../src/results/strategy';

const ev = (patch: Partial<StreamEventView> & Record<string, unknown>): StreamEventView =>
  ({ time: 0, ...patch }) as unknown as StreamEventView;

const STREAM: StreamEventView[] = [
  ev({ type: 'entry', dir: 'long', id: 'L1', time: 100 }),
  ev({ type: 'entry', dir: 'short', id: 'S1', time: 200 }),
  ev({ type: 'close', dir: 'long', id: 'L2', time: 300 }),
  ev({ type: 'exit', dir: 'short', id: 'S2', time: 400 }),
];

describe('isCloseEvent / eventDir', () => {
  it('recognises close and exit kinds', () => {
    expect(isCloseEvent(ev({ type: 'close' }))).toBe(true);
    expect(isCloseEvent(ev({ type: 'exit' }))).toBe(true);
    expect(isCloseEvent(ev({ type: 'entry' }))).toBe(false);
    expect(isCloseEvent(ev({ event: 'order.close' }))).toBe(true);
  });
  it('falls back to direction and lowercases', () => {
    expect(eventDir(ev({ dir: 'LONG' }))).toBe('long');
    expect(eventDir(ev({ direction: 'Short' }))).toBe('short');
    expect(eventDir(ev({}))).toBe('');
  });
});

describe('filterEvents', () => {
  it('returns a copy for the default filter', () => {
    const out = filterEvents(STREAM);
    expect(out).toEqual(STREAM);
    expect(out).not.toBe(STREAM);
  });
  it('splits entries and exits', () => {
    expect(filterEvents(STREAM, { closesOnly: false }).map((e) => e.id)).toEqual(['L1', 'S1']);
    expect(filterEvents(STREAM, { closesOnly: true }).map((e) => e.id)).toEqual(['L2', 'S2']);
  });
  it('filters by direction', () => {
    expect(filterEvents(STREAM, { dir: 'long' }).map((e) => e.id)).toEqual(['L1', 'L2']);
    expect(filterEvents(STREAM, { dir: 'short' }).map((e) => e.id)).toEqual(['S1', 'S2']);
  });
  it('matches the query case-insensitively across kind, dir, and id', () => {
    expect(filterEvents(STREAM, { query: 'ENTRY' }).map((e) => e.id)).toEqual(['L1', 'S1']);
    expect(filterEvents(STREAM, { query: ' s2 ' }).map((e) => e.id)).toEqual(['S2']);
    expect(filterEvents(STREAM, { query: 'short' }).length).toBe(2);
    expect(filterEvents(STREAM, { query: 'nope' })).toEqual([]);
  });
  it('combines filters', () => {
    expect(filterEvents(STREAM, { dir: 'long', closesOnly: true }).map((e) => e.id)).toEqual([
      'L2',
    ]);
  });
  it('preserves chronological order', () => {
    const times = filterEvents(STREAM, { dir: 'long' }).map((e) => e.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('countEvents', () => {
  it('counts sides and directions', () => {
    expect(countEvents(STREAM)).toEqual({ all: 4, entries: 2, exits: 2, long: 2, short: 2 });
    expect(countEvents([])).toEqual({ all: 0, entries: 0, exits: 0, long: 0, short: 0 });
  });
});

const run = (patch: Partial<ResultMeta>): ResultMeta => ({
  scriptId: 'main.pine',
  runId: 'r1',
  startedAt: 1000,
  durationMs: 10,
  schemaVersion: 1,
  ...patch,
});

describe('savedRunSearchText', () => {
  it('includes label, kind, symbol, and timeframe', () => {
    const text = savedRunSearchText(
      run({
        label: 'Momentum',
        scriptKind: 'strategy',
        inputs: { symbol: 'ETHUSDT', timeframe: '1h' },
      }),
    );
    expect(text).toContain('momentum');
    expect(text).toContain('strategy');
    expect(text).toContain('ethusdt');
    expect(text).toContain('1h');
  });
});

describe('sortSavedRuns', () => {
  const runs = [
    run({ runId: 'a', startedAt: 100, stats: { totalPnl: 10, winRate: 40, trades: 5 } }),
    run({ runId: 'b', startedAt: 300, stats: { totalPnl: 90, winRate: 20, trades: 9 } }),
    run({ runId: 'c', startedAt: 200, stats: { totalPnl: -5, winRate: 80, trades: 2 } }),
    run({ runId: 'd', startedAt: 400 }),
  ];

  it('keeps backend order for newest', () => {
    expect(sortSavedRuns(runs, 'newest').map((r) => r.runId)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('sorts oldest first', () => {
    expect(sortSavedRuns(runs, 'oldest').map((r) => r.runId)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('sorts by net pnl desc with missing stats last', () => {
    expect(sortSavedRuns(runs, 'pnl').map((r) => r.runId)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('sorts by win rate and trades', () => {
    expect(sortSavedRuns(runs, 'winrate').map((r) => r.runId)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortSavedRuns(runs, 'trades').map((r) => r.runId)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('filters by query before sorting', () => {
    const labelled = [
      run({ runId: 'x', label: 'Alpha', startedAt: 1 }),
      run({ runId: 'y', label: 'Beta', startedAt: 2 }),
    ];
    expect(sortSavedRuns(labelled, 'newest', 'alp').map((r) => r.runId)).toEqual(['x']);
    expect(sortSavedRuns(labelled, 'newest', 'zzz')).toEqual([]);
  });
  it('does not mutate the input', () => {
    const input = [...runs];
    sortSavedRuns(input, 'pnl');
    expect(input.map((r) => r.runId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('summarizeSeries', () => {
  it('computes min, max, ends, and change', () => {
    const s = summarizeSeries([10, null, 4, 18, 12]);
    expect(s.count).toBe(4);
    expect(s.first).toBe(10);
    expect(s.last).toBe(12);
    expect(s.min).toBe(4);
    expect(s.max).toBe(18);
    expect(s.change).toBe(2);
    expect(s.changePct).toBeCloseTo(20);
  });
  it('handles empty and all-null series', () => {
    expect(summarizeSeries([])).toEqual({
      count: 0,
      first: null,
      last: null,
      min: null,
      max: null,
      change: null,
      changePct: null,
    });
    expect(summarizeSeries([null, null]).count).toBe(0);
  });
  it('leaves the percent null when the first sample is zero', () => {
    const s = summarizeSeries([0, 5]);
    expect(s.change).toBe(5);
    expect(s.changePct).toBeNull();
  });
  it('does not overflow on long series', () => {
    const long = Array.from({ length: 150_000 }, (_, i) => i % 97);
    expect(summarizeSeries(long).count).toBe(150_000);
  });
});

describe('sparklinePath', () => {
  it('draws a path with two or more finite samples', () => {
    const d = sparklinePath([1, 2, 3]);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.split(' L ').length).toBe(3);
  });
  it('returns empty for fewer than two samples', () => {
    expect(sparklinePath([])).toBe('');
    expect(sparklinePath([5])).toBe('');
    expect(sparklinePath([null, null])).toBe('');
  });
  it('skips nulls without breaking the argument count', () => {
    const d = sparklinePath([1, null, 3, null, 2]);
    expect(d.split(' L ').length).toBe(3);
  });
  it('keeps every point inside the box', () => {
    const d = sparklinePath([0, 100, 50], { w: 100, h: 34, pad: 3 });
    const nums = d.match(/-?\d+\.\d+/g)?.map(Number) ?? [];
    for (const n of nums) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(97);
    }
  });
  it('flattens a constant series to the middle band', () => {
    const d = sparklinePath([7, 7, 7]);
    expect(d).not.toBe('');
    expect(d).not.toContain('NaN');
  });
});
