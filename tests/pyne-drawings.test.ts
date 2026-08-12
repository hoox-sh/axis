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
  labelBubbleLayout,
  labelFontSizePx,
  normalizeExtend,
  normalizeLabelStyle,
  normalizeLineStyle,
  normalizeScriptDrawings,
  normalizeYloc,
  parseDrawingLimitsFromScript,
  resolveDrawingLimits,
  type ScriptDrawing,
} from '../src/chart/pyne-drawings.ts';

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
    // Defaults when style/yloc omitted
    expect(list[2].style).toBe('label_center');
    expect(list[2].yloc).toBe('price');
  });

  it('passes through label style, yloc, size, textcolor', () => {
    const list = normalizeScriptDrawings([
      {
        type: 'label',
        t1: 10,
        p1: 100,
        text: 'UP',
        color: '#22AB94',
        textcolor: '#FFFFFF',
        style: 'label.style_label_up',
        yloc: 'yloc.abovebar',
        size: 'size.small',
      },
      {
        type: 'label',
        t1: 20,
        p1: 90,
        text: 'L',
        color: '#F23645',
        text_color: '#000',
        style: 'style_label_left',
        yloc: 'belowbar',
        text_size: 14,
      },
      {
        kind: 'label',
        x: 5,
        y: 50,
        text: 'R',
        style: 'label_right',
        yloc: 'price',
        size: 'huge',
      },
    ]);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      type: 'label',
      text: 'UP',
      style: 'label_up',
      yloc: 'abovebar',
      size: 'size.small',
      textcolor: '#FFFFFF',
      color: '#22AB94',
    });
    expect(list[1]).toMatchObject({
      style: 'label_left',
      yloc: 'belowbar',
      size: 14,
      textcolor: '#000',
    });
    expect(list[2]).toMatchObject({
      style: 'label_right',
      yloc: 'price',
      size: 'huge',
      t1: 5,
      p1: 50,
    });
  });

  it('skips incomplete objects', () => {
    expect(normalizeScriptDrawings([{ type: 'line', t1: 1 }])).toHaveLength(0);
    expect(normalizeScriptDrawings(null)).toHaveLength(0);
  });

  it('maps linefill quads from pyne export', () => {
    const list = normalizeScriptDrawings([
      {
        type: 'linefill',
        t1: 100,
        p1: 10,
        t2: 200,
        p2: 12,
        t3: 100,
        p3: 5,
        t4: 200,
        p4: 7,
        color: 'rgba(41,98,255,0.2)',
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe('linefill');
    expect(list[0]!.t3).toBe(100);
    expect(list[0]!.p4).toBe(7);
    expect(list[0]!.bgcolor).toContain('rgba');
  });

  it('maps force_overlay on line / box / label (snake + camel)', () => {
    const list = normalizeScriptDrawings([
      {
        type: 'line',
        t1: 1,
        p1: 1,
        t2: 2,
        p2: 2,
        force_overlay: true,
      },
      {
        type: 'box',
        t1: 1,
        p1: 10,
        t2: 2,
        p2: 5,
        forceOverlay: true,
      },
      {
        type: 'label',
        t1: 3,
        p1: 7,
        text: 'ov',
        force_overlay: 1,
      },
      {
        type: 'line',
        t1: 4,
        p1: 1,
        t2: 5,
        p2: 2,
        // omitted → false
      },
      {
        type: 'label',
        t1: 6,
        p1: 1,
        text: 'no',
        force_overlay: false,
      },
    ]);
    expect(list).toHaveLength(5);
    expect(list[0]!.forceOverlay).toBe(true);
    expect(list[1]!.forceOverlay).toBe(true);
    expect(list[2]!.forceOverlay).toBe(true);
    expect(list[3]!.forceOverlay).toBe(false);
    expect(list[4]!.forceOverlay).toBe(false);
  });

  it('linefill edge cases: alias, compile coords, incomplete skip, fill color', () => {
    const list = normalizeScriptDrawings([
      // line_fill alias + x/y quad keys
      {
        type: 'line_fill',
        x1: 10,
        y1: 1,
        x2: 20,
        y2: 2,
        x3: 10,
        y3: 0,
        x4: 20,
        y4: 0.5,
        bgcolor: 'rgba(0,128,0,0.25)',
      },
      // incomplete — missing t4/p4
      {
        type: 'linefill',
        t1: 1,
        p1: 1,
        t2: 2,
        p2: 2,
        t3: 1,
        p3: 0,
      },
      // non-finite corner rejected
      {
        type: 'linefill',
        t1: 1,
        p1: 1,
        t2: 2,
        p2: 2,
        t3: 1,
        p3: 0,
        t4: Number.NaN,
        p4: 0,
      },
      // color-only fill (no bgcolor) still paints
      {
        type: 'linefill',
        t1: 1,
        p1: 10,
        t2: 2,
        p2: 11,
        t3: 1,
        p3: 5,
        t4: 2,
        p4: 6,
        color: '#2962FF',
      },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]!.type).toBe('linefill');
    expect(list[0]!.t1).toBe(10);
    expect(list[0]!.p4).toBe(0.5);
    expect(list[0]!.bgcolor).toContain('rgba');
    expect(list[0]!.color).toBe(list[0]!.bgcolor);
    expect(list[1]!.color).toBe('#2962FF');
    expect(list[1]!.bgcolor).toBe('#2962FF');
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

  it('maps line.style_arrow_* to directional tokens', () => {
    expect(normalizeLineStyle('line.style_arrow_right')).toBe('arrow_right');
    expect(normalizeLineStyle('style_arrow_left')).toBe('arrow_left');
    expect(normalizeLineStyle('line.style_arrow_both')).toBe('arrow_both');
    expect(normalizeLineStyle('arrow')).toBe('arrow_right');
  });

  it('normalizes extend constants', () => {
    expect(normalizeExtend('extend.right')).toBe('right');
    expect(normalizeExtend('both')).toBe('both');
    expect(normalizeExtend('nope')).toBe('none');
    expect(normalizeExtend(undefined, 'left')).toBe('left');
  });
});

describe('normalizeLabelStyle / normalizeYloc / label layout', () => {
  it('normalizes label.style_* and bare tokens', () => {
    expect(normalizeLabelStyle('label.style_label_up')).toBe('label_up');
    expect(normalizeLabelStyle('style_label_down')).toBe('label_down');
    expect(normalizeLabelStyle('label_left')).toBe('label_left');
    expect(normalizeLabelStyle('label.style_label_right')).toBe('label_right');
    expect(normalizeLabelStyle('label.style_label_center')).toBe('label_center');
    expect(normalizeLabelStyle('up')).toBe('label_up');
    expect(normalizeLabelStyle('center')).toBe('label_center');
    expect(normalizeLabelStyle('label.style_xcross')).toBe('xcross');
    expect(normalizeLabelStyle(null)).toBe('label_center');
    expect(normalizeLabelStyle('label.style_label_upper_left')).toBe('label_upper_left');
  });

  it('normalizes yloc.* tokens', () => {
    expect(normalizeYloc('yloc.price')).toBe('price');
    expect(normalizeYloc('yloc.abovebar')).toBe('abovebar');
    expect(normalizeYloc('belowbar')).toBe('belowbar');
    expect(normalizeYloc('nope')).toBe('price');
    expect(normalizeYloc(undefined)).toBe('price');
  });

  it('maps size tokens to font px', () => {
    expect(labelFontSizePx('size.tiny')).toBe(8);
    expect(labelFontSizePx('small')).toBe(10);
    expect(labelFontSizePx('size.large')).toBe(14);
    expect(labelFontSizePx(16)).toBe(16);
    expect(labelFontSizePx(null)).toBe(10);
  });

  it('places bubbles by style relative to anchor', () => {
    const up = labelBubbleLayout(100, 200, 40, 16, 'label_up', 6);
    expect(up.rectY).toBeLessThan(200);
    expect(up.textAnchor).toBe('middle');

    const down = labelBubbleLayout(100, 200, 40, 16, 'label_down', 6);
    expect(down.rectY).toBeGreaterThan(200);

    const left = labelBubbleLayout(100, 200, 40, 16, 'label_left', 6);
    expect(left.rectX).toBeLessThan(100 - 40);
    expect(left.textAnchor).toBe('end');

    const right = labelBubbleLayout(100, 200, 40, 16, 'label_right', 6);
    expect(right.rectX).toBeGreaterThan(100);
    expect(right.textAnchor).toBe('start');

    const center = labelBubbleLayout(100, 200, 40, 16, 'label_center', 6);
    expect(center.rectX).toBe(80);
    expect(center.rectY).toBe(192);

    // Unknown → bubble above (same as label_up default)
    const unk = labelBubbleLayout(100, 200, 40, 16, 'mystery', 6);
    expect(unk.rectY).toBe(up.rectY);
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

  it('preserves linefill when GC trims other types', () => {
    const fills: ScriptDrawing[] = [
      {
        id: 'lf_0',
        type: 'linefill',
        t1: 1,
        p1: 10,
        t2: 2,
        p2: 11,
        t3: 1,
        p3: 5,
        t4: 2,
        p4: 6,
        color: 'rgba(41,98,255,0.2)',
        bgcolor: 'rgba(41,98,255,0.2)',
      },
      {
        id: 'lf_1',
        type: 'linefill',
        t1: 3,
        p1: 20,
        t2: 4,
        p2: 21,
        t3: 3,
        p3: 15,
        t4: 4,
        p4: 16,
        color: 'rgba(0,200,0,0.15)',
        bgcolor: 'rgba(0,200,0,0.15)',
      },
    ];
    const labels = [mk('label', 0), mk('label', 1), mk('label', 2)];
    const mixed = [fills[0]!, labels[0]!, fills[1]!, labels[1]!, labels[2]!];
    const kept = garbageCollectScriptDrawings(mixed, {
      max_lines_count: 50,
      max_labels_count: 1,
      max_boxes_count: 50,
      max_polylines_count: 50,
    });
    // Labels: keep newest only; both linefills pass through (no max_linefills cap).
    expect(kept.map((d) => d.id)).toEqual(['lf_0', 'lf_1', 'label_2']);
    expect(kept.filter((d) => d.type === 'linefill')).toHaveLength(2);
  });

  it('linefill-only batches are identity under GC', () => {
    const fills: ScriptDrawing[] = Array.from({ length: 5 }, (_, i) => ({
      id: `lf_${i}`,
      type: 'linefill' as const,
      t1: i,
      p1: 1,
      t2: i + 1,
      p2: 2,
      t3: i,
      p3: 0,
      t4: i + 1,
      p4: 0.5,
      color: '#2962FF',
    }));
    expect(garbageCollectScriptDrawings(fills, DEFAULT_DRAWING_LIMITS)).toBe(fills);
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

  it('snaps non-finite times to last bar when known, else 0', () => {
    expect(clampTimeToLastBar(Number.NaN, last)).toBe(last);
    expect(clampTimeToLastBar(Number.POSITIVE_INFINITY, last)).toBe(last);
    expect(clampTimeToLastBar(Number.NaN, null)).toBe(0);
  });

  it('drops non-finite polyline vertices', () => {
    const raw: ScriptDrawing[] = [
      {
        id: 'poly',
        type: 'polyline',
        t1: last - 10,
        p1: 1,
        t2: last,
        p2: 2,
        color: '#00f',
        points: [
          { time: last - 10, price: 1 },
          { time: last, price: Number.NaN },
          { time: last + 1, price: 2 },
        ],
      },
    ];
    const clamped = clampScriptDrawingTimes(raw, last);
    expect(clamped[0]!.points).toEqual([
      { time: last - 10, price: 1 },
      { time: last, price: 2 },
    ]);
  });
});

describe('normalizeScriptDrawings hardening', () => {
  it('hard-caps labels at language max (500) and keeps newest', () => {
    const raw = Array.from({ length: 600 }, (_, i) => ({
      type: 'label',
      t1: i,
      p1: i,
      text: `L${i}`,
    }));
    const list = normalizeScriptDrawings(raw);
    expect(list).toHaveLength(500);
    expect(list[0]!.t1).toBe(100);
    expect(list[499]!.t1).toBe(599);
  });

  it('caps polyline points and rejects non-finite coords', () => {
    const pts = Array.from({ length: 3_000 }, (_, i) => ({ time: i, price: i }));
    pts.push({ time: Number.NaN as unknown as number, price: 1 });
    const list = normalizeScriptDrawings([
      { type: 'polyline', points: pts, color: '#0f0' },
      { type: 'line', t1: Number.NaN, p1: 1, t2: 2, p2: 3 },
      { type: 'label', t1: 1, p1: Number.POSITIVE_INFINITY, text: 'x' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.type).toBe('polyline');
    expect(list[0]!.points!.length).toBe(2_000);
  });

  it('sanitizes text length and hostile colors', () => {
    const huge = 'x'.repeat(500);
    const list = normalizeScriptDrawings([
      {
        type: 'label',
        t1: 1,
        p1: 2,
        text: huge,
        color: 'url(javascript:alert(1))',
        textcolor: '#fff',
      },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]!.text!.length).toBeLessThanOrEqual(200);
    expect(list[0]!.color).toBe('#939fff'); // fallback
  });

  it('clamps extreme stroke widths', () => {
    const list = normalizeScriptDrawings([
      { type: 'line', t1: 1, p1: 1, t2: 2, p2: 2, width: 9999 },
      { type: 'line', t1: 1, p1: 1, t2: 2, p2: 2, width: -5 },
    ]);
    expect(list[0]!.width).toBe(32);
    expect(list[1]!.width).toBe(0.5);
  });

  it('garbageCollect tolerates nullish limits and non-array input', () => {
    expect(garbageCollectScriptDrawings(null as unknown as ScriptDrawing[])).toEqual([]);
    const one = [mk('label', 0)];
    expect(
      garbageCollectScriptDrawings(one, undefined as unknown as typeof DEFAULT_DRAWING_LIMITS),
    ).toEqual(one);
  });
});
