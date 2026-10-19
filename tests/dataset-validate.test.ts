// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'bun:test';
import {
  repairBars,
  classifyGaps,
  validateDataset,
  findClassifiedGaps,
  venueClassForSourceCaps,
} from '../src/data/dataset-validate';
import type { BarGap } from '../src/data/bars-gaps';
import { findBarGaps } from '../src/data/bars-gaps';
import type { Bar } from '../src/store/types';

function bar(t: number, close = 1.5): Bar {
  return { time: t, open: 1, high: 2, low: 0.5, close, volume: 1 };
}
function badBar(t: number): Record<string, unknown> {
  return { time: t, open: NaN, high: 2, low: 0.5, close: 1.5 };
}

// 2026-09-05 is a Saturday, 2026-09-06 a Sunday (UTC)
const SAT = Date.UTC(2026, 8, 5) / 1000;
const SUN = Date.UTC(2026, 8, 6) / 1000;
const MON = Date.UTC(2026, 8, 7) / 1000;
const TUE = Date.UTC(2026, 8, 8) / 1000;
const DAY = 86_400;

describe('dataset-validate · repairBars', () => {
  it('drops corrupt rows and keeps valid ones', () => {
    const res = repairBars([bar(60), badBar(120), bar(180)], '1m');
    expect(res.bars.map((b) => b.time)).toEqual([60, 180]);
    expect(res.stats.removed).toBe(1);
  });

  it('snaps individually off-phase bars to the dominant phase', () => {
    // 1h series on the :00 phase; one bar drifted to :05
    const step = 3600;
    const t0 = 1_788_000_000; // arbitrary epoch, on no particular phase
    const onPhase = (i: number) => t0 + i * step;
    const drifted = onPhase(3) + 300;
    const res = repairBars(
      [bar(onPhase(0)), bar(onPhase(1)), bar(onPhase(2)), bar(drifted), bar(onPhase(4))],
      '1h',
    );
    expect(res.bars.map((b) => b.time)).toContain(onPhase(3));
    expect(res.bars.map((b) => b.time)).not.toContain(drifted);
    expect(res.stats.snapped).toBe(1);
  });

  it('preserves consistent venue phase offsets (no epoch snapping)', () => {
    // Daily series opening at 08:00 UTC — a legitimate phase offset
    const step = 86_400;
    const t0 = Date.UTC(2026, 0, 1, 8) / 1000;
    const res = repairBars([bar(t0), bar(t0 + step), bar(t0 + 2 * step)], '1d');
    expect(res.bars.map((b) => b.time)).toEqual([t0, t0 + step, t0 + 2 * step]);
    expect(res.stats.snapped).toBe(0);
  });

  it('skips snapping when there is no dominant phase (too little signal)', () => {
    const res = repairBars([bar(65), bar(185)], '1m');
    expect(res.stats.snapped).toBe(0);
    expect(res.bars.map((b) => b.time)).toEqual([65, 185]);
  });

  it('dedupes by open time (first wins) and sorts', () => {
    const res = repairBars([bar(180), bar(60), bar(60)], '1m');
    expect(res.bars.map((b) => b.time)).toEqual([60, 180]);
    expect(res.stats.deduped).toBe(1);
    expect(res.stats.reordered).toBe(1);
  });

  it('never throws on garbage input', () => {
    expect(repairBars(null as never, '1m').bars).toEqual([]);
    expect(repairBars([undefined, 'x', 42] as never, '1m').bars).toEqual([]);
  });

  it('snap can be disabled', () => {
    const res = repairBars([bar(65)], '1m', { snapToGrid: false });
    expect(res.bars[0]!.time).toBe(65);
    expect(res.stats.snapped).toBe(0);
  });

  it('never drops a bar when the snap target is occupied', () => {
    // A venue that stamps some bars half an hour late: the repair used to move
    // the odd bar onto the NEXT hour, collide with the bar that already lived
    // there, and the dedupe then deleted one of them — losing a real venue
    // bar and shifting another one's OHLCV onto the wrong candle. The hole it
    // left was reported as a fillable gap the DSM chased forever.
    const step = 3_600;
    const t0 = 1_788_000_000 - (1_788_000_000 % step);
    const bars = Array.from({ length: 12 }, (_, i) => bar(t0 + i * step, 100 + i));
    // Bar 5 arrives stamped 30 minutes late — in addition to the real one.
    const drifted = bar(t0 + 5 * step + 1_800, 105);
    const input = [...bars.slice(0, 5), drifted, ...bars.slice(5)];

    const res = repairBars(input, '1h');
    // No venue bar is lost and no OHLCV is shifted onto another candle.
    expect(res.bars).toHaveLength(input.length);
    expect(res.stats.deduped).toBe(0);
    expect(res.bars.find((b) => b.time === t0 + 6 * step)!.close).toBe(106);
    // The odd bar keeps its own timestamp — the series is still dense enough
    // that no phantom gap is reported.
    expect(res.bars.some((b) => b.time === t0 + 5 * step + 1_800)).toBe(true);
    expect(findBarGaps(res.bars, t0, t0 + 11 * step, '1h')).toEqual([]);
  });

  it('snaps an off-phase bar into its own free slot', () => {
    // The venue sent one bar per slot, but one of them carries the wrong
    // stamp: the repair moves it back into its own hour, which is free.
    const step = 3_600;
    const t0 = 1_788_000_000 - (1_788_000_000 % step);
    const bars = Array.from({ length: 12 }, (_, i) => bar(t0 + i * step, 100 + i));
    bars[5] = bar(t0 + 5 * step + 1_800, 105);

    const res = repairBars(bars, '1h');
    expect(res.bars).toHaveLength(12);
    expect(res.stats.snapped).toBe(1);
    expect(res.bars.map((b) => b.time)).toEqual(bars.map((_, i) => t0 + i * step));
    // The bar keeps its own OHLCV.
    expect(res.bars[5]!.close).toBe(105);
    expect(res.bars[6]!.close).toBe(106);
  });

  it('is idempotent — a second repair pass changes nothing', () => {
    const step = 3_600;
    const t0 = 1_788_000_000 - (1_788_000_000 % step);
    const bars = Array.from({ length: 8 }, (_, i) => bar(t0 + i * step, 100 + i));
    bars[3] = { ...bar(t0 + 3 * step + 1_800, 103) };
    const once = repairBars(bars, '1h');
    const twice = repairBars(once.bars, '1h');
    expect(twice.bars.map((b) => b.time)).toEqual(once.bars.map((b) => b.time));
    expect(twice.stats.snapped).toBe(0);
    expect(twice.stats.deduped).toBe(0);
  });

  it('keeps the newest write when two rows share an open time', () => {
    const a = { ...bar(60, 1) };
    const b = { ...bar(60, 2) };
    const res = repairBars([a, b], '1m');
    expect(res.bars).toHaveLength(1);
    expect(res.bars[0]!.close).toBe(2);
    expect(res.stats.deduped).toBe(1);
  });
});

describe('dataset-validate · classifyGaps', () => {
  const weekendGap: BarGap = { fromSec: SAT, toSec: SUN, missingBars: 2 };
  const weekdayGap: BarGap = { fromSec: MON, toSec: MON, missingBars: 1 };

  it('24/7 venues treat weekend holes as fillable', () => {
    const { fillable, legitimate } = classifyGaps([weekendGap], '1d');
    expect(fillable).toHaveLength(1);
    expect(legitimate).toHaveLength(0);
  });

  it('session venues excuse weekend holes at daily+ intervals', () => {
    const { fillable, legitimate } = classifyGaps([weekendGap], '1d', {
      venueClass: 'sessions',
    });
    expect(fillable).toHaveLength(0);
    expect(legitimate).toHaveLength(1);
  });

  it('session venues excuse a Friday closure (Fri → Mon)', () => {
    // A session venue is closed from Friday's close to Monday's open, so a
    // missing Friday bar belongs to that closure. Chasing it burned every gap
    // round and ended the job with "Partial: N gaps remain".
    const fri = Date.UTC(2026, 8, 4) / 1000; // 2026-09-04 is a Friday
    const gap: BarGap = { fromSec: fri, toSec: SUN, missingBars: 3 };
    const { fillable, legitimate } = classifyGaps([gap], '1d', { venueClass: 'sessions' });
    expect(fillable).toHaveLength(0);
    expect(legitimate).toHaveLength(1);
  });

  it('session venues still chase a missing Monday bar', () => {
    const gap: BarGap = { fromSec: SAT, toSec: MON, missingBars: 3 };
    const { fillable } = classifyGaps([gap], '1d', { venueClass: 'sessions' });
    expect(fillable).toHaveLength(1);
  });

  it('session venues still chase weekday holes', () => {
    const { fillable } = classifyGaps([weekdayGap], '1d', { venueClass: 'sessions' });
    expect(fillable).toHaveLength(1);
  });

  it('intraday session gaps are never excused by weekends', () => {
    const { fillable } = classifyGaps([weekendGap], '1h', { venueClass: 'sessions' });
    expect(fillable).toHaveLength(1);
  });

  it('maintenance windows excuse contained gaps for any venue', () => {
    const { fillable, legitimate } = classifyGaps([weekdayGap], '1d', {
      maintenanceWindows: [{ fromSec: MON - 60, toSec: MON + 60 }],
    });
    expect(fillable).toHaveLength(0);
    expect(legitimate).toHaveLength(1);
  });

  it('partially covered maintenance windows stay fillable', () => {
    const wide: BarGap = { fromSec: MON - DAY, toSec: MON + DAY, missingBars: 3 };
    const { fillable } = classifyGaps([wide], '1d', {
      maintenanceWindows: [{ fromSec: MON, toSec: MON }],
    });
    expect(fillable).toHaveLength(1);
  });
});

describe('dataset-validate · validateDataset', () => {
  it('reports complete when dense and no fillable gaps', () => {
    const bars = [bar(MON), bar(MON + DAY), bar(MON + 2 * DAY)];
    const rep = validateDataset(bars, MON, MON + 2 * DAY, '1d');
    expect(rep.complete).toBe(true);
    expect(rep.fillableGaps).toHaveLength(0);
    expect(rep.barCount).toBe(3);
  });

  it('marks incomplete with fillable gap but complete=false only via fillable', () => {
    const bars = [bar(MON), bar(MON + 2 * DAY)]; // hole at MON+1d
    const rep = validateDataset(bars, MON, MON + 2 * DAY, '1d');
    expect(rep.complete).toBe(false);
    expect(rep.fillableGaps).toHaveLength(1);
  });

  it('weekend hole does not block completeness for session venues', () => {
    const FRI = MON - 3 * DAY;
    const bars = [bar(FRI), bar(MON)]; // Sat+Sun missing
    const rep = validateDataset(bars, FRI, MON, '1d', { venueClass: 'sessions' });
    expect(rep.legitimateGaps).toHaveLength(1);
    expect(rep.fillableGaps).toHaveLength(0);
    expect(rep.complete).toBe(true);
  });

  it('findClassifiedGaps matches classifyGaps behavior', () => {
    const bars = [bar(MON), bar(MON + 2 * DAY)];
    const { fillable } = findClassifiedGaps(bars, MON, MON + 2 * DAY, '1d');
    expect(fillable).toHaveLength(1);
  });

  it('venueClassForSourceCaps defaults to 24/7 unless calendar is sessions', () => {
    expect(venueClassForSourceCaps(undefined)).toBe('24/7');
    expect(venueClassForSourceCaps({})).toBe('24/7');
    expect(venueClassForSourceCaps({ calendar: '24/7' })).toBe('24/7');
    expect(venueClassForSourceCaps({ calendar: 'sessions' })).toBe('sessions');
  });
});
