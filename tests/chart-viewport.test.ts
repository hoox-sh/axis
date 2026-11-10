/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Default viewport: recent bars on a fresh load, and a small right margin
 * that a resume cannot stretch back out to the old 500-bar future.
 */

import { describe, expect, it } from 'bun:test';
import {
  CHART_RIGHT_OFFSET,
  DEFAULT_VISIBLE_BARS,
  capChartRightOffset,
  recentLogicalRange,
  showRecentLogicalRange,
  trimFutureOverhang,
} from '../src/chart/viewport';

describe('chart viewport', () => {
  it('opens on the newest bars plus a small right margin', () => {
    const range = recentLogicalRange(1_000);
    expect(range.to - range.from).toBe(DEFAULT_VISIBLE_BARS + CHART_RIGHT_OFFSET);
    expect(range.to).toBe(999 + CHART_RIGHT_OFFSET);
    expect(range.from).toBe(range.to - DEFAULT_VISIBLE_BARS - CHART_RIGHT_OFFSET);
  });

  it('uses every bar when the history is shorter than the default zoom', () => {
    const range = recentLogicalRange(40);
    expect(range.from).toBe(0);
    expect(range.to).toBe(39 + CHART_RIGHT_OFFSET);
  });

  it('trims a 500-bar future tail without moving the left edge', () => {
    const trimmed = trimFutureOverhang({ from: 20, to: 400 + 500 }, 400);
    expect(trimmed).toEqual({ from: 20, to: 399 + CHART_RIGHT_OFFSET });
  });

  it('caps a stuck right offset and shows the recent bars', () => {
    let offset = 500;
    let range: { from: number; to: number } | null = null;
    const chart = {
      timeScale: () => ({
        options: () => ({ rightOffset: offset }),
        applyOptions: (opts: { rightOffset: number }) => {
          offset = opts.rightOffset;
        },
        setVisibleLogicalRange: (next: { from: number; to: number }) => {
          range = next;
        },
      }),
    };
    capChartRightOffset(chart);
    expect(offset).toBe(CHART_RIGHT_OFFSET);
    showRecentLogicalRange(chart, 800);
    expect(range).toEqual(recentLogicalRange(800));
    expect(offset).toBe(CHART_RIGHT_OFFSET);
  });
});
