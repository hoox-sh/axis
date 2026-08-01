/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing tool metadata: click counts (`needsTwoPoints`), labels, fib levels.
 * Invariant: single-click tools (hline/text/cursor) vs multi-point geometry tools.
 */

import { describe, expect, it } from 'bun:test';
import { FIB_LEVELS, needsTwoPoints, toolLabel } from '../src/chart/drawing-types.ts';
import { fibPrices as computeFib } from '../src/chart/drawing-layer.ts';

describe('drawing tools helpers', () => {
  it('needsTwoPoints for multi-click tools', () => {
    expect(needsTwoPoints('hline')).toBe(false);
    expect(needsTwoPoints('vline')).toBe(false);
    expect(needsTwoPoints('text')).toBe(false);
    expect(needsTwoPoints('cursor')).toBe(false);
    expect(needsTwoPoints('trend')).toBe(true);
    expect(needsTwoPoints('ray')).toBe(true);
    expect(needsTwoPoints('extend')).toBe(true);
    expect(needsTwoPoints('rect')).toBe(true);
    expect(needsTwoPoints('ellipse')).toBe(true);
    expect(needsTwoPoints('arrow')).toBe(true);
    expect(needsTwoPoints('fib')).toBe(true);
    expect(needsTwoPoints('measure')).toBe(true);
  });

  it('toolLabel covers all tools', () => {
    const tools = [
      'cursor',
      'hline',
      'vline',
      'trend',
      'ray',
      'extend',
      'rect',
      'ellipse',
      'arrow',
      'fib',
      'measure',
      'text',
    ] as const;
    for (const t of tools) {
      expect(toolLabel(t).length).toBeGreaterThan(0);
    }
    expect(toolLabel('hline')).toMatch(/Horizontal/i);
    expect(toolLabel('vline')).toMatch(/Vertical/i);
    expect(toolLabel('extend')).toMatch(/Extended/i);
    expect(toolLabel('fib')).toMatch(/Fib/i);
  });

  it('fibPrices from high to low (retracement)', () => {
    const levels = computeFib(100, 0);
    expect(levels).toHaveLength(FIB_LEVELS.length);
    expect(levels[0]).toBeCloseTo(100); // 0%
    expect(levels[levels.length - 1]).toBeCloseTo(0); // 100%
    expect(levels[3]).toBeCloseTo(50); // 50%
  });

  it('fibPrices from low to high', () => {
    const levels = computeFib(0, 100);
    expect(levels[0]).toBeCloseTo(0);
    expect(levels[levels.length - 1]).toBeCloseTo(100);
  });
});
