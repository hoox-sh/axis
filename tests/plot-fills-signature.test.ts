/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  fillBandRunBounds,
  linefillQuadCorners,
  plotFillsSignature,
} from '../src/chart/drawing-layer';

describe('plotFillsSignature', () => {
  it('is empty for no fills', () => {
    expect(plotFillsSignature([])).toBe('');
  });

  it('matches identical tips/lengths', () => {
    const f = {
      name: 'band',
      times: [1, 2, 3],
      upper: [10, 11, 12],
      lower: [1, 2, 3],
      color: 'rgba(1,2,3,0.2)',
    };
    expect(plotFillsSignature([f])).toBe(plotFillsSignature([{ ...f }]));
  });

  it('changes when length or tip values change', () => {
    const a = plotFillsSignature([
      { name: 'b', times: [1, 2], upper: [1, 2], lower: [0, 1], color: 'x' },
    ]);
    const b = plotFillsSignature([
      { name: 'b', times: [1, 2, 3], upper: [1, 2, 3], lower: [0, 1, 2], color: 'x' },
    ]);
    const c = plotFillsSignature([
      { name: 'b', times: [1, 2], upper: [1, 9], lower: [0, 1], color: 'x' },
    ]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('changes when last-bar fill color changes', () => {
    const base = {
      name: 'cloud',
      times: [1, 2, 3],
      upper: [10, 11, 12],
      lower: [1, 2, 3],
      color: 'green',
    };
    const a = plotFillsSignature([{ ...base, colors: ['green', 'green', 'green'] }]);
    const b = plotFillsSignature([{ ...base, colors: ['green', 'green', 'red'] }]);
    expect(a).not.toBe(b);
  });
});

describe('fillBandRunBounds', () => {
  it('splits on na and on color change', () => {
    const upper = [1, 2, 3, 4, 5, 6];
    const lower = [0, 1, 2, 3, 4, 5];
    const times = [1, 2, 3, 4, 5, 6];
    const colors = ['a', 'a', null, 'b', 'b', 'c'];
    // index 2 is na on color but still finite edges — color '' vs 'a' splits;
    // actually colorAt(2) is '' so after two 'a's, '' starts a new run.
    const runs = fillBandRunBounds(6, upper, lower, times, colors);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const flipped = fillBandRunBounds(
      4,
      [1, 2, 3, 4],
      [0, 1, 2, 3],
      [1, 2, 3, 4],
      ['green', 'green', 'red', 'red'],
    );
    expect(flipped).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });
});

describe('linefillQuadCorners', () => {
  it('orders opposite-direction lines so the quad does not bowtie', () => {
    // line1 left→right, line2 right→left
    const c = linefillQuadCorners(100, 10, 200, 12, 200, 7, 100, 5);
    expect(c[0]).toEqual({ time: 100, price: 10 });
    expect(c[1]).toEqual({ time: 200, price: 12 });
    expect(c[2]).toEqual({ time: 200, price: 7 });
    expect(c[3]).toEqual({ time: 100, price: 5 });
  });
});
