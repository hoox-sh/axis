/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine color scan / convert / replace helpers for the editor color tools.
 */

import { describe, expect, it } from 'bun:test';
import {
  alphaToTransp,
  colorFormats,
  formatPickedChipColor,
  formatReplacement,
  parseColorInput,
  parseHexColor,
  parseNamedColor,
  replaceColorHit,
  rewriteColorKeepingFormat,
  scanPineColors,
  toHex6,
  toPineNew,
  toPineRgb,
  transpToAlpha,
  uniqueColorChips,
} from '../src/editor/pine-colors';

describe('parseHexColor / named', () => {
  it('parses #rgb and #rrggbb', () => {
    expect(parseHexColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseHexColor('#FF0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
  });

  it('parses named Pine colors', () => {
    expect(parseNamedColor('color.red')).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(parseNamedColor('blue')).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  });
});

describe('parseColorInput', () => {
  it('parses color.rgb and color.new', () => {
    const rgb = parseColorInput('color.rgb(10, 20, 30)');
    expect(rgb).toMatchObject({ r: 10, g: 20, b: 30, a: 255 });
    const withT = parseColorInput('color.rgb(10, 20, 30, 50)');
    expect(withT!.a).toBe(transpToAlpha(50));
    const neu = parseColorInput('color.new(#00FF00, 25)');
    expect(neu).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(neu!.a).toBe(transpToAlpha(25));
  });

  it('parses rgba()', () => {
    const c = parseColorInput('rgba(1, 2, 3, 0.5)');
    expect(c!.r).toBe(1);
    expect(c!.a).toBe(128);
  });
});

describe('formats', () => {
  it('builds hex / pine forms', () => {
    const c = { r: 255, g: 0, b: 0, a: 255 };
    expect(toHex6(c)).toBe('#FF0000');
    expect(toPineRgb(c)).toBe('color.rgb(255, 0, 0)');
    expect(toPineNew({ ...c, a: transpToAlpha(50) }, '#FF0000')).toBe(
      'color.new(#FF0000, 50)',
    );
    const f = colorFormats(c);
    expect(f.named).toBe('color.red');
  });

  it('alphaToTransp / transpToAlpha round-trip roughly', () => {
    expect(alphaToTransp(255)).toBe(0);
    expect(alphaToTransp(0)).toBe(100);
    expect(transpToAlpha(0)).toBe(255);
    expect(transpToAlpha(100)).toBe(0);
  });
});

describe('scanPineColors', () => {
  it('finds hex, named, rgb, and new in a script', () => {
    const src = `//@version=5
indicator("t")
plot(close, color=color.red)
plot(open, color=#00ff00)
plot(high, color=color.rgb(1, 2, 3))
plot(low, color=color.new(#0000FF, 50))
// color.blue ignored in comment
`;
    const hits = scanPineColors(src);
    const kinds = hits.map((h) => h.kind).sort();
    expect(kinds).toContain('named');
    expect(kinds).toContain('hex');
    expect(kinds).toContain('rgb');
    expect(kinds).toContain('new');
    // comment color.blue should not appear
    expect(hits.some((h) => h.text.includes('color.blue'))).toBe(false);
  });

  it('uniqueColorChips dedupes', () => {
    const src = 'color.red\ncolor.red\n#FF0000\n';
    const chips = uniqueColorChips(scanPineColors(src));
    // red named + same hex may share rgba key
    expect(chips.length).toBeGreaterThanOrEqual(1);
    const red = chips.find((c) => c.r === 255 && c.g === 0 && c.b === 0);
    expect(red!.count).toBeGreaterThanOrEqual(2);
  });
});

describe('replaceColorHit / formatReplacement', () => {
  it('replaces a hit range', () => {
    const src = 'plot(close, color=color.red)';
    const hits = scanPineColors(src);
    const hit = hits.find((h) => h.kind === 'named')!;
    const next = replaceColorHit(src, hit, '#00FF00');
    expect(next).toBe('plot(close, color=#00FF00)');
  });

  it('formatReplacement respects style', () => {
    expect(formatReplacement(255, 0, 0, 0, 'named')).toBe('color.red');
    expect(formatReplacement(1, 2, 3, 0, 'rgb')).toBe('color.rgb(1, 2, 3)');
    expect(formatReplacement(1, 2, 3, 40, 'new')).toBe('color.new(#010203, 40)');
  });

  it('formatPickedChipColor keeps kind and transparency', () => {
    expect(
      formatPickedChipColor({ kind: 'named', transp: 0 }, '#00FE00'),
    ).toBe('#00FE00');
    expect(
      formatPickedChipColor({ kind: 'named', transp: 0 }, '#FF0000'),
    ).toBe('color.red');
    expect(
      formatPickedChipColor({ kind: 'named', transp: 0 }, '#00FF00'),
    ).toBe('color.lime');
    expect(
      formatPickedChipColor({ kind: 'rgb', transp: 50 }, '#010203'),
    ).toBe('color.rgb(1, 2, 3, 50)');
    expect(
      formatPickedChipColor({ kind: 'new', transp: 40 }, '#0000FF'),
    ).toBe('color.new(#0000FF, 40)');
    expect(
      formatPickedChipColor({ kind: 'hex', transp: 0 }, '#abc'),
    ).toBe('#AABBCC');
  });

  it('rewriteColorKeepingFormat preserves rgb/rgba/named/hex', () => {
    const green = { r: 0, g: 255, b: 0, a: 255 };
    expect(rewriteColorKeepingFormat('color.red', green)).toBe('color.lime');
    expect(rewriteColorKeepingFormat('#FF0000', green)).toBe('#00FF00');
    expect(rewriteColorKeepingFormat('rgb(255, 0, 0)', green)).toBe('rgb(0, 255, 0)');
    expect(rewriteColorKeepingFormat('rgba(255, 0, 0, 0.5)', green)).toBe(
      'rgba(0, 255, 0, 0.502)',
    );
    expect(rewriteColorKeepingFormat('color.rgb(1, 2, 3)', green)).toBe(
      'color.rgb(0, 255, 0)',
    );
  });
});
