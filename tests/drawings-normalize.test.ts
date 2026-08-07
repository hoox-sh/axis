// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * User-drawing normalize: legacy localStorage shapes → points-based model.
 * Guards migration of old hline/trend/rect fields and color defaults.
 */

import { describe, expect, it } from 'bun:test';
import {
  DRAWING_LIST_MAX,
  normalizeDrawing,
  normalizeUserDrawings,
} from '../src/chart/drawings/normalize.ts';
import { DRAWING_COLORS, type DrawingKind } from '../src/chart/drawing-types.ts';
import {
  DRAWING_POINTS_MAX,
  DRAWING_TEXT_MAX,
} from '../src/chart/drawings/tools/safe.ts';
import { finiteAttr } from '../src/chart/drawings/svg-primitives.ts';
import {
  clampTimeToFutureHorizon,
  estimateBarPeriod,
  logicalIndexToUnixTime,
  unixTimeToLogicalIndex,
} from '../src/chart/drawings/coords.ts';
import { distToSegment, extendSegment, nearPoint } from '../src/chart/drawings/geometry.ts';
import { findNearestBarIndex, snapToBars } from '../src/chart/drawings/snap.ts';

describe('normalizeDrawing — legacy shapes', () => {
  it('hline: kind / price / color / text', () => {
    const d = normalizeDrawing({
      id: 'h1',
      kind: 'hline',
      color: '#ff0000',
      price: 42000.5,
      text: 'R1',
    });
    expect(d).not.toBeNull();
    expect(d!.id).toBe('h1');
    expect(d!.kind).toBe('hline');
    expect(d!.points).toHaveLength(1);
    expect(d!.points[0]!.price).toBe(42000.5);
    expect(d!.style.color).toBe('#ff0000');
    expect(d!.style.width).toBe(1.5);
    expect(d!.style.lineStyle).toBe('solid');
    expect(d!.style.opacity).toBe(1);
    expect(d!.meta?.text).toBe('R1');
  });

  it('vline: kind / time / color', () => {
    const d = normalizeDrawing({
      id: 'v1',
      kind: 'vline',
      color: '#00ff00',
      time: 1_700_000_000,
    });
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('vline');
    expect(d!.points[0]!.time).toBe(1_700_000_000);
    expect((d as { time?: number }).time).toBe(1_700_000_000);
  });

  it('two-point: trend / ray / rect / fib / measure preserve p1+p2', () => {
    const kinds = ['trend', 'ray', 'extend', 'rect', 'ellipse', 'arrow', 'fib', 'measure'] as const;
    const p1 = { time: 1_700_000_000, price: 100 };
    const p2 = { time: 1_700_000_600, price: 120 };
    for (const kind of kinds) {
      const d = normalizeDrawing({
        id: `t-${kind}`,
        kind,
        color: '#939fff',
        p1,
        p2,
      });
      expect(d).not.toBeNull();
      expect(d!.kind).toBe(kind);
      expect(d!.points).toEqual([p1, p2]);
      expect(d!.style.color).toBe('#939fff');
      if (kind === 'ray') {
        expect(d!.style.extendRight).toBe(true);
      }
    }
  });

  it('text: p1 + text', () => {
    const d = normalizeDrawing({
      id: 'txt',
      kind: 'text',
      color: '#0f0',
      p1: { time: 10, price: 20 },
      text: 'hello',
    });
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('text');
    expect(d!.points).toEqual([{ time: 10, price: 20 }]);
    expect(d!.meta?.text).toBe('hello');
    expect(d!.style.color).toBe('#0f0');
  });
});

describe('normalizeDrawing — new shape', () => {
  it('points[] + style + meta passthrough with defaults filled', () => {
    const d = normalizeDrawing({
      id: 'n1',
      kind: 'rect',
      points: [
        { time: 1, price: 2 },
        { time: 3, price: 4 },
      ],
      style: {
        color: '#abcabc',
        width: 2,
        lineStyle: 'dashed',
        opacity: 0.5,
      },
      meta: { text: 'box', custom: 1 },
    });
    expect(d).not.toBeNull();
    expect(d!.points).toEqual([
      { time: 1, price: 2 },
      { time: 3, price: 4 },
    ]);
    expect(d!.style).toEqual({
      color: '#abcabc',
      width: 2,
      lineStyle: 'dashed',
      opacity: 0.5,
    });
    expect(d!.meta?.text).toBe('box');
    expect(d!.meta?.custom).toBe(1);
  });

  it('applies default color from DRAWING_COLORS when missing', () => {
    const d = normalizeDrawing({
      kind: 'hline',
      price: 1,
    });
    expect(d).not.toBeNull();
    expect(d!.style.color).toBe(DRAWING_COLORS.default);
    expect(d!.id.length).toBeGreaterThan(0);
  });
});

describe('normalizeDrawing — expanded kinds', () => {
  const p1 = { time: 100, price: 10 };
  const p2 = { time: 200, price: 20 };
  const p3 = { time: 300, price: 30 };
  const p4 = { time: 400, price: 40 };
  const p5 = { time: 500, price: 50 };

  it('1-pt text-like kinds: priceLabel / note / flag / crossline keep p1 + text', () => {
    const kinds = [
      'priceLabel',
      'note',
      'crossline',
      'flag',
      'anchoredText',
      'arrowMarkUp',
      'arrowMarkDown',
    ] as const;
    for (const kind of kinds) {
      const d = normalizeDrawing({
        id: `1pt-${kind}`,
        kind,
        p1,
        text: 'lbl',
      });
      expect(d).not.toBeNull();
      expect(d!.kind).toBe(kind);
      expect(d!.points).toEqual([p1]);
      expect(d!.meta?.text).toBe('lbl');
      expect((d as { p1?: typeof p1 }).p1).toEqual(p1);
      expect((d as { text?: string }).text).toBe('lbl');
    }
  });

  it('2-pt extended kinds: gannFan / forecast / hray / callout / long normalize + p1/p2 mirrors', () => {
    const kinds = [
      'gannFan',
      'gannBox',
      'gannSquare',
      'forecast',
      'hray',
      'infoLine',
      'trendAngle',
      'rotatedRect',
      'arc',
      'curve',
      'fibtime',
      'fibArc',
      'fibCircles',
      'dateRange',
      'priceRange',
      'datePriceRange',
      'callout',
      'long',
      'short',
    ] as const;
    for (const kind of kinds) {
      const d = normalizeDrawing({
        id: `2pt-${kind}`,
        kind,
        points: [p1, p2],
      });
      expect(d).not.toBeNull();
      expect(d!.kind).toBe(kind);
      expect(d!.points).toEqual([p1, p2]);
      const any = d as { p1?: typeof p1; p2?: typeof p2 };
      expect(any.p1).toEqual(p1);
      expect(any.p2).toEqual(p2);
    }
  });

  it('channel (3-pt): keeps points[] and p1/p2/p3 mirrors', () => {
    const d = normalizeDrawing({
      id: 'ch1',
      kind: 'channel',
      points: [p1, p2, p3],
      color: '#123456',
    });
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('channel');
    expect(d!.points).toEqual([p1, p2, p3]);
    const any = d as { p1?: typeof p1; p2?: typeof p2; p3?: typeof p3; color?: string };
    expect(any.p1).toEqual(p1);
    expect(any.p2).toEqual(p2);
    expect(any.p3).toEqual(p3);
    expect(any.color).toBe('#123456');
  });

  it('channel from legacy p1/p2/p3 without points[]', () => {
    const d = normalizeDrawing({
      kind: 'channel',
      p1,
      p2,
      p3,
    });
    expect(d).not.toBeNull();
    expect(d!.points).toEqual([p1, p2, p3]);
  });

  it('3-pt kinds: pitchfork / fibext / triangle', () => {
    for (const kind of ['pitchfork', 'fibext', 'fibchannel', 'fibWedge', 'triangle'] as const) {
      const d = normalizeDrawing({ kind, points: [p1, p2, p3] });
      expect(d).not.toBeNull();
      expect(d!.kind).toBe(kind);
      expect(d!.points).toHaveLength(3);
    }
  });

  it('xabcd multi-point: keeps all anchors + p1/p2 mirrors', () => {
    const pts = [p1, p2, p3, p4, p5];
    const d = normalizeDrawing({
      id: 'x1',
      kind: 'xabcd',
      points: pts,
    });
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('xabcd');
    expect(d!.points).toEqual(pts);
    const any = d as { p1?: typeof p1; p2?: typeof p2; p3?: typeof p3 };
    expect(any.p1).toEqual(p1);
    expect(any.p2).toEqual(p2);
    expect(any.p3).toEqual(p3);
  });

  it('forecast / gannFan / headShoulders / brush round-trip in list', () => {
    const out = normalizeUserDrawings([
      { kind: 'forecast', points: [p1, p2] },
      { kind: 'gannFan', p1, p2 },
      {
        kind: 'headShoulders',
        points: [p1, p2, p3, p4, p5, { time: 600, price: 60 }],
      },
      { kind: 'brush', points: [p1, p2, p3] },
      { kind: 'highlighter', points: [p1, p2] },
      { kind: 'polyline', points: [p1, p2, p3, p4] },
      { kind: 'path', points: [p1, p2] },
      { kind: 'eraser', points: [p1] }, // tool-only — drop
      { kind: 'cursor' }, // drop
    ]);
    expect(out.map((d) => d.kind)).toEqual([
      'forecast',
      'gannFan',
      'headShoulders',
      'brush',
      'highlighter',
      'polyline',
      'path',
    ]);
    expect(out[2]!.points).toHaveLength(6);
    expect((out[0] as { p1?: PointLike; p2?: PointLike }).p1).toEqual(p1);
    expect((out[0] as { p1?: PointLike; p2?: PointLike }).p2).toEqual(p2);
  });

  it('every DrawingKind except none invalid hydrates with enough points', () => {
    // Spot-check a representative of each arity bucket already covered;
    // ensure no known kind is silently rejected when geometry is valid.
    const samples: Array<{ kind: DrawingKind; points: Array<{ time: number; price: number }> }> = [
      { kind: 'hray', points: [p1, p2] },
      { kind: 'infoLine', points: [p1, p2] },
      { kind: 'channel', points: [p1, p2, p3] },
      { kind: 'xabcd', points: [p1, p2, p3, p4, p5] },
      { kind: 'forecast', points: [p1, p2] },
      { kind: 'gannFan', points: [p1, p2] },
      { kind: 'priceLabel', points: [p1] },
      { kind: 'note', points: [p1] },
    ];
    for (const { kind, points } of samples) {
      const d = normalizeDrawing({ kind, points });
      expect(d).not.toBeNull();
      expect(d!.kind).toBe(kind);
      expect(d!.points.length).toBeGreaterThanOrEqual(1);
    }
  });
});

type PointLike = { time: number; price: number };

describe('normalizeDrawing — invalid / garbage', () => {
  it('drops null, non-objects, unknown kinds', () => {
    expect(normalizeDrawing(null)).toBeNull();
    expect(normalizeDrawing(undefined)).toBeNull();
    expect(normalizeDrawing(42)).toBeNull();
    expect(normalizeDrawing('hline')).toBeNull();
    expect(normalizeDrawing({ kind: 'cursor' })).toBeNull();
    expect(normalizeDrawing({ kind: 'eraser', points: [{ time: 1, price: 1 }] })).toBeNull();
    expect(normalizeDrawing({ kind: 'nope', price: 1 })).toBeNull();
    expect(normalizeDrawing({ id: 'x' })).toBeNull();
  });

  it('drops incomplete geometry', () => {
    expect(
      normalizeDrawing({ kind: 'hline', color: '#fff' /* no price */ }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'trend',
        p1: { time: 1, price: 1 },
        // missing p2
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'text',
        // missing p1
        text: 'x',
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'fib',
        points: [{ time: 1, price: 1 }], // need 2
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'channel',
        points: [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
        ], // need 3
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'polyline',
        points: [{ time: 1, price: 1 }], // need 2
      }),
    ).toBeNull();
  });

  it('rejects NaN / Infinity times and prices', () => {
    expect(
      normalizeDrawing({
        kind: 'trend',
        points: [
          { time: NaN, price: 1 },
          { time: 2, price: 2 },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'trend',
        points: [
          { time: 1, price: Infinity },
          { time: 2, price: 2 },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'hline',
        price: NaN,
      }),
    ).toBeNull();
    expect(
      normalizeDrawing({
        kind: 'vline',
        time: Infinity,
      }),
    ).toBeNull();
    // Mixed: only finite points kept; still need 2 for trend
    const d = normalizeDrawing({
      kind: 'trend',
      points: [
        { time: 1, price: 1 },
        { time: NaN, price: 2 },
        { time: 3, price: 3 },
      ],
    });
    expect(d).not.toBeNull();
    expect(d!.points).toEqual([
      { time: 1, price: 1 },
      { time: 3, price: 3 },
    ]);
  });

  it('caps points array length', () => {
    const many = Array.from({ length: DRAWING_POINTS_MAX + 50 }, (_, i) => ({
      time: i,
      price: i,
    }));
    const d = normalizeDrawing({ kind: 'brush', points: many });
    expect(d).not.toBeNull();
    expect(d!.points).toHaveLength(DRAWING_POINTS_MAX);
  });

  it('caps text length', () => {
    const long = 'x'.repeat(DRAWING_TEXT_MAX + 80);
    const d = normalizeDrawing({
      kind: 'text',
      p1: { time: 1, price: 2 },
      text: long,
    });
    expect(d).not.toBeNull();
    expect(d!.meta?.text?.length).toBe(DRAWING_TEXT_MAX);
  });

  it('sanitizes stroke colors and rejects css injection', () => {
    const evil = normalizeDrawing({
      kind: 'hline',
      price: 1,
      color: 'url(https://evil.example/x)',
    });
    expect(evil).not.toBeNull();
    expect(evil!.style.color).toBe(DRAWING_COLORS.default);
    expect((evil as { color?: string }).color).toBe(DRAWING_COLORS.default);

    const nested = normalizeDrawing({
      kind: 'trend',
      points: [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
      ],
      style: { color: 'javascript:alert(1)', width: 2, lineStyle: 'solid', opacity: 1 },
    });
    expect(nested!.style.color).toBe(DRAWING_COLORS.default);

    const ok = normalizeDrawing({
      kind: 'hline',
      price: 1,
      color: '#ff0000',
    });
    expect(ok!.style.color).toBe('#ff0000');
  });

  it('clamps width and opacity to paint-safe ranges', () => {
    const d = normalizeDrawing({
      kind: 'hline',
      price: 10,
      width: -100,
      opacity: 99,
    });
    expect(d).not.toBeNull();
    expect(d!.style.width).toBe(0.5);
    expect(d!.style.opacity).toBe(1);

    const huge = normalizeDrawing({
      kind: 'hline',
      price: 10,
      style: { width: 999, opacity: -5, color: '#abc', lineStyle: 'solid' },
    });
    expect(huge!.style.width).toBe(32);
    expect(huge!.style.opacity).toBe(0);
  });

  it('strips prototype pollution and nested meta from garbage JSON', () => {
    const meta = JSON.parse(
      '{"text":"ok","__proto__":{"polluted":true},"constructor":"x","nested":{"a":1},"fn":null,"custom":42,"bad-key":1}',
    ) as Record<string, unknown>;
    // Ensure __proto__ is an own enumerable key (JSON.parse behavior)
    expect(Object.prototype.hasOwnProperty.call(meta, '__proto__')).toBe(true);

    const d = normalizeDrawing({
      kind: 'hline',
      price: 1,
      meta,
    });
    expect(d).not.toBeNull();
    expect(d!.meta?.text).toBe('ok');
    expect(d!.meta?.custom).toBe(42);
    expect(Object.prototype.hasOwnProperty.call(d!.meta, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(d!.meta, 'constructor')).toBe(false);
    expect(d!.meta?.nested).toBeUndefined();
    expect(d!.meta?.['bad-key']).toBeUndefined();
    // Must not pollute Object.prototype
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('caps drawing id length', () => {
    const longId = 'id_' + 'x'.repeat(200);
    const d = normalizeDrawing({ kind: 'hline', price: 1, id: longId });
    expect(d!.id.length).toBeLessThanOrEqual(128);
    expect(d!.id.startsWith('id_')).toBe(true);
  });

  it('accepts numeric-string times/prices without NaN', () => {
    const d = normalizeDrawing({
      kind: 'trend',
      points: [
        { time: '100', price: '1.5' },
        { time: '200', price: '2.5' },
      ],
    });
    expect(d).not.toBeNull();
    expect(d!.points).toEqual([
      { time: 100, price: 1.5 },
      { time: 200, price: 2.5 },
    ]);
  });
});

describe('normalizeUserDrawings', () => {
  it('mixed array: keeps valid legacy + new, drops garbage', () => {
    const out = normalizeUserDrawings([
      { id: '1', kind: 'hline', color: '#fff', price: 99 },
      null,
      { kind: 'bogus' },
      'skip',
      {
        id: '2',
        kind: 'text',
        color: '#0f0',
        p1: { time: 1, price: 2 },
        text: 'hi',
      },
      {
        id: '3',
        kind: 'trend',
        points: [
          { time: 5, price: 6 },
          { time: 7, price: 8 },
        ],
      },
      { kind: 'ray', p1: { time: 1, price: 1 }, p2: { time: 2, price: 2 } },
      {
        kind: 'channel',
        points: [
          { time: 1, price: 1 },
          { time: 2, price: 2 },
          { time: 3, price: 3 },
        ],
      },
    ]);
    expect(out).toHaveLength(5);
    expect(out.map((d) => d.kind)).toEqual([
      'hline',
      'text',
      'trend',
      'ray',
      'channel',
    ]);
    expect(out[0]!.points[0]!.price).toBe(99);
    expect(out[1]!.meta?.text).toBe('hi');
    expect(out[2]!.points).toEqual([
      { time: 5, price: 6 },
      { time: 7, price: 8 },
    ]);
    expect(out[3]!.style.extendRight).toBe(true);
    expect(out[4]!.points).toHaveLength(3);
  });

  it('non-array → empty', () => {
    expect(normalizeUserDrawings(null)).toEqual([]);
    expect(normalizeUserDrawings(undefined)).toEqual([]);
    expect(normalizeUserDrawings({})).toEqual([]);
    expect(normalizeUserDrawings('[]')).toEqual([]);
  });

  it('caps list length at DRAWING_LIST_MAX', () => {
    const many = Array.from({ length: DRAWING_LIST_MAX + 100 }, (_, i) => ({
      kind: 'hline' as const,
      price: i,
    }));
    const out = normalizeUserDrawings(many);
    expect(out).toHaveLength(DRAWING_LIST_MAX);
    expect(out[0]!.points[0]!.price).toBe(0);
    expect(out[out.length - 1]!.points[0]!.price).toBe(DRAWING_LIST_MAX - 1);
  });
});

describe('coords — non-finite / empty series guards', () => {
  it('estimateBarPeriod ignores non-finite bar times', () => {
    expect(estimateBarPeriod([{ time: NaN }, { time: Infinity }, { time: 10 }])).toBe(60);
    expect(estimateBarPeriod([{ time: 0 }, { time: 60 }, { time: 120 }])).toBe(60);
  });

  it('unixTimeToLogicalIndex returns null for bad series times', () => {
    expect(unixTimeToLogicalIndex(5, [])).toBeNull();
    expect(unixTimeToLogicalIndex(NaN, [{ time: 1 }, { time: 2 }])).toBeNull();
    expect(unixTimeToLogicalIndex(5, [{ time: NaN }, { time: NaN }])).toBeNull();
    expect(logicalIndexToUnixTime(1, [{ time: NaN }])).toBeNull();
  });

  it('clampTimeToFutureHorizon does not invent finite max from NaN last bar', () => {
    expect(Number.isNaN(clampTimeToFutureHorizon(NaN, [{ time: 1 }]))).toBe(true);
    expect(clampTimeToFutureHorizon(999, [{ time: NaN }])).toBe(999);
    const b = [{ time: 100 }, { time: 200 }];
    expect(clampTimeToFutureHorizon(150, b)).toBe(150);
  });
});

describe('svg-primitives finiteAttr', () => {
  it('only stringifies finite numbers', () => {
    expect(finiteAttr(0)).toBe('0');
    expect(finiteAttr(-1.5)).toBe('-1.5');
    expect(finiteAttr(NaN)).toBeNull();
    expect(finiteAttr(Infinity)).toBeNull();
    expect(finiteAttr(-Infinity)).toBeNull();
    expect(finiteAttr('1' as unknown as number)).toBeNull();
    expect(finiteAttr(null)).toBeNull();
  });
});

describe('geometry — non-finite safety', () => {
  it('distToSegment / nearPoint reject garbage coords', () => {
    expect(distToSegment(NaN, 0, 0, 0, 1, 1)).toBe(Number.POSITIVE_INFINITY);
    expect(nearPoint(0, 0, NaN, 0, 5)).toBe(false);
  });

  it('extendSegment returns zeros for non-finite anchors', () => {
    expect(extendSegment(NaN, 0, 1, 1, 'right', 100, 100)).toEqual({
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
    });
  });
});

describe('snap — non-finite bars / raw', () => {
  it('findNearestBarIndex rejects non-finite time / empty', () => {
    expect(findNearestBarIndex([], 1)).toBe(-1);
    expect(findNearestBarIndex([{ time: 1, open: 1, high: 1, low: 1, close: 1 }], NaN)).toBe(
      -1,
    );
  });

  it('snapToBars skips NaN OHLC and non-finite raw', () => {
    const bars = [{ time: 10, open: NaN, high: NaN, low: NaN, close: NaN }];
    const raw = { time: 10, price: 5 };
    const out = snapToBars({
      bars,
      raw,
      rawXY: { x: 0, y: 50 },
      priceToY: (p) => p,
      mode: 'strong',
    });
    expect(out).toEqual(raw);

    const out2 = snapToBars({
      bars: [{ time: 10, open: 1, high: 2, low: 0, close: 1 }],
      raw: { time: NaN, price: 1 },
      rawXY: { x: 0, y: 10 },
      priceToY: (p) => p * 10,
      mode: 'strong',
    });
    expect(out2.time).toBeNaN();
  });
});
