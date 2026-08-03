/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure drawing copy / merge / symbol-filter helpers.
 * Guards multi-chart template duplication without mounting LWC or the store.
 */

import { describe, expect, it } from 'bun:test';
import {
  cloneDrawing,
  cloneDrawings,
  cloneDrawingsOffset,
  deepCloneDrawing,
  drawingsForSymbol,
  mergeDrawings,
  newDrawingId,
  offsetDrawingGeometry,
  tagDrawingsSymbol,
  type DrawingSyncLike,
} from '../src/chart/drawings/sync.ts';

function hline(id: string, price: number, symbol?: string): DrawingSyncLike {
  return {
    id,
    kind: 'hline',
    color: '#939fff',
    price,
    points: [{ time: 0, price }],
    meta: symbol ? { symbol } : {},
  };
}

function trend(
  id: string,
  p1: { time: number; price: number },
  p2: { time: number; price: number },
  symbol?: string,
): DrawingSyncLike {
  return {
    id,
    kind: 'trend',
    color: '#939fff',
    p1: { ...p1 },
    p2: { ...p2 },
    points: [
      { ...p1 },
      { ...p2 },
    ],
    meta: symbol ? { symbol } : {},
  };
}

describe('drawing sync helpers', () => {
  describe('newDrawingId', () => {
    it('returns unique dw_ ids', () => {
      const a = newDrawingId();
      const b = newDrawingId();
      expect(a).toMatch(/^dw_/);
      expect(b).toMatch(/^dw_/);
      expect(a).not.toBe(b);
    });
  });

  describe('deepCloneDrawing', () => {
    it('does not share nested references', () => {
      const src = hline('a', 100, 'BTCUSDT');
      const copy = deepCloneDrawing(src);
      expect(copy).toEqual(src);
      expect(copy).not.toBe(src);
      expect(copy.meta).not.toBe(src.meta);
      expect(copy.points).not.toBe(src.points);
      (copy.meta as { symbol: string }).symbol = 'ETHUSDT';
      expect(src.meta?.symbol).toBe('BTCUSDT');
    });
  });

  describe('cloneDrawings', () => {
    it('assigns new ids and leaves source unchanged', () => {
      const src = [hline('h1', 10), trend('t1', { time: 1, price: 2 }, { time: 3, price: 4 })];
      const clones = cloneDrawings(src);
      expect(clones).toHaveLength(2);
      expect(clones[0]!.id).not.toBe('h1');
      expect(clones[1]!.id).not.toBe('t1');
      expect(clones[0]!.id).not.toBe(clones[1]!.id);
      expect(src[0]!.id).toBe('h1');
      expect(clones[0]!.price).toBe(10);
      expect(clones[1]!.p1).toEqual({ time: 1, price: 2 });
    });

    it('optionally stamps meta.symbol (uppercased)', () => {
      const clones = cloneDrawings([hline('h1', 1)], { symbol: 'ethusdt' });
      expect(clones[0]!.meta?.symbol).toBe('ETHUSDT');
      expect(clones[0]!.id).not.toBe('h1');
    });

    it('returns empty for empty input', () => {
      expect(cloneDrawings([])).toEqual([]);
    });

    it('cloneDrawing accepts custom idFactory', () => {
      let n = 0;
      const c = cloneDrawing(hline('x', 5), {
        idFactory: () => `custom_${++n}`,
      });
      expect(c.id).toBe('custom_1');
    });
  });

  describe('drawingsForSymbol', () => {
    const list = [
      hline('a', 1, 'BTCUSDT'),
      hline('b', 2, 'ethusdt'),
      hline('c', 3), // untagged
      hline('d', 4, 'BTCUSDT'),
    ];

    it('matches case-insensitively on meta.symbol', () => {
      const got = drawingsForSymbol(list, 'btcusdt');
      expect(got.map((d) => d.id)).toEqual(['a', 'd']);
    });

    it('excludes untagged by default', () => {
      const got = drawingsForSymbol(list, 'BTCUSDT');
      expect(got.some((d) => d.id === 'c')).toBe(false);
    });

    it('includeUntagged keeps global drawings', () => {
      const got = drawingsForSymbol(list, 'BTCUSDT', { includeUntagged: true });
      expect(got.map((d) => d.id)).toEqual(['a', 'c', 'd']);
    });

    it('empty symbol yields empty', () => {
      expect(drawingsForSymbol(list, '  ')).toEqual([]);
    });
  });

  describe('tagDrawingsSymbol', () => {
    it('stamps all clones with uppercased symbol', () => {
      const src = [hline('a', 1), hline('b', 2, 'OLD')];
      const tagged = tagDrawingsSymbol(src, 'solusdt');
      expect(tagged.every((d) => d.meta?.symbol === 'SOLUSDT')).toBe(true);
      expect(src[1]!.meta?.symbol).toBe('OLD');
      expect(tagged[0]!.id).toBe('a');
    });
  });

  describe('mergeDrawings', () => {
    it('replace returns only incoming (cloned)', () => {
      const base = [hline('a', 1)];
      const incoming = [hline('b', 2)];
      const out = mergeDrawings(base, incoming, 'replace');
      expect(out.map((d) => d.id)).toEqual(['b']);
      expect(out[0]).not.toBe(incoming[0]);
      expect(base).toHaveLength(1);
    });

    it('append concatenates and re-ids collisions', () => {
      const base = [hline('a', 1), hline('b', 2)];
      const incoming = [hline('b', 99), hline('c', 3)];
      const out = mergeDrawings(base, incoming, 'append');
      expect(out).toHaveLength(4);
      expect(out[0]!.id).toBe('a');
      expect(out[1]!.id).toBe('b');
      expect(out[1]!.price).toBe(2);
      // collision on 'b' → new id for the appended copy
      expect(out[2]!.id).not.toBe('b');
      expect(out[2]!.price).toBe(99);
      expect(out[3]!.id).toBe('c');
      const ids = new Set(out.map((d) => d.id));
      expect(ids.size).toBe(4);
    });

    it('append with no collision preserves ids', () => {
      const out = mergeDrawings([hline('a', 1)], [hline('b', 2)], 'append');
      expect(out.map((d) => d.id)).toEqual(['a', 'b']);
    });
  });

  describe('offsetDrawingGeometry / cloneDrawingsOffset', () => {
    it('shifts dual-shape geometry', () => {
      const d = trend('t', { time: 100, price: 10 }, { time: 200, price: 20 });
      const o = offsetDrawingGeometry(d, { dTime: 5, dPrice: -1 });
      expect(o.id).toBe('t');
      expect(o.p1).toEqual({ time: 105, price: 9 });
      expect(o.p2).toEqual({ time: 205, price: 19 });
      expect(o.points).toEqual([
        { time: 105, price: 9 },
        { time: 205, price: 19 },
      ]);
      // source intact
      expect(d.p1).toEqual({ time: 100, price: 10 });
    });

    it('shifts hline price and vline time', () => {
      const h = offsetDrawingGeometry(hline('h', 50), { dPrice: 2.5 });
      expect(h.price).toBe(52.5);
      const v: DrawingSyncLike = {
        id: 'v',
        kind: 'vline',
        time: 1000,
        color: '#fff',
      };
      const vo = offsetDrawingGeometry(v, { dTime: 10 });
      expect(vo.time).toBe(1010);
    });

    it('cloneDrawingsOffset combines new ids and offset', () => {
      const src = [trend('t', { time: 0, price: 0 }, { time: 10, price: 10 })];
      const out = cloneDrawingsOffset(src, {
        dTime: 1,
        dPrice: 2,
        symbol: 'BTCUSDT',
      });
      expect(out[0]!.id).not.toBe('t');
      expect(out[0]!.p1).toEqual({ time: 1, price: 2 });
      expect(out[0]!.meta?.symbol).toBe('BTCUSDT');
      expect(src[0]!.p1).toEqual({ time: 0, price: 0 });
    });
  });

  describe('duplicate + keep-symbol recipe (UI paths)', () => {
    it('duplicate = merge(base, cloneDrawings(base), append)', () => {
      const base = [hline('h1', 1, 'BTCUSDT'), hline('h2', 2)];
      const next = mergeDrawings(base, cloneDrawings(base, { symbol: 'BTCUSDT' }), 'append');
      expect(next).toHaveLength(4);
      const ids = new Set(next.map((d) => d.id));
      expect(ids.size).toBe(4);
      // clones tagged
      expect(next[2]!.meta?.symbol).toBe('BTCUSDT');
      expect(next[3]!.meta?.symbol).toBe('BTCUSDT');
    });

    it('keep this symbol includes untagged', () => {
      const list = [
        hline('a', 1, 'BTCUSDT'),
        hline('b', 2, 'ETHUSDT'),
        hline('c', 3),
      ];
      const kept = drawingsForSymbol(list, 'BTCUSDT', { includeUntagged: true });
      expect(kept.map((d) => d.id)).toEqual(['a', 'c']);
    });
  });
});
