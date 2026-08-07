// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Hardening helpers for drawing tools — points, text, stroke color, clamps.
 * Guards CSS/control-char injection and unbounded geometry/text growth.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  DRAWING_POINTS_MAX,
  DRAWING_TEXT_MAX,
  clampOpacity,
  clampStrokeWidth,
  finiteOr,
  isFinitePoint,
  safePrompt,
  sanitizeDrawingText,
  sanitizePoints,
  sanitizeStrokeColor,
} from '../src/chart/drawings/tools/safe.ts';
import {
  getToolHandler,
  registerToolHandler,
  toolArity,
  type ToolHandler,
} from '../src/chart/drawings/tools/registry.ts';
import type { Drawing, DrawingToolId, Point } from '../src/chart/drawing-types.ts';

const FALLBACK = '#939fff';

describe('isFinitePoint', () => {
  it('accepts finite time/price objects', () => {
    expect(isFinitePoint({ time: 1, price: 2 })).toBe(true);
    expect(isFinitePoint({ time: 0, price: -1.5 })).toBe(true);
  });

  it('rejects non-objects and non-finite coords', () => {
    expect(isFinitePoint(null)).toBe(false);
    expect(isFinitePoint(undefined)).toBe(false);
    expect(isFinitePoint(42)).toBe(false);
    expect(isFinitePoint('x')).toBe(false);
    expect(isFinitePoint({ time: NaN, price: 1 })).toBe(false);
    expect(isFinitePoint({ time: 1, price: Infinity })).toBe(false);
    expect(isFinitePoint({ time: -Infinity, price: 1 })).toBe(false);
    expect(isFinitePoint({ time: '1' as unknown as number, price: 2 })).toBe(false);
    expect(isFinitePoint({ price: 1 })).toBe(false);
    expect(isFinitePoint({})).toBe(false);
  });
});

describe('sanitizePoints', () => {
  it('returns empty for null/undefined/non-array/empty', () => {
    expect(sanitizePoints(null)).toEqual([]);
    expect(sanitizePoints(undefined)).toEqual([]);
    expect(sanitizePoints([] as Point[])).toEqual([]);
    expect(sanitizePoints('nope' as unknown as Point[])).toEqual([]);
  });

  it('drops non-finite points and keeps finite ones', () => {
    const pts = [
      { time: 1, price: 10 },
      { time: NaN, price: 2 },
      { time: 3, price: Infinity },
      { time: 4, price: 40 },
      null as unknown as Point,
      { time: 5, price: 50 },
    ];
    expect(sanitizePoints(pts)).toEqual([
      { time: 1, price: 10 },
      { time: 4, price: 40 },
      { time: 5, price: 50 },
    ]);
  });

  it('drops non-number coords (isFinitePoint requires finite numbers)', () => {
    expect(sanitizePoints([{ time: '1' as unknown as number, price: 2 }])).toEqual([]);
  });

  it('caps length at DRAWING_POINTS_MAX by default', () => {
    const many: Point[] = Array.from({ length: DRAWING_POINTS_MAX + 50 }, (_, i) => ({
      time: i,
      price: i,
    }));
    const out = sanitizePoints(many);
    expect(out).toHaveLength(DRAWING_POINTS_MAX);
    expect(out[0]).toEqual({ time: 0, price: 0 });
    expect(out[out.length - 1]).toEqual({
      time: DRAWING_POINTS_MAX - 1,
      price: DRAWING_POINTS_MAX - 1,
    });
  });

  it('respects custom max and counts only kept points toward cap', () => {
    const pts: Point[] = [
      { time: 1, price: 1 },
      { time: NaN, price: 2 },
      { time: 3, price: 3 },
      { time: 4, price: 4 },
      { time: 5, price: 5 },
    ];
    expect(sanitizePoints(pts, 2)).toEqual([
      { time: 1, price: 1 },
      { time: 3, price: 3 },
    ]);
  });
});

describe('sanitizeDrawingText', () => {
  it('maps null/undefined to empty string', () => {
    expect(sanitizeDrawingText(null)).toBe('');
    expect(sanitizeDrawingText(undefined)).toBe('');
  });

  it('stringifies non-strings', () => {
    expect(sanitizeDrawingText(42)).toBe('42');
    expect(sanitizeDrawingText(true)).toBe('true');
  });

  it('strips control characters', () => {
    expect(sanitizeDrawingText('a\u0000b\u0007c\u001Fd')).toBe('abcd');
    expect(sanitizeDrawingText('hi\u007Fthere')).toBe('hithere');
  });

  it('preserves tab/newline by collapsing whitespace', () => {
    // \t and \n are whitespace; control strip keeps them, then collapse+trim
    expect(sanitizeDrawingText('  hello\n\tworld  ')).toBe('hello world');
    expect(sanitizeDrawingText('a   b\tc')).toBe('a b c');
  });

  it('caps length at DRAWING_TEXT_MAX', () => {
    const long = 'x'.repeat(DRAWING_TEXT_MAX + 40);
    const out = sanitizeDrawingText(long);
    expect(out).toHaveLength(DRAWING_TEXT_MAX);
    expect(out).toBe('x'.repeat(DRAWING_TEXT_MAX));
  });

  it('respects custom max after strip/collapse', () => {
    expect(sanitizeDrawingText('abcdef', 3)).toBe('abc');
    // collapse → "ab cd", then slice(0, 4)
    expect(sanitizeDrawingText('  ab  cd  ', 4)).toBe('ab c');
  });
});

describe('sanitizeStrokeColor', () => {
  it('accepts hex colors', () => {
    expect(sanitizeStrokeColor('#fff')).toBe('#fff');
    expect(sanitizeStrokeColor('#fffa')).toBe('#fffa');
    expect(sanitizeStrokeColor('#939fff')).toBe('#939fff');
    expect(sanitizeStrokeColor('#939fff80')).toBe('#939fff80');
    expect(sanitizeStrokeColor('  #AbC  ')).toBe('#AbC');
  });

  it('accepts rgb/hsl forms without trailing junk', () => {
    expect(sanitizeStrokeColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(sanitizeStrokeColor('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)');
    expect(sanitizeStrokeColor('hsl(200, 50%, 40%)')).toBe('hsl(200, 50%, 40%)');
    expect(sanitizeStrokeColor('hsla(200 50% 40% / 0.4)')).toBe('hsla(200 50% 40% / 0.4)');
  });

  it('accepts named colors and safe var()/color-mix()', () => {
    expect(sanitizeStrokeColor('red')).toBe('red');
    expect(sanitizeStrokeColor('transparent')).toBe('transparent');
    expect(sanitizeStrokeColor('var(--accent)')).toBe('var(--accent)');
    expect(sanitizeStrokeColor('color-mix(in srgb, red, blue)')).toBe(
      'color-mix(in srgb, red, blue)',
    );
  });

  it('rejects empty / overlong / invalid', () => {
    expect(sanitizeStrokeColor('')).toBe(FALLBACK);
    expect(sanitizeStrokeColor(null)).toBe(FALLBACK);
    expect(sanitizeStrokeColor(undefined)).toBe(FALLBACK);
    expect(sanitizeStrokeColor('x'.repeat(65))).toBe(FALLBACK);
    expect(sanitizeStrokeColor('#gg')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('#12')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('not a color!!!')).toBe(FALLBACK);
  });

  it('rejects url( injection', () => {
    expect(sanitizeStrokeColor('url(https://evil.example/x)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('URL(//x)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('red url(x)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('rgb(0,0,0)url(x)')).toBe(FALLBACK);
  });

  it('rejects expression and script schemes', () => {
    expect(sanitizeStrokeColor('expression(alert(1))')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('Expression(foo)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('javascript:alert(1)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('vbscript:msgbox(1)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('data:image/svg+xml,x')).toBe(FALLBACK);
  });

  it('rejects newlines and control characters', () => {
    expect(sanitizeStrokeColor('red\nurl(x)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('rgb(0,0,0)\nbackground:url(x)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('#fff\r\nurl(x)')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('red\u0000')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('blue\u2028url(x)')).toBe(FALLBACK);
  });

  it('rejects trailing junk after functional colors', () => {
    expect(sanitizeStrokeColor('rgb(0,0,0);color:red')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('hsl(0,0%,0%)!important')).toBe(FALLBACK);
    expect(sanitizeStrokeColor('var(--x);url(y)')).toBe(FALLBACK);
  });

  it('uses custom fallback', () => {
    expect(sanitizeStrokeColor('url(x)', '#000')).toBe('#000');
  });
});

describe('finiteOr / clampOpacity / clampStrokeWidth', () => {
  it('finiteOr returns finite numbers and fallback otherwise', () => {
    expect(finiteOr(3, 0)).toBe(3);
    expect(finiteOr('4.5', 0)).toBe(4.5);
    expect(finiteOr(NaN, 9)).toBe(9);
    expect(finiteOr(Infinity, 9)).toBe(9);
    expect(finiteOr(undefined, 9)).toBe(9);
    expect(finiteOr('nope', 9)).toBe(9);
  });

  it('clampOpacity stays in [0, 1]', () => {
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(NaN)).toBe(0.15);
    expect(clampOpacity(undefined, 0.3)).toBe(0.3);
  });

  it('clampStrokeWidth stays in [0.5, 32]', () => {
    expect(clampStrokeWidth(2)).toBe(2);
    expect(clampStrokeWidth(0)).toBe(0.5);
    expect(clampStrokeWidth(100)).toBe(32);
    expect(clampStrokeWidth(NaN)).toBe(1.5);
    expect(clampStrokeWidth('3', 2)).toBe(3);
  });
});

describe('safePrompt', () => {
  it('returns sanitized fallback without window', () => {
    const prev = globalThis.window;
    // @ts-expect-error clear window for SSR path
    globalThis.window = undefined;
    try {
      expect(safePrompt('Label?', 'Fallback')).toBe('Fallback');
    } finally {
      globalThis.window = prev;
    }
  });

  it('returns fallback when prompt is cancelled (null)', () => {
    const prev = globalThis.window;
    // @ts-expect-error test shim
    globalThis.window = { prompt: () => null };
    try {
      expect(safePrompt('Label?', 'Note')).toBe('Note');
    } finally {
      globalThis.window = prev;
    }
  });

  it('sanitizes user input from prompt', () => {
    const prev = globalThis.window;
    // @ts-expect-error test shim
    globalThis.window = { prompt: () => '  hi\u0000\nthere  ' };
    try {
      expect(safePrompt('Label?', 'Note')).toBe('hi there');
    } finally {
      globalThis.window = prev;
    }
  });

  it('falls back when sanitized input is empty', () => {
    const prev = globalThis.window;
    // @ts-expect-error test shim
    globalThis.window = { prompt: () => '   ' };
    try {
      expect(safePrompt('Label?', 'Default')).toBe('Default');
    } finally {
      globalThis.window = prev;
    }
  });

  it('uses Note when both input and fallback sanitize empty', () => {
    const prev = globalThis.window;
    // @ts-expect-error test shim
    globalThis.window = { prompt: () => '\u0000' };
    try {
      expect(safePrompt('Label?', '\u0000')).toBe('Note');
    } finally {
      globalThis.window = prev;
    }
  });

  it('swallows prompt throws', () => {
    const prev = globalThis.window;
    // @ts-expect-error test shim
    globalThis.window = {
      prompt: () => {
        throw new Error('blocked');
      },
    };
    try {
      expect(safePrompt('Label?', 'Safe')).toBe('Safe');
    } finally {
      globalThis.window = prev;
    }
  });
});

describe('registry toolArity n-point fallbacks', () => {
  it('lists brush, highlighter, xabcd, headShoulders as n', () => {
    for (const id of ['brush', 'highlighter', 'xabcd', 'headShoulders'] as const) {
      expect(toolArity(id)).toBe('n');
    }
  });
});

describe('registerToolHandler paint wrapper', () => {
  const testId = '__safe_test_throw__' as DrawingToolId;

  afterEach(() => {
    // Leave a no-op handler so the map entry is inert (no unregister API).
    registerToolHandler({
      id: testId,
      label: 'test-clean',
      arity: 1,
    });
  });

  it('swallows paint/hit/create throws so the layer cannot be taken down', () => {
    const prevWarn = console.warn;
    console.warn = () => {};

    try {
      registerToolHandler({
        id: testId,
        label: 'test-throw',
        arity: 1,
        paint: () => {
          throw new Error('paint boom');
        },
        hit: () => {
          throw new Error('hit boom');
        },
        create: () => {
          throw new Error('create boom');
        },
        paintDraft: () => {
          throw new Error('draft boom');
        },
      } as ToolHandler);

      const h = getToolHandler(testId);
      expect(h).toBeDefined();

      const fakeDrawing = { id: 'd', kind: 'trend', points: [] } as unknown as Drawing;
      const fakeView = {} as Parameters<NonNullable<ToolHandler['paint']>>[1];
      const fakeHit = {} as Parameters<NonNullable<ToolHandler['hit']>>[1];

      expect(() => h!.paint?.(fakeDrawing, fakeView)).not.toThrow();
      expect(h!.hit?.(fakeDrawing, fakeHit)).toBe(false);
      expect(h!.create?.([], '#fff')).toBeNull();
      expect(() => h!.paintDraft?.([], fakeView)).not.toThrow();
    } finally {
      console.warn = prevWarn;
    }
  });
});
