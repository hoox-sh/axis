/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { bigPriceSizeClass } from '../src/ui/watchlist-row';

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
