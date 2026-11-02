/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Phone-header quote: painted close and signed percent versus the previous bar.
 */

import { describe, expect, it } from 'bun:test';
import { formatPriceWithDecimals } from '../src/chart/price-precision';
import { headerQuote } from '../src/ui/mobile/header-quote';

describe('headerQuote', () => {
  it('returns null when the price is NaN', () => {
    expect(headerQuote({ price: Number.NaN, prevClose: 90 })).toBeNull();
  });

  it('formats an up move at two decimals', () => {
    expect(headerQuote({ price: 100, prevClose: 90, decimals: 2 })).toEqual({
      price: formatPriceWithDecimals(100, 2),
      change: '+11.11%',
      tone: 'up',
    });
  });

  it('marks a lower price down', () => {
    const down = headerQuote({ price: 80, prevClose: 100, decimals: 2 });
    expect(down?.tone).toBe('down');
    expect(down?.change?.startsWith('-')).toBe(true);
  });

  it('omits the change when the previous close is missing', () => {
    expect(headerQuote({ price: 100, decimals: 2 })).toEqual({
      price: formatPriceWithDecimals(100, 2),
      change: null,
      tone: 'flat',
    });
  });

  it('omits the change when the previous close is zero', () => {
    const flat = headerQuote({ price: 100, prevClose: 0, decimals: 2 });
    expect(flat?.change).toBeNull();
    expect(flat?.tone).toBe('flat');
  });

  it('flattens a move that rounds to 0.00%', () => {
    expect(headerQuote({ price: 100.001, prevClose: 100, decimals: 2 })).toMatchObject({
      change: '0.00%',
      tone: 'flat',
    });
    expect(headerQuote({ price: 99.999, prevClose: 100, decimals: 2 })).toMatchObject({
      change: '0.00%',
      tone: 'flat',
    });
  });
});
