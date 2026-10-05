/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { buildTickerRows, formatTickerRow } from '../src/ui/extras/format';

describe('formatTickerRow', () => {
  it('formats symbol, price, signed pct', () => {
    expect(formatTickerRow({ symbol: 'BTCUSDT', price: 97412.5, change: 1.2 }))
      .toBe('BTCUSDT 97,412.50 +1.2%');
    expect(formatTickerRow({ symbol: 'ETHUSDT', price: 3842, change: undefined }))
      .toBe('ETHUSDT 3,842.00 —');
  });

  it('omits the change with showChange: false', () => {
    expect(formatTickerRow({ symbol: 'BTCUSDT', price: 97412.5, change: 1.2 }, { showChange: false }))
      .toBe('BTCUSDT 97,412.50');
    expect(formatTickerRow({ symbol: 'ETHUSDT', price: 3842, change: undefined }, { showChange: false }))
      .toBe('ETHUSDT 3,842.00');
  });
});

describe('buildTickerRows', () => {
  const quotes = {
    BTCUSDT: { price: 97412.5, change: 1.2 },
    ETHUSDT: { price: 3842, change: -0.4 },
  };

  it('splits symbol / price / signed change in caller order', () => {
    expect(buildTickerRows(['BTCUSDT', 'ETHUSDT'], quotes)).toEqual([
      {
        symbol: 'BTCUSDT',
        price: '97,412.50',
        change: '+1.2%',
        up: true,
        hasPrice: true,
        hasChange: true,
      },
      {
        symbol: 'ETHUSDT',
        price: '3,842.00',
        change: '-0.4%',
        up: false,
        hasPrice: true,
        hasChange: true,
      },
    ]);
  });

  it('degrades unknown values to a pending row instead of throwing', () => {
    const [row] = buildTickerRows(['SOLUSDT'], {});
    expect(row).toEqual({
      symbol: 'SOLUSDT',
      price: '—',
      change: null,
      up: true,
      hasPrice: false,
      hasChange: false,
    });
  });

  it('treats a missing change as neutral, not down', () => {
    const [row] = buildTickerRows(['ETHUSDT'], { ETHUSDT: { price: 3842 } });
    expect(row.up).toBe(true);
    expect(row.change).toBeNull();
    expect(row.hasChange).toBe(false);
  });

  it('drops the change with showChange: false but keeps direction data', () => {
    const [row] = buildTickerRows(['ETHUSDT'], quotes, { showChange: false });
    expect(row.change).toBeNull();
    expect(row.up).toBe(false);
    expect(row.price).toBe('3,842.00');
  });

  it('ignores non-finite quotes', () => {
    const [row] = buildTickerRows(['BTCUSDT'], {
      BTCUSDT: { price: Number.NaN, change: Number.POSITIVE_INFINITY },
    });
    expect(row.hasPrice).toBe(false);
    expect(row.hasChange).toBe(false);
    expect(row.price).toBe('—');
  });

  it('returns one row per symbol with no duplicates or reordering', () => {
    const rows = buildTickerRows(['ETHUSDT', 'BTCUSDT', 'ETHUSDT'], quotes);
    expect(rows.map((r) => r.symbol)).toEqual(['ETHUSDT', 'BTCUSDT', 'ETHUSDT']);
  });
});
