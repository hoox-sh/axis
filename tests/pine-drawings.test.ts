/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizeExtend,
  normalizeLineStyle,
  normalizeScriptDrawings,
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
