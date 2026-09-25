/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Unit: resolvePineColor — Pine/engine forms → CSS, junk → null. */

import { describe, expect, it } from 'bun:test';
import { resolvePineColor } from '../src/results/pine-color';

describe('resolvePineColor', () => {
  it('resolves named color.* tokens to hex', () => {
    expect(resolvePineColor('color.red')).toBe('#ff0000');
    expect(resolvePineColor('color.teal')).toBe('#008080');
    expect(resolvePineColor('color.GRAY')).toBe('#808080');
  });

  it('resolves color.new transparency to rgba', () => {
    expect(resolvePineColor('color.new(color.blue, 0)')).toBe('#0000ff');
    expect(resolvePineColor('color.new(#ff0000, 50)')).toBe('rgba(255, 0, 0, 0.502)');
    expect(resolvePineColor('color.new(color.teal, 85)')).toBe('rgba(0, 128, 128, 0.149)');
  });

  it('resolves color.rgb forms', () => {
    expect(resolvePineColor('color.rgb(255, 0, 0)')).toBe('#ff0000');
    expect(resolvePineColor('color.rgb(0, 128, 128, 50)')).toBe('rgba(0, 128, 128, 0.502)');
  });

  it('passes valid CSS through unchanged', () => {
    expect(resolvePineColor('#ff00ff')).toBe('#ff00ff');
    expect(resolvePineColor('#f0f')).toBe('#f0f');
    expect(resolvePineColor('#F23645')).toBe('#F23645');
    expect(resolvePineColor('rgba(8, 153, 129, 0.15)')).toBe('rgba(8, 153, 129, 0.15)');
    // bare CSS names canonicalize via the Pine table (same color, exact hex)
    expect(resolvePineColor('red')).toBe('#ff0000');
  });

  it('returns null for inactive / unknown / unsafe', () => {
    expect(resolvePineColor(null)).toBeNull();
    expect(resolvePineColor('')).toBeNull();
    expect(resolvePineColor('na')).toBeNull();
    expect(resolvePineColor('color.from_gradient(close, 0, 100, color.red, color.green)')).toBeNull();
    expect(resolvePineColor('color.nope')).toBeNull();
    expect(resolvePineColor('url(evil)')).toBeNull();
    expect(resolvePineColor('expression(alert(1))')).toBeNull();
    expect(resolvePineColor('rgba(1,2,3,0)')).toBeNull();
  });
});
