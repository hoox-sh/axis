/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Inline Pine color chips — decoration builder from scanPineColors.
 */

import { describe, expect, it } from 'bun:test';
import { buildColorChipDecorations } from '../src/editor/color-chips';

describe('buildColorChipDecorations', () => {
  it('returns none for empty / color-free source', () => {
    expect(buildColorChipDecorations('').size).toBe(0);
    expect(buildColorChipDecorations('//@version=6\nindicator("x")\n').size).toBe(
      0,
    );
  });

  it('places a chip before each hex and named color', () => {
    const src = `plot(close, color=#FF0000)\nplot(open, color=color.blue)`;
    const set = buildColorChipDecorations(src);
    // #FF0000 + color.blue
    expect(set.size).toBe(2);
  });

  it('places chips for color.rgb and color.new', () => {
    const src = `c1 = color.rgb(10, 20, 30)\nc2 = color.new(color.red, 50)`;
    const set = buildColorChipDecorations(src);
    // color.rgb(...) + color.new(...) + nested color.red
    expect(set.size).toBeGreaterThanOrEqual(2);
    expect(set.size).toBeLessThanOrEqual(3);
  });

  it('skips colors in line comments', () => {
    const src = `// plot color=#00FF00\nplot(1, color=#0000FF)`;
    const set = buildColorChipDecorations(src);
    expect(set.size).toBe(1);
  });
});
