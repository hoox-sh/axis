// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'bun:test';
import {
  intervalToSec,
  alignDown,
  findBarGaps,
  validateBarCoverage,
  mergeGaps,
} from '../src/data/bars-gaps';
import type { Bar } from '../src/store/types';

function bar(t: number): Bar {
  return { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 };
}

describe('bars-gaps', () => {
  it('intervalToSec maps AXIS intervals', () => {
    expect(intervalToSec('1m')).toBe(60);
    expect(intervalToSec('1h')).toBe(3600);
    expect(intervalToSec('1d')).toBe(86_400);
    expect(intervalToSec('1w')).toBe(604_800);
  });

  it('alignDown floors to step', () => {
    expect(alignDown(100, 60)).toBe(60);
    expect(alignDown(120, 60)).toBe(120);
  });

  it('findBarGaps detects internal hole', () => {
    const step = 60;
    const from = 1000;
    const bars = [bar(1000), bar(1060), bar(1240), bar(1300)]; // hole 1120–1180
    const gaps = findBarGaps(bars, from, 1300, '1m');
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const g = gaps.find((x) => x.fromSec === 1120);
    expect(g).toBeTruthy();
    expect(g!.toSec).toBe(1180);
    expect(g!.missingBars).toBe(2);
    void step;
  });

  it('findBarGaps reports full-range hole when empty', () => {
    const gaps = findBarGaps([], 1000, 1300, '1m');
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.fromSec).toBe(1000);
    expect(gaps[0]!.missingBars).toBeGreaterThan(1);
  });

  it('findBarGaps leading and trailing', () => {
    // Window 0..300 step 60; only mid bars
    const bars = [bar(120), bar(180)];
    const gaps = findBarGaps(bars, 0, 300, '1m');
    expect(gaps.some((g) => g.fromSec === 0)).toBe(true);
    expect(gaps.some((g) => g.toSec === 300)).toBe(true);
  });

  it('validateBarCoverage complete when dense', () => {
    const step = 86_400;
    const from = 1_000_000_000;
    const bars: Bar[] = [];
    for (let i = 0; i < 10; i++) bars.push(bar(from + i * step));
    const report = validateBarCoverage(bars, from, from + 9 * step, '1d');
    expect(report.complete).toBe(true);
    expect(report.gaps).toHaveLength(0);
    expect(report.barCount).toBe(10);
  });

  it('validateBarCoverage incomplete with gap', () => {
    const step = 86_400;
    const from = 1_000_000_000;
    const bars = [bar(from), bar(from + step), bar(from + 4 * step)];
    const report = validateBarCoverage(bars, from, from + 4 * step, '1d');
    expect(report.complete).toBe(false);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it('mergeGaps coalesces adjacent', () => {
    const merged = mergeGaps(
      [
        { fromSec: 0, toSec: 100, missingBars: 2 },
        { fromSec: 100, toSec: 200, missingBars: 2 },
      ],
      60,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.fromSec).toBe(0);
    expect(merged[0]!.toSec).toBe(200);
  });
});
