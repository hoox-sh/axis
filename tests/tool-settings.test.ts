/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Per-tool drawing settings catalog + readers (fib levels, RR, extend).
 */

import { describe, expect, it } from 'bun:test';
import {
  ALL_DRAWING_KINDS,
  clampFontSize,
  clampRiskReward,
  defaultFibLevels,
  defaultKindPrefs,
  extendModeOf,
  fibLevelsOf,
  hasSetting,
  isDrawingKind,
  isTextEditableKind,
  positionStopPrice,
  resolvedPrefsForTool,
  sanitizeFibLevels,
  settingsForKind,
  widthsForKind,
} from '../src/chart/drawings/tool-settings.ts';
import { FIB_EXT_LEVELS, FIB_LEVELS, resolveDrawingStyle } from '../src/chart/drawing-types.ts';
import { fibPrices } from '../src/chart/drawing-layer.ts';
import { TOOL_GROUPS } from '../src/chart/drawings/tool-catalog.ts';
import { normalizeDrawing } from '../src/chart/drawings/normalize.ts';

describe('tool-settings catalog', () => {
  it('covers every persistable drawing kind', () => {
    const catalogKinds = new Set(
      TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => t !== 'cursor' && t !== 'eraser'),
    );
    expect(ALL_DRAWING_KINDS.length).toBe(catalogKinds.size);
    for (const kind of ALL_DRAWING_KINDS) {
      expect(catalogKinds.has(kind)).toBe(true);
      expect(settingsForKind(kind).has('color')).toBe(true);
      expect(settingsForKind(kind).has('width')).toBe(true);
      expect(isDrawingKind(kind)).toBe(true);
    }
    expect(settingsForKind('cursor').size).toBe(0);
    expect(settingsForKind('eraser').size).toBe(0);
  });

  it('assigns family-specific controls', () => {
    expect(hasSetting('trend', 'extendLeft')).toBe(true);
    expect(hasSetting('hray', 'extendRight')).toBe(true);
    expect(hasSetting('hray', 'extendLeft')).toBe(false);
    expect(hasSetting('rect', 'fillOpacity')).toBe(true);
    expect(hasSetting('fib', 'fibLevels')).toBe(true);
    expect(hasSetting('fib', 'reverse')).toBe(true);
    expect(hasSetting('text', 'fontSize')).toBe(true);
    expect(hasSetting('long', 'rr')).toBe(true);
    expect(hasSetting('arrow', 'arrowEnd')).toBe(true);
    expect(hasSetting('measure', 'showStats')).toBe(true);
    expect(hasSetting('hline', 'showPrice')).toBe(true);
  });

  it('kind defaults: ray extendRight, highlighter width, long rr', () => {
    expect(defaultKindPrefs('ray').extendRight).toBe(true);
    expect(defaultKindPrefs('extend').extendLeft).toBe(true);
    expect(defaultKindPrefs('highlighter').width).toBe(8);
    expect(defaultKindPrefs('long').rr).toBe(1);
    expect(defaultFibLevels('fib')).toEqual([...FIB_LEVELS]);
    expect(defaultFibLevels('fibext')).toEqual([...FIB_EXT_LEVELS]);
    expect(widthsForKind('highlighter')).toContain(8);
    expect(widthsForKind('trend')).toContain(1.5);
  });

  it('resolvedPrefsForTool merges byKind over globals and kind defaults', () => {
    const r = resolvedPrefsForTool(
      {
        color: '#ffffff',
        width: 1.5,
        lineStyle: 'solid',
        fillOpacity: 0.15,
        byKind: { highlighter: { color: '#ff00aa', width: 12 } },
      },
      'highlighter',
    );
    expect(r.color).toBe('#ff00aa');
    expect(r.width).toBe(12);
    expect(r.fillOpacity).toBe(0.35);
  });
});

describe('fib / RR helpers', () => {
  it('sanitizeFibLevels drops junk and caps length', () => {
    expect(sanitizeFibLevels([0, 0.5, 1, 'x', Infinity])).toEqual([0, 0.5, 1]);
    expect(sanitizeFibLevels([])).toEqual([...FIB_LEVELS]);
  });

  it('fibLevelsOf reads meta with kind fallback', () => {
    expect(fibLevelsOf({ kind: 'fib', meta: { fibLevels: [0, 0.5, 1] } })).toEqual([0, 0.5, 1]);
    expect(fibLevelsOf({ kind: 'fibext' }).length).toBeGreaterThan(3);
  });

  it('fibPrices honors custom levels and reverse', () => {
    const fwd = fibPrices(100, 200, [0, 1]);
    expect(fwd[0]).toBe(100);
    expect(fwd[1]).toBe(200);
    const rev = fibPrices(100, 200, [0, 1], true);
    expect(rev[0]).toBe(200);
    expect(rev[1]).toBe(100);
  });

  it('positionStopPrice uses rr (1:1 vs 2R)', () => {
    expect(positionStopPrice(100, 110, 1)).toBe(90);
    expect(positionStopPrice(100, 110, 2)).toBe(95);
    expect(clampRiskReward(99)).toBe(10);
    expect(clampFontSize(3)).toBe(8);
  });

  it('extendModeOf maps left/right flags', () => {
    expect(extendModeOf({ style: { extendLeft: true, extendRight: true } }, { extendLeft: false, extendRight: false })).toBe('both');
    expect(extendModeOf({ style: {} }, { extendLeft: false, extendRight: true })).toBe('right');
    expect(extendModeOf({ style: { extendLeft: false, extendRight: false } }, { extendLeft: true, extendRight: true })).toBe('none');
  });

  it('isTextEditableKind covers annotation tools', () => {
    expect(isTextEditableKind('text')).toBe(true);
    expect(isTextEditableKind('note')).toBe(true);
    expect(isTextEditableKind('trend')).toBe(false);
  });
});

describe('resolveDrawingStyle extras', () => {
  it('defaults ray extendRight and reads fontSize', () => {
    const ray = resolveDrawingStyle({ id: 'r', kind: 'ray', color: '#fff' } as never);
    expect(ray.extendRight).toBe(true);
    expect(ray.extendLeft).toBe(false);
    const txt = resolveDrawingStyle({
      id: 't',
      kind: 'text',
      color: '#fff',
      style: { fontSize: 18 },
    } as never);
    expect(txt.fontSize).toBe(18);
  });
});

describe('normalize keeps fibLevels / rr', () => {
  it('round-trips meta extras', () => {
    const d = normalizeDrawing({
      id: 'f1',
      kind: 'fib',
      p1: { time: 1, price: 100 },
      p2: { time: 2, price: 200 },
      color: '#939fff',
      meta: { fibLevels: [0, 0.5, 1], reverse: true, rr: 2, showPrice: false },
    });
    expect(d).not.toBeNull();
    expect(d!.meta?.fibLevels).toEqual([0, 0.5, 1]);
    expect(d!.meta?.reverse).toBe(true);
    expect(d!.meta?.showPrice).toBe(false);
  });
});
