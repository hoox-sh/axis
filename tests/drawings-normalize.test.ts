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
 * User-drawing normalize (legacy localStorage shapes + points-based).
 */

import { describe, expect, it } from 'bun:test';
import {
  normalizeDrawing,
  normalizeUserDrawings,
} from '../src/chart/drawings/normalize.ts';
import { DRAWING_COLORS } from '../src/chart/drawing-types.ts';

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

  it('two-point: trend / ray / rect / fib / measure preserve p1+p2', () => {
    const kinds = ['trend', 'ray', 'rect', 'fib', 'measure'] as const;
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

describe('normalizeDrawing — invalid / garbage', () => {
  it('drops null, non-objects, unknown kinds', () => {
    expect(normalizeDrawing(null)).toBeNull();
    expect(normalizeDrawing(undefined)).toBeNull();
    expect(normalizeDrawing(42)).toBeNull();
    expect(normalizeDrawing('hline')).toBeNull();
    expect(normalizeDrawing({ kind: 'cursor' })).toBeNull();
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
    ]);
    expect(out).toHaveLength(4);
    expect(out.map((d) => d.kind)).toEqual(['hline', 'text', 'trend', 'ray']);
    expect(out[0]!.points[0]!.price).toBe(99);
    expect(out[1]!.meta?.text).toBe('hi');
    expect(out[2]!.points).toEqual([
      { time: 5, price: 6 },
      { time: 7, price: 8 },
    ]);
    expect(out[3]!.style.extendRight).toBe(true);
  });

  it('non-array → empty', () => {
    expect(normalizeUserDrawings(null)).toEqual([]);
    expect(normalizeUserDrawings(undefined)).toEqual([]);
    expect(normalizeUserDrawings({})).toEqual([]);
    expect(normalizeUserDrawings('[]')).toEqual([]);
  });
});
