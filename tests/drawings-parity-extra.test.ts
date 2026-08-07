// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  getToolHandler,
  listToolHandlers,
} from '../src/chart/drawings/tools';
import { TOOL_GROUPS } from '../src/chart/drawings/tool-catalog';
import { toolArity, toolLabel, type DrawingToolId } from '../src/chart/drawing-types';

const EXTRA: DrawingToolId[] = [
  'gannFan',
  'gannBox',
  'gannSquare',
  'fibArc',
  'fibWedge',
  'fibCircles',
  'rotatedRect',
  'arc',
  'curve',
  'xabcd',
  'headShoulders',
  'flag',
  'anchoredText',
  'arrowMarkUp',
  'arrowMarkDown',
  'forecast',
  'datePriceRange',
];

describe('drawings parity extra packs', () => {
  it('registers all extra handlers', () => {
    const ids = new Set(listToolHandlers().map((h) => h.id));
    for (const id of EXTRA) {
      expect(ids.has(id)).toBe(true);
      expect(toolLabel(id).length).toBeGreaterThan(0);
    }
  });

  it('create() builds entities for 1/2/3/n tools', () => {
    const p = (t: number, price: number) => ({ time: t, price });
    expect(getToolHandler('gannFan')?.create?.([p(1, 1), p(2, 2)], '#fff')?.kind).toBe('gannFan');
    expect(getToolHandler('fibWedge')?.create?.([p(1, 1), p(2, 2), p(2, 0)], '#fff')?.kind).toBe(
      'fibWedge',
    );
    expect(getToolHandler('flag')?.create?.([p(1, 1)], '#fff')?.kind).toBe('flag');
    expect(
      getToolHandler('xabcd')?.create?.(
        [p(1, 1), p(2, 2), p(3, 1.5), p(4, 1.8), p(5, 1.2)],
        '#fff',
      )?.kind,
    ).toBe('xabcd');
    expect(getToolHandler('forecast')?.create?.([p(1, 1), p(2, 2)], '#fff')?.kind).toBe('forecast');
    expect(getToolHandler('datePriceRange')?.create?.([p(1, 1), p(2, 2)], '#fff')?.kind).toBe(
      'datePriceRange',
    );
  });

  it('arities match placement model', () => {
    expect(toolArity('flag')).toBe(1);
    expect(toolArity('gannFan')).toBe(2);
    expect(toolArity('fibWedge')).toBe(3);
    expect(toolArity('xabcd')).toBe('n');
    expect(toolArity('headShoulders')).toBe('n');
  });

  it('catalog lists extra tools', () => {
    const all = TOOL_GROUPS.flatMap((g) => g.tools);
    for (const id of EXTRA) {
      expect(all).toContain(id);
    }
  });
});
