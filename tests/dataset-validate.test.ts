// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'bun:test';
import {
  repairBars,
  classifyGaps,
  validateDataset,
  findClassifiedGaps,
} from '../src/data/dataset-validate';
import type { BarGap } from '../src/data/bars-gaps';
import type { Bar } from '../src/store/types';

function bar(t: number): Bar {
  return { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
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

  it('snaps misaligned timestamps to the interval grid', () => {
    const res = repairBars([bar(65), bar(185)], '1m');
    expect(res.bars.map((b) => b.time)).toEqual([60, 180]);
    expect(res.stats.snapped).toBe(2);
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
});
