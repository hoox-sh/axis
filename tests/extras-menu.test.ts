/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { anyExtraEnabled, defaultTickerSymbols } from '../src/ui/extras/state';
import { DEFAULTS } from '../src/store';

describe('anyExtraEnabled', () => {
  it('false when all extras off', () => {
    expect(anyExtraEnabled(DEFAULTS.extras)).toBe(false);
  });
  it('true when any extra on', () => {
    expect(
      anyExtraEnabled({ ...DEFAULTS.extras, ticker: { enabled: true, symbols: [], speed: 1 } }),
    ).toBe(true);
  });
});

describe('defaultTickerSymbols', () => {
  it('keeps an existing selection', () => {
    expect(defaultTickerSymbols(['BTCUSDT', 'ETHUSDT'], ['ETHUSDT'])).toEqual(['ETHUSDT']);
  });
  it('seeds from the watchlist when empty, capped at 20', () => {
    expect(defaultTickerSymbols(['BTCUSDT'], [])).toEqual(['BTCUSDT']);
    expect(defaultTickerSymbols([], [])).toEqual([]);
    const many = Array.from({ length: 25 }, (_, i) => `S${i}`);
    expect(defaultTickerSymbols(many, [])).toHaveLength(20);
  });
});
