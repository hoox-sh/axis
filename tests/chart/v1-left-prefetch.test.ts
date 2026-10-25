/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  nearLeftEdge,
  olderPage,
  shiftRangeForPrepend,
} from '../../src/chart/v1/left-prefetch';
import type { Bar } from '../../src/store/types';

const bar = (time: number): Bar => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 1,
});

describe('left-edge prefetch', () => {
  test('arms only when the viewport is within the margin', () => {
    expect(nearLeftEdge({ from: 10, to: 80 }, 64)).toBe(true);
    expect(nearLeftEdge({ from: 64, to: 120 }, 64)).toBe(false);
    expect(nearLeftEdge(null)).toBe(false);
  });

  test('takes the page immediately before the chart head', () => {
    const dataset = Array.from({ length: 8 }, (_, i) => bar(i + 1));
    const page = olderPage(dataset, 6, 3);
    expect(page.map((b) => b.time)).toEqual([3, 4, 5]);
  });

  test('shifts the logical range by the bars inserted on the left', () => {
    expect(shiftRangeForPrepend({ from: 4, to: 40 }, 500)).toEqual({ from: 504, to: 540 });
  });
});
