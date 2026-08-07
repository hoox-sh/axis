/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain event helpers — TVL spike/drop derivation (`src/onchain/events.ts`).
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_TVL_SPIKE_THRESHOLD_PCT,
  EVENT_TYPE_TVL_DROP,
  EVENT_TYPE_TVL_SPIKE,
  buildTvlSpikeEvents,
  normalizeEventPoints,
  sortEventPoints,
  tvlSpikeEventSourceLabel,
  DEFILLAMA_RAISES_UNLOCKS_NOTE,
} from '../src/onchain/events';
import type { EventPoint, TimePoint } from '../src/onchain/types';

describe('buildTvlSpikeEvents', () => {
  it('emits spike and drop when |pct| >= default threshold', () => {
    // day0: 100 → day1: 120 (+20%) → day2: 90 (−25%)
    const points: TimePoint[] = [
      { time: 100, value: 100 },
      { time: 200, value: 120 },
      { time: 300, value: 90 },
    ];
    const events = buildTvlSpikeEvents(points);
    expect(DEFAULT_TVL_SPIKE_THRESHOLD_PCT).toBe(10);
    expect(events).toHaveLength(2);

    expect(events[0]!.type).toBe(EVENT_TYPE_TVL_SPIKE);
    expect(events[0]!.time).toBe(200);
    expect(events[0]!.price).toBe(120);
    expect(events[0]!.severity).toBe('warn'); // 20% < critical (~25)
    expect(events[0]!.payload?.pctChange).toBeCloseTo(20, 5);

    expect(events[1]!.type).toBe(EVENT_TYPE_TVL_DROP);
    expect(events[1]!.time).toBe(300);
    expect(events[1]!.price).toBe(90);
    expect(events[1]!.severity).toBe('critical'); // 25% >= critical
    expect(events[1]!.payload?.pctChange).toBeCloseTo(-25, 5);
  });

  it('respects custom thresholdPct and protocolLabel', () => {
    const points: TimePoint[] = [
      { time: 1, value: 1000 },
      { time: 2, value: 1050 }, // +5%
    ];
    expect(buildTvlSpikeEvents(points)).toEqual([]); // below 10%

    const events = buildTvlSpikeEvents(points, {
      thresholdPct: 5,
      protocolLabel: 'Aave',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(EVENT_TYPE_TVL_SPIKE);
    expect(events[0]!.title).toContain('Aave');
    expect(events[0]!.title).toMatch(/\+/);
  });

  it('skips non-finite values, zero prev, and short series', () => {
    expect(buildTvlSpikeEvents(null)).toEqual([]);
    expect(buildTvlSpikeEvents([])).toEqual([]);
    expect(buildTvlSpikeEvents([{ time: 1, value: 10 }])).toEqual([]);

    const points: TimePoint[] = [
      { time: 1, value: 0 },
      { time: 2, value: 100 }, // prev 0 → skip
      { time: 3, value: Number.NaN },
      { time: 4, value: 200 }, // only one finite after zero-prev
    ];
    // 0→100 skipped; NaN filtered out of series; only 100→200 if 0 removed…
    // After filter: (1,0), (2,100), (4,200). 0→100 skipped; 100→200 = +100%.
    const events = buildTvlSpikeEvents(points, { thresholdPct: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]!.time).toBe(4);
    expect(events[0]!.type).toBe(EVENT_TYPE_TVL_SPIKE);
  });

  it('sorts and dedupes input by time (last value wins)', () => {
    const points: TimePoint[] = [
      { time: 2, value: 200 },
      { time: 1, value: 100 },
      { time: 2, value: 110 }, // last for t=2
    ];
    // 100 → 110 = +10%
    const events = buildTvlSpikeEvents(points, { thresholdPct: 10 });
    expect(events).toHaveLength(1);
    expect(events[0]!.price).toBe(110);
    expect(events[0]!.payload?.prevValue).toBe(100);
  });

  it('uses criticalPct override for severity', () => {
    const points: TimePoint[] = [
      { time: 1, value: 100 },
      { time: 2, value: 130 }, // +30%
    ];
    const mild = buildTvlSpikeEvents(points, {
      thresholdPct: 10,
      criticalPct: 50,
    });
    expect(mild[0]!.severity).toBe('warn');

    const hot = buildTvlSpikeEvents(points, {
      thresholdPct: 10,
      criticalPct: 25,
    });
    expect(hot[0]!.severity).toBe('critical');
  });
});

describe('normalizeEventPoints / sortEventPoints', () => {
  it('drops invalid entries and sorts by time', () => {
    const raw: EventPoint[] = [
      { time: 300, type: 'b', title: 'later' },
      { time: Number.NaN, type: 'x' },
      { time: 100, type: '', title: 'no type' },
      { time: 100, type: 'a', severity: 'info', price: 1.5 },
      null as unknown as EventPoint,
    ];
    const out = normalizeEventPoints(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.type).toBe('a');
    expect(out[0]!.severity).toBe('info');
    expect(out[0]!.price).toBe(1.5);
    expect(out[1]!.type).toBe('b');
  });

  it('sortEventPoints handles empty', () => {
    expect(sortEventPoints(null)).toEqual([]);
    expect(sortEventPoints([])).toEqual([]);
  });
});

describe('tvlSpikeEventSourceLabel', () => {
  it('builds human labels', () => {
    expect(tvlSpikeEventSourceLabel()).toBe('TVL spikes');
    expect(tvlSpikeEventSourceLabel('aave')).toBe('aave TVL spikes');
    expect(tvlSpikeEventSourceLabel('Aave TVL')).toBe('Aave TVL spikes');
  });
});

describe('DEFILLAMA_RAISES_UNLOCKS_NOTE', () => {
  it('documents Pro API limitation', () => {
    expect(DEFILLAMA_RAISES_UNLOCKS_NOTE).toMatch(/Pro API/i);
  });
});
