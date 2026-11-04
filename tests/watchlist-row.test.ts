/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { bigPriceSizeClass, formatCompactVolume, rangePercent } from '../src/ui/watchlist-row';

describe('bigPriceSizeClass', () => {
  it('keeps short prices big', () => {
    expect(bigPriceSizeClass('97,412.50')).toBe('axis-wl-big-1'); // 9 chars
    expect(bigPriceSizeClass('0.6234')).toBe('axis-wl-big-1');
    expect(bigPriceSizeClass('—')).toBe('axis-wl-big-1');
  });
  it('steps down for medium prices', () => {
    expect(bigPriceSizeClass('1,234,567.89')).toBe('axis-wl-big-2'); // 12 chars
    expect(bigPriceSizeClass('12,345,678.90')).toBe('axis-wl-big-2'); // 13 chars
  });
  it('shrinks long prices with many decimals', () => {
    expect(bigPriceSizeClass('0.000012345678')).toBe('axis-wl-big-3');
    expect(bigPriceSizeClass('1,234,567,890.12')).toBe('axis-wl-big-3');
  });
});

describe('rangePercent', () => {
  it('places the price inside the 24h range', () => {
    expect(rangePercent(150, 100, 200)).toBe(50);
    expect(rangePercent(100, 100, 200)).toBe(0);
    expect(rangePercent(200, 100, 200)).toBe(100);
    expect(rangePercent(125, 100, 200)).toBe(25);
  });

  it('clamps a price outside the range', () => {
    expect(rangePercent(90, 100, 200)).toBe(0);
    expect(rangePercent(210, 100, 200)).toBe(100);
  });

  it('refuses an unusable range instead of drawing a lie', () => {
    expect(rangePercent(null, 100, 200)).toBeNull();
    expect(rangePercent(150, null, 200)).toBeNull();
    expect(rangePercent(150, 100, null)).toBeNull();
    expect(rangePercent(150, 200, 200)).toBeNull(); // zero-width
    expect(rangePercent(150, 200, 100)).toBeNull(); // inverted
    expect(rangePercent(Number.NaN, 100, 200)).toBeNull();
  });
});

describe('formatCompactVolume', () => {
  it('scales to k / M / B', () => {
    expect(formatCompactVolume(812.4)).toBe('812');
    expect(formatCompactVolume(1_234)).toBe('1.2k');
    expect(formatCompactVolume(1_240_000)).toBe('1.24M');
    expect(formatCompactVolume(3_100_000_000)).toBe('3.10B');
  });

  it('returns null for unknown volume', () => {
    expect(formatCompactVolume(null)).toBeNull();
    expect(formatCompactVolume(Number.NaN)).toBeNull();
    expect(formatCompactVolume(-1)).toBeNull();
  });
});
