/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing tool metadata: click counts (`needsTwoPoints`), labels, fib levels.
 * Invariant: single-click tools (hline/text/cursor) vs multi-point geometry tools.
 */

import { describe, expect, it } from 'bun:test';
import {
  FIB_LEVELS,
  needsNPoints,
  needsThreePoints,
  needsTwoPoints,
  resolveDrawingStyle,
  toolArity,
  toolLabel,
  type DrawingToolId,
} from '../src/chart/drawing-types.ts';
import { fibPrices as computeFib } from '../src/chart/drawing-layer.ts';
import {
  getToolHandler,
  listToolHandlers,
} from '../src/chart/drawings/tools';
import { TOOL_GROUPS } from '../src/chart/drawings/tool-catalog.ts';

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
    expect(needsTwoPoints('long')).toBe(true);
    expect(needsThreePoints('channel')).toBe(true);
    expect(needsThreePoints('fibext')).toBe(true);
    expect(needsThreePoints('pitchfork')).toBe(true);
    expect(needsNPoints('polyline')).toBe(true);
    expect(needsNPoints('brush')).toBe(true);
    expect(toolArity('eraser')).toBe(0);
    expect(toolArity('crossline')).toBe(1);
  });

  it('toolLabel covers all tools', () => {
    const tools: DrawingToolId[] = [
      'cursor',
      'hline',
      'vline',
      'hray',
      'crossline',
      'trend',
      'ray',
      'extend',
      'infoLine',
      'trendAngle',
      'channel',
      'pitchfork',
      'rect',
      'ellipse',
      'arrow',
      'triangle',
      'polyline',
      'path',
      'brush',
      'highlighter',
      'fib',
      'fibext',
      'fibtime',
      'fibchannel',
      'measure',
      'dateRange',
      'priceRange',
      'text',
      'priceLabel',
      'callout',
      'note',
      'long',
      'short',
      'eraser',
    ];
    for (const t of tools) {
      expect(toolLabel(t).length).toBeGreaterThan(0);
    }
    expect(toolLabel('hline')).toMatch(/Horizontal/i);
    expect(toolLabel('vline')).toMatch(/Vertical/i);
    expect(toolLabel('extend')).toMatch(/Extended/i);
    expect(toolLabel('fib')).toMatch(/Fib/i);
    expect(toolLabel('channel')).toMatch(/channel/i);
    expect(toolLabel('pitchfork')).toMatch(/Pitchfork/i);
  });

  it('registers extended tool handlers', () => {
    const ids = listToolHandlers().map((h) => h.id);
    expect(ids).toContain('channel');
    expect(ids).toContain('fibext');
    expect(ids).toContain('long');
    expect(ids).toContain('polyline');
    expect(ids).toContain('pitchfork');
    expect(ids).toContain('brush');
    expect(ids).toContain('callout');
    expect(getToolHandler('channel')?.arity).toBe(3);
    expect(getToolHandler('polyline')?.create?.([{ time: 1, price: 1 }, { time: 2, price: 2 }], '#fff')).toBeTruthy();
    expect(
      getToolHandler('pitchfork')?.create?.(
        [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
          { time: 2, price: 0 },
        ],
        '#fff',
      ),
    ).toBeTruthy();
  });

  it('toolbar catalog exposes parity packs', () => {
    const all = TOOL_GROUPS.flatMap((g) => g.tools);
    expect(all).toContain('channel');
    expect(all).toContain('fibext');
    expect(all).toContain('long');
    expect(all).toContain('dateRange');
    expect(all).toContain('eraser');
    expect(all).toContain('pitchfork');
    expect(all).toContain('highlighter');
    expect(all).toContain('callout');
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

describe('drawing layer placement guards', () => {
  it('n-point tools expose minPoints and create null for too few points', () => {
    const poly = getToolHandler('polyline');
    expect(poly?.minPoints).toBe(2);
    expect(poly?.create?.([{ time: 1, price: 1 }], '#fff')).toBeNull();
    const ok = poly?.create?.(
      [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
      ],
      '#fff',
    );
    expect(ok?.kind).toBe('polyline');
  });

  it('resolveDrawingStyle.locked reads dual lock fields (eraser / delete gate)', () => {
    expect(
      resolveDrawingStyle({ id: 'a', kind: 'hline', color: '#fff', locked: true } as never).locked,
    ).toBe(true);
    expect(
      resolveDrawingStyle({
        id: 'b',
        kind: 'hline',
        color: '#fff',
        meta: { locked: true },
      } as never).locked,
    ).toBe(true);
  });
});
