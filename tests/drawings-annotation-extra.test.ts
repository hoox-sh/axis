/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Annotation extras: flag, anchoredText, arrowMarkUp, arrowMarkDown.
 * Side-effect import registers handlers; tests create / paint / hit.
 */

import { describe, expect, it, mock } from 'bun:test';
import { DRAWING_COLORS, type Point, type TextDrawing } from '../src/chart/drawing-types.ts';
import {
  getToolHandler,
  type ToolHitCtx,
  type ToolViewCtx,
} from '../src/chart/drawings/tools/registry.ts';
// Register tools under test (avoid tools/index — other packs may be pending).
import '../src/chart/drawings/tools/annotation-extra.ts';

const P1: Point = { time: 1_700_000_000, price: 42.5 };

function mockView(overrides?: Partial<ToolViewCtx>): {
  ctx: ToolViewCtx;
  els: Array<{ name: string; attrs: Record<string, string> }>;
  lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  circles: Array<{ x: number; y: number }>;
  labels: Array<{ x: number; y: number; text: string }>;
} {
  const els: Array<{ name: string; attrs: Record<string, string> }> = [];
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const circles: Array<{ x: number; y: number }> = [];
  const labels: Array<{ x: number; y: number; text: string }> = [];
  const ctx: ToolViewCtx = {
    toXY: (p) => ({ x: p.time % 1000, y: 200 - p.price }),
    timeToX: (t) => t % 1000,
    priceToY: (price) => 200 - price,
    width: 800,
    height: 400,
    el: (name, attrs) => {
      els.push({ name, attrs });
      return {} as SVGElement;
    },
    line: (x1, y1, x2, y2) => {
      lines.push({ x1, y1, x2, y2 });
    },
    circle: (x, y) => {
      circles.push({ x, y });
    },
    label: (x, y, text) => {
      labels.push({ x, y, text });
    },
    stroke: '#939fff',
    strokeWidth: 1.5,
    fillOpacity: 0.15,
    selected: false,
    ...overrides,
  };
  return { ctx, els, lines, circles, labels };
}

function hitAt(x: number, y: number, tol = 8): ToolHitCtx {
  return {
    x,
    y,
    tol,
    toXY: (p) => ({ x: p.time % 1000, y: 200 - p.price }),
    timeToX: (t) => t % 1000,
    priceToY: (price) => 200 - price,
    width: 800,
    height: 400,
  };
}

describe('annotation-extra tools', () => {
  it('registers all four handlers with arity 1', () => {
    for (const id of ['flag', 'anchoredText', 'arrowMarkUp', 'arrowMarkDown'] as const) {
      const h = getToolHandler(id);
      expect(h).toBeTruthy();
      expect(h!.arity).toBe(1);
      expect(h!.create).toBeTypeOf('function');
      expect(h!.paint).toBeTypeOf('function');
      expect(h!.hit).toBeTypeOf('function');
    }
  });

  describe('flag', () => {
    it('create returns TextDrawing at p1 without requiring text', () => {
      const h = getToolHandler('flag')!;
      const d = h.create!([P1], '#abc') as TextDrawing | null;
      expect(d).toBeTruthy();
      expect(d!.kind).toBe('flag');
      expect(d!.p1).toEqual(P1);
      expect(d!.color).toBe('#abc');
    });

    it('create returns null without points', () => {
      expect(getToolHandler('flag')!.create!([], '#fff')).toBeNull();
    });

    it('paint draws stem + flag polygon + pin', () => {
      const h = getToolHandler('flag')!;
      const d = h.create!([P1], '#f00') as TextDrawing;
      d.meta = { text: 'A' };
      d.text = 'A';
      const m = mockView();
      h.paint!(d, m.ctx);
      expect(m.lines.length).toBeGreaterThanOrEqual(1);
      expect(m.els.some((e) => e.name === 'polygon')).toBe(true);
      expect(m.circles.length).toBeGreaterThanOrEqual(1);
      expect(m.labels.some((l) => l.text === 'A')).toBe(true);
    });

    it('hit near pin and stem', () => {
      const h = getToolHandler('flag')!;
      const d = h.create!([P1], '#f00') as TextDrawing;
      const xy = { x: P1.time % 1000, y: 200 - P1.price };
      expect(h.hit!(d, hitAt(xy.x, xy.y))).toBe(true);
      expect(h.hit!(d, hitAt(xy.x, xy.y - 12))).toBe(true);
      expect(h.hit!(d, hitAt(xy.x + 80, xy.y + 80))).toBe(false);
    });
  });

  describe('anchoredText', () => {
    it('create prompts for text when window.prompt exists', () => {
      const prev = globalThis.window;
      // @ts-expect-error test shim
      globalThis.window = {
        prompt: mock(() => 'Hello chip'),
      };
      try {
        const h = getToolHandler('anchoredText')!;
        const d = h.create!([P1], '#939fff') as TextDrawing | null;
        expect(d).toBeTruthy();
        expect(d!.kind).toBe('anchoredText');
        expect(d!.text).toBe('Hello chip');
        expect(d!.meta?.text).toBe('Hello chip');
      } finally {
        globalThis.window = prev;
      }
    });

    it('create falls back to Text without window', () => {
      const prev = globalThis.window;
      // @ts-expect-error clear window
      globalThis.window = undefined;
      try {
        const d = getToolHandler('anchoredText')!.create!([P1], '#0ff') as TextDrawing;
        expect(d.text).toBe('Text');
      } finally {
        globalThis.window = prev;
      }
    });

    it('paint draws background chip + label', () => {
      const h = getToolHandler('anchoredText')!;
      const d = {
        id: '1',
        kind: 'anchoredText',
        p1: P1,
        text: 'Chip',
        color: '#939fff',
      } as TextDrawing;
      const m = mockView();
      h.paint!(d, m.ctx);
      expect(m.els.some((e) => e.name === 'rect')).toBe(true);
      expect(m.labels.some((l) => l.text === 'Chip')).toBe(true);
      expect(m.circles.length).toBeGreaterThanOrEqual(1);
    });

    it('hit near anchor', () => {
      const h = getToolHandler('anchoredText')!;
      const d = h.create!([P1], '#fff') as TextDrawing;
      const xy = { x: P1.time % 1000, y: 200 - P1.price };
      expect(h.hit!(d, hitAt(xy.x + 2, xy.y))).toBe(true);
      expect(h.hit!(d, hitAt(0, 0))).toBe(false);
    });
  });

  describe('arrowMarkUp', () => {
    it('create uses DRAWING_COLORS.up when color empty', () => {
      const d = getToolHandler('arrowMarkUp')!.create!([P1], '') as TextDrawing;
      expect(d.kind).toBe('arrowMarkUp');
      expect(d.color).toBe(DRAWING_COLORS.up);
    });

    it('paint draws upward polygon below anchor', () => {
      const h = getToolHandler('arrowMarkUp')!;
      const d = h.create!([P1], DRAWING_COLORS.up) as TextDrawing;
      const m = mockView({ stroke: DRAWING_COLORS.up });
      h.paint!(d, m.ctx);
      const poly = m.els.find((e) => e.name === 'polygon');
      expect(poly).toBeTruthy();
      const pts = poly!.attrs.points!.split(/\s+/).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
      // tip is first vertex; for up-marker tip.y < base.y (screen Y down)
      expect(pts[0]!.y).toBeLessThan(pts[1]!.y);
      expect(poly!.attrs.fill).toBe(DRAWING_COLORS.up);
    });

    it('hit near marker', () => {
      const h = getToolHandler('arrowMarkUp')!;
      const d = h.create!([P1], DRAWING_COLORS.up) as TextDrawing;
      const xy = { x: P1.time % 1000, y: 200 - P1.price };
      expect(h.hit!(d, hitAt(xy.x, xy.y + 6))).toBe(true);
      expect(h.hit!(d, hitAt(xy.x + 100, xy.y + 100))).toBe(false);
    });
  });

  describe('arrowMarkDown', () => {
    it('create uses DRAWING_COLORS.down when color empty', () => {
      const d = getToolHandler('arrowMarkDown')!.create!([P1], '') as TextDrawing;
      expect(d.kind).toBe('arrowMarkDown');
      expect(d.color).toBe(DRAWING_COLORS.down);
    });

    it('paint draws downward polygon above anchor', () => {
      const h = getToolHandler('arrowMarkDown')!;
      const d = h.create!([P1], DRAWING_COLORS.down) as TextDrawing;
      const m = mockView({ stroke: DRAWING_COLORS.down });
      h.paint!(d, m.ctx);
      const poly = m.els.find((e) => e.name === 'polygon');
      expect(poly).toBeTruthy();
      const pts = poly!.attrs.points!.split(/\s+/).map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
      // tip first; for down-marker tip.y > base.y
      expect(pts[0]!.y).toBeGreaterThan(pts[1]!.y);
      expect(poly!.attrs.fill).toBe(DRAWING_COLORS.down);
    });

    it('hit near marker', () => {
      const h = getToolHandler('arrowMarkDown')!;
      const d = h.create!([P1], DRAWING_COLORS.down) as TextDrawing;
      const xy = { x: P1.time % 1000, y: 200 - P1.price };
      expect(h.hit!(d, hitAt(xy.x, xy.y - 6))).toBe(true);
      expect(h.hit!(d, hitAt(500, 500))).toBe(false);
    });
  });

  it('paint/hit no-op for wrong kind', () => {
    const wrong = {
      id: 'x',
      kind: 'note',
      p1: P1,
      text: 'n',
      color: '#fff',
    } as TextDrawing;
    for (const id of ['flag', 'anchoredText', 'arrowMarkUp', 'arrowMarkDown'] as const) {
      const h = getToolHandler(id)!;
      const m = mockView();
      h.paint!(wrong, m.ctx);
      expect(m.els.length).toBe(0);
      expect(h.hit!(wrong, hitAt(0, 0))).toBe(false);
    }
  });
});
