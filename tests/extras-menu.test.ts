/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import {
  anyExtraEnabled,
  defaultTickerSymbols,
  resetTickerOptions,
  TICKER_DEFAULTS,
} from '../src/ui/extras/state';
import { DEFAULTS } from '../src/store';

describe('anyExtraEnabled', () => {
  it('false when all extras off', () => {
    expect(anyExtraEnabled(DEFAULTS.extras)).toBe(false);
  });
  it('true when any extra on', () => {
    expect(
      anyExtraEnabled({
        ...DEFAULTS.extras,
        ticker: { ...DEFAULTS.extras.ticker, enabled: true },
      }),
    ).toBe(true);
  });
});

describe('TICKER_DEFAULTS / resetTickerOptions', () => {
  it('tracks the store defaults instead of restating them', () => {
    expect(TICKER_DEFAULTS).toEqual({
      speed: DEFAULTS.extras.ticker.speed,
      direction: DEFAULTS.extras.ticker.direction,
      showChange: DEFAULTS.extras.ticker.showChange,
      itemSpacing: DEFAULTS.extras.ticker.itemSpacing,
      bandHeight: DEFAULTS.extras.ticker.bandHeight,
      fontSize: DEFAULTS.extras.ticker.fontSize,
      opacity: DEFAULTS.extras.ticker.opacity,
      draggable: DEFAULTS.extras.ticker.draggable,
      offsetY: DEFAULTS.extras.ticker.offsetY,
    });
  });

  it('resets options without touching enabled or the symbol list', () => {
    const dirty = {
      ...DEFAULTS.extras.ticker,
      enabled: false,
      symbols: ['ETHUSDT'],
      speed: 3,
      offsetY: 120,
    };
    const reset = resetTickerOptions(dirty.symbols, dirty.enabled);
    expect(reset.enabled).toBe(false);
    expect(reset.symbols).toEqual(['ETHUSDT']);
    expect(reset.speed).toBe(TICKER_DEFAULTS.speed);
    expect(reset.offsetY).toBe(0);
    // Original must not be aliased into the reset result.
    expect(reset.symbols).not.toBe(dirty.symbols);
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
