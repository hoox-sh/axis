/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine engine drawing payloads → chart-layer shapes (line/box/label).
 * Guards style/extend normalization and multi-object batch mapping.
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_DRAWING_LIMITS,
  clampScriptDrawingTimes,
  clampTimeToLastBar,
  dedupeScriptLabelsAtSameTime,
  garbageCollectScriptDrawings,
  normalizeExtend,
  normalizeLineStyle,
  normalizeScriptDrawings,
  parseDrawingLimitsFromScript,
  resolveDrawingLimits,
  type ScriptDrawing,
} from '../src/chart/pine-drawings.ts';

describe('normalizeScriptDrawings', () => {
  it('maps line/box/label API payloads', () => {
    const list = normalizeScriptDrawings([
      {
        type: 'line',
        t1: 100,
        p1: 10,
        t2: 200,
        p2: 20,
        color: '#F23645',
        width: 2,
      },
      {
        type: 'box',
        t1: 100,
        p1: 30,
        t2: 200,
        p2: 5,
        color: '#22AB94',
        bgcolor: 'rgba(0,0,0,0)',
      },
      { type: 'label', t1: 150, p1: 25, text: 'hi', color: '#2962FF', textcolor: '#fff' },
    ]);
    expect(list).toHaveLength(3);
    expect(list[0].type).toBe('line');
    expect(list[0].t2).toBe(200);
    expect(list[1].type).toBe('box');
    expect(list[2].text).toBe('hi');
  });

  it('skips incomplete objects', () => {
    expect(normalizeScriptDrawings([{ type: 'line', t1: 1 }])).toHaveLength(0);
    expect(normalizeScriptDrawings(null)).toHaveLength(0);
  });

  it('maps trend/rect aliases and polyline points', () => {
    const list = normalizeScriptDrawings([
      {
        kind: 'trend',
        x1: 10,
        y1: 1,
        x2: 20,
        y2: 2,
        style: 'dashed',
        extend: 'right',
      },
      {
        type: 'rect',
        left: 5,
        top: 9,
        right: 15,
        bottom: 3,
        border_color: '#abc',
        border_width: 2,
        text: 'zone',
      },
      {
        type: 'text',
        time: 50,
        price: 7,
        text: 'lbl',
      },
      {
        type: 'polyline',
        points: [
          { t: 1, p: 1 },
          { time: 2, y: 3 },
          { bad: true },
        ],
        closed: true,
        color: '#0f0',
      },
      { type: 'polyline', points: [{ time: 1, price: 1 }] }, // too short
      'skip-me',
      null,
    ]);
    expect(list.map((d) => d.type)).toEqual(['line', 'box', 'label', 'polyline']);
    expect(list[0].extend).toBe('right');
    expect(list[1].text).toBe('zone');
    expect(list[1].width).toBe(2);
    expect(list[2].text).toBe('lbl');
    expect(list[3].points).toHaveLength(2);
    expect(list[3].closed).toBe(true);
  });

  it('maps compile-mode kind keys (x1/y1, left/top, x/y, hline)', () => {
    const list = normalizeScriptDrawings([
      { kind: 'hline', bar: 0, price: 50, title: 'mid', color: '#787B86' },
      {
        kind: 'line',
        bar: 0,
        x1: 0,
        y1: 100,
        x2: 1,
        y2: 105,
        style: 'style_dotted',
        extend: 'right',
      },
      {
        kind: 'box',
        bar: 0,
        left: 0,
        top: 110,
        right: 2,
        bottom: 90,
        border_color: '#2962FF',
        bgcolor: '#2962FF',
      },
      {
        kind: 'label',
        bar: 0,
        x: 0,
        y: 100,
        text: 'hi',
        color: '#2962FF',
        textcolor: '#FFFFFF',
      },
      // non-geometry — ignored
      { kind: 'bgcolor', bar: 0, color: 'red' },
      { kind: 'plotshape', bar: 0, series: true },
      { kind: 'fill', bar: 0 },
      { kind: 'set', method: 'line.set_xy2', target: {}, bar: 1 },
    ]);
    expect(list.map((d) => d.type)).toEqual(['line', 'line', 'box', 'label']);
    // hline → horizontal line
    expect(list[0].id).toMatch(/^pine_hline_/);
    expect(list[0].p1).toBe(50);
    expect(list[0].p2).toBe(50);
    expect(list[0].t1).toBe(0);
    expect(list[0].extend).toBe('right');
    expect(list[0].text).toBe('mid');
    // line style stripped
    expect(list[1].style).toBe('dotted');
    expect(list[1].extend).toBe('right');
    expect(list[1].t1).toBe(0);
    expect(list[1].t2).toBe(1);
    // box
    expect(list[2].t1).toBe(0);
    expect(list[2].t2).toBe(2);
    expect(list[2].p1).toBe(110);
    expect(list[2].p2).toBe(90);
    expect(list[2].color).toBe('#2962FF');
    // label
    expect(list[3].t1).toBe(0);
    expect(list[3].p1).toBe(100);
    expect(list[3].text).toBe('hi');
    expect(list[3].textcolor).toBe('#FFFFFF');
  });

  it('maps compile polyline arg0 ChartPoint-shaped points', () => {
    const list = normalizeScriptDrawings([
      {
        kind: 'polyline',
        bar: 0,
        arg0: [
          { x: 0, y: 100, index: 0, price: 100 },
          { x: 1, y: 101, index: 1, price: 101 },
          { x: 2 }, // incomplete
        ],
        closed: false,
        color: '#0f0',
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('polyline');
    expect(list[0].points).toEqual([
      { time: 0, price: 100 },
      { time: 1, price: 101 },
    ]);
  });

  it('maps ray alias to line with extend right by default', () => {
    const list = normalizeScriptDrawings([
      { kind: 'ray', x1: 1, y1: 2, x2: 3, y2: 4 },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('line');
    expect(list[0].extend).toBe('right');
  });
});

describe('normalizeLineStyle / normalizeExtend', () => {
  it('strips Pine style prefixes', () => {
    expect(normalizeLineStyle('style_dotted')).toBe('dotted');
    expect(normalizeLineStyle('line.style_dashed')).toBe('dashed');
    expect(normalizeLineStyle('hline.style_solid')).toBe('solid');
    expect(normalizeLineStyle('plot.linestyle_dashed')).toBe('dashed');
    expect(normalizeLineStyle(null)).toBe('solid');
  });

  it('normalizes extend constants', () => {
    expect(normalizeExtend('extend.right')).toBe('right');
    expect(normalizeExtend('both')).toBe('both');
    expect(normalizeExtend('nope')).toBe('none');
    expect(normalizeExtend(undefined, 'left')).toBe('left');
  });
});

function mk(
  type: ScriptDrawing['type'],
  i: number,
): ScriptDrawing {
  return {
    id: `${type}_${i}`,
    type,
    t1: i,
    p1: i,
    ...(type === 'line' || type === 'box'
      ? { t2: i + 1, p2: i + 1 }
      : {}),
    color: '#fff',
  };
}

describe('drawing garbage collection', () => {
  it('defaults match TradingView (50 per type)', () => {
    expect(DEFAULT_DRAWING_LIMITS).toEqual({
      max_lines_count: 50,
      max_labels_count: 50,
      max_boxes_count: 50,
      max_polylines_count: 50,
    });
  });

  it('parses max_*_count from indicator/strategy source', () => {
    const src = `//@version=5
indicator("Label limits example", max_labels_count=100, max_lines_count=10, overlay=true)
label.new(bar_index, high, "x")
`;
    expect(parseDrawingLimitsFromScript(src)).toEqual({
      max_labels_count: 100,
      max_lines_count: 10,
    });
  });

  it('ignores commented-out max_* kwargs', () => {
    const src = `indicator("x")
// max_labels_count=999
label.new(bar_index, high, "x")
`;
    expect(parseDrawingLimitsFromScript(src)).toEqual({});
  });

  it('clamps to Pine hard caps', () => {
    const src = 'indicator("x", max_labels_count=9999, max_polylines_count=500)';
    const parsed = parseDrawingLimitsFromScript(src);
    expect(parsed.max_labels_count).toBe(500);
    expect(parsed.max_polylines_count).toBe(100);
  });

  it('resolveDrawingLimits prefers meta over script over defaults', () => {
    const script = 'indicator("x", max_labels_count=20, max_lines_count=5)';
    const meta = { max_labels_count: 7 };
    expect(resolveDrawingLimits(script, meta)).toEqual({
      max_lines_count: 5,
      max_labels_count: 7,
      max_boxes_count: 50,
      max_polylines_count: 50,
    });
  });

  it('drops oldest drawings per type when over cap', () => {
    const labels = [mk('label', 0), mk('label', 1), mk('label', 2), mk('label', 3)];
    const lines = [mk('line', 0), mk('line', 1)];
    const mixed = [...labels, ...lines];
    const kept = garbageCollectScriptDrawings(mixed, {
      max_lines_count: 1,
      max_labels_count: 2,
      max_boxes_count: 50,
      max_polylines_count: 50,
    });
    expect(kept.map((d) => d.id)).toEqual(['label_2', 'label_3', 'line_1']);
  });

  it('keeps all when under caps', () => {
    const list = [mk('box', 0), mk('polyline', 1)];
    expect(garbageCollectScriptDrawings(list, DEFAULT_DRAWING_LIMITS)).toEqual(list);
  });

  it('default 50 cap discards early labels in a long series', () => {
    const many = Array.from({ length: 60 }, (_, i) => mk('label', i));
    const kept = garbageCollectScriptDrawings(many);
    expect(kept).toHaveLength(50);
    expect(kept[0]!.id).toBe('label_10');
    expect(kept[49]!.id).toBe('label_59');
  });
});

describe('dedupeScriptLabelsAtSameTime', () => {
  it('keeps one label per (time, text) — last wins', () => {
    const t = 1_700_000_000;
    const labels: ScriptDrawing[] = Array.from({ length: 50 }, (_, i) => ({
      id: `lab_${i}`,
      type: 'label',
      t1: t,
      p1: 100 + i,
      color: '#888',
      text: 'Sleeping Mode',
    }));
    const kept = dedupeScriptLabelsAtSameTime(labels);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.id).toBe('lab_49');
    expect(kept[0]!.text).toBe('Sleeping Mode');
  });

  it('keeps distinct texts at the same time', () => {
    const t = 1;
    const list: ScriptDrawing[] = [
      { id: 'a', type: 'label', t1: t, p1: 1, color: '#0', text: 'Long' },
      { id: 'b', type: 'label', t1: t, p1: 2, color: '#0', text: 'Short' },
      { id: 'c', type: 'label', t1: t, p1: 3, color: '#0', text: 'Long' },
    ];
    const kept = dedupeScriptLabelsAtSameTime(list);
    expect(kept.map((d) => d.id).sort()).toEqual(['b', 'c']);
  });

  it('does not drop lines', () => {
    const list: ScriptDrawing[] = [
      { id: 'l', type: 'line', t1: 1, p1: 1, t2: 2, p2: 2, color: '#f00' },
      { id: 'a', type: 'label', t1: 1, p1: 1, color: '#0', text: 'x' },
      { id: 'b', type: 'label', t1: 1, p1: 2, color: '#0', text: 'x' },
    ];
    const kept = dedupeScriptLabelsAtSameTime(list);
    expect(kept.map((d) => d.id)).toEqual(['l', 'b']);
  });
});

describe('clampTimeToLastBar / clampScriptDrawingTimes', () => {
  const last = 1_700_000_000;

  it('clamps only times strictly past last bar', () => {
    expect(clampTimeToLastBar(last + 3600, last)).toBe(last);
    expect(clampTimeToLastBar(last, last)).toBe(last);
    expect(clampTimeToLastBar(last - 60, last)).toBe(last - 60);
  });

  it('no-ops when lastBarTime is missing or non-finite', () => {
    expect(clampTimeToLastBar(99, null)).toBe(99);
    expect(clampTimeToLastBar(99, undefined)).toBe(99);
    expect(clampTimeToLastBar(99, Number.NaN)).toBe(99);
  });

  it('clamps label/line/polyline future anchors without mutating inputs', () => {
    const future = last + 86_400;
    const raw: ScriptDrawing[] = [
      {
        id: 'l0',
        type: 'label',
        t1: future,
        p1: 100,
        color: '#f00',
        text: 'Sleeping Mode',
      },
      {
        id: 'ln',
        type: 'line',
        t1: last - 100,
        p1: 1,
        t2: future,
        p2: 2,
        color: '#0f0',
      },
      {
        id: 'poly',
        type: 'polyline',
        t1: last - 10,
        p1: 1,
        t2: future,
        p2: 2,
        color: '#00f',
        points: [
          { time: last - 10, price: 1 },
          { time: future, price: 2 },
        ],
      },
    ];
    const copy = structuredClone(raw);
    const clamped = clampScriptDrawingTimes(raw, last);
    expect(raw).toEqual(copy); // immutable
    expect(clamped[0]!.t1).toBe(last);
    expect(clamped[1]!.t1).toBe(last - 100);
    expect(clamped[1]!.t2).toBe(last);
    expect(clamped[2]!.points![1]!.time).toBe(last);
    // In-range batch is identity
    expect(clampScriptDrawingTimes(clamped, last)).toBe(clamped);
  });

  it('does not collapse bar_index-style times under a large lastBarTime', () => {
    // Compile-path drawings use small integers; last bar is unix seconds.
    expect(clampTimeToLastBar(42, last)).toBe(42);
    expect(clampTimeToLastBar(500, last)).toBe(500);
  });
});
