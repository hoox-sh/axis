// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  isMultiColorKind,
  levelKey,
  levelSwatches,
  resolveLevelPaint,
} from '../src/chart/drawings/level-palette.ts';

describe('classic level palette', () => {
  it('canonicalizes the common fib ratios', () => {
    expect(levelKey(0.618)).toBe('0.618');
    expect(levelKey(0.5)).toBe('0.5');
    expect(levelKey(1)).toBe('1');
    expect(levelKey(0.6180004)).toBe('0.618');
  });

  it('uses classic fib and gann colors unless overridden or turned off', () => {
    expect(resolveLevelPaint({ kind: 'fib' }, '0.618', '#111111')).toBe('#089981');
    expect(resolveLevelPaint({ kind: 'fib', meta: { multiColor: false } }, '0.618', '#111111')).toBe(
      '#111111',
    );
    expect(
      resolveLevelPaint(
        { kind: 'fib', meta: { levelColors: { '0.618': '#abcdef' } } },
        '0.618',
        '#111111',
      ),
    ).toBe('#abcdef');
    expect(resolveLevelPaint({ kind: 'gannFan' }, '1x1', '#111111')).toBe('#2962FF');
  });

  it('limits multi-color to fib, gann, and pitchfork', () => {
    expect(isMultiColorKind('trend')).toBe(false);
    expect(isMultiColorKind('fib')).toBe(true);
    expect(isMultiColorKind('gannFan')).toBe(true);
    expect(isMultiColorKind('pitchfork')).toBe(true);
    expect(levelSwatches('gannFan').map((s) => s.key)).toEqual([
      '1x1',
      '1x2',
      '2x1',
      '1x3',
      '3x1',
      '1x4',
      '4x1',
    ]);
    expect(levelSwatches('trend')).toEqual([]);
  });
});
