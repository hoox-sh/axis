/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { plotFillsSignature } from '../src/chart/drawing-layer';

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
});
