/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { formatTickerRow } from '../src/ui/extras/format';

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
