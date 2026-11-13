/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One price object: the value every surface reads.
 *
 * Invariant: the object carries exactly the candle close it was committed
 * with, plus the derived change/direction and the resolved decimals. Readers
 * never recompute.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetPriceForTests,
  commitPrice,
  formatPrice,
  formatPriceChange,
  priceChangePct,
  priceDirection,
  priceTone,
  priceView,
  resetPrice,
} from '../src/market/price-object';

beforeEach(() => {
  _resetPriceForTests();
});

describe('commitPrice', () => {
  it('stores the committed candle close and derives the change', () => {
    commitPrice({ symbol: 'BTCUSDT', value: 101, prevClose: 100, decimals: 2, barTime: 60 });
    const v = priceView();
    expect(v.symbol).toBe('BTCUSDT');
    expect(v.value).toBe(101);
    expect(v.prevClose).toBe(100);
    expect(v.changePct).toBeCloseTo(1, 10);
    expect(v.direction).toBe('up');
    expect(v.decimals).toBe(2);
    expect(v.barTime).toBe(60);
  });

  it('marks the tip live only when the caller says so', () => {
    commitPrice({ symbol: 'BTCUSDT', value: 100, live: true });
    expect(priceView().live).toBe(true);
    commitPrice({ symbol: 'BTCUSDT', value: 100, live: false });
    expect(priceView().live).toBe(false);
  });

  it('ignores a non-finite price instead of blanking the object', () => {
    commitPrice({ symbol: 'BTCUSDT', value: 100 });
    commitPrice({ symbol: 'BTCUSDT', value: Number.NaN });
    expect(priceView().value).toBe(100);
  });

  it('clamps decimals into the chart range', () => {
    commitPrice({ symbol: 'SHIBUSDT', value: 0.00001234, decimals: 99 });
    expect(priceView().decimals).toBe(8);
    commitPrice({ symbol: 'BTCUSDT', value: 100, decimals: -3 });
    expect(priceView().decimals).toBe(0);
  });

  it('defaults the timestamp to now', () => {
    const before = Date.now();
    commitPrice({ symbol: 'BTCUSDT', value: 100 });
    expect(priceView().at).toBeGreaterThanOrEqual(before);
  });
});

describe('resetPrice', () => {
  it('clears the value but keeps the symbol for the title', () => {
    commitPrice({ symbol: 'BTCUSDT', value: 100, prevClose: 99 });
    resetPrice('ETHUSDT');
    const v = priceView();
    expect(v.symbol).toBe('ETHUSDT');
    expect(Number.isFinite(v.value)).toBe(false);
    expect(v.direction).toBe('flat');
    expect(v.live).toBe(false);
  });
});

describe('formatting', () => {
  it('uses the object decimals, not a caller default', () => {
    commitPrice({ symbol: 'SOLUSDT', value: 101.23456, decimals: 4 });
    expect(formatPrice()).toBe('101.2346');
  });

  it('renders an em dash while unknown', () => {
    expect(formatPrice()).toBe('—');
    expect(formatPriceChange()).toBeNull();
  });

  it('normalises a zero change to 0.00%', () => {
    commitPrice({ symbol: 'BTCUSDT', value: 100, prevClose: 100 });
    expect(formatPriceChange()).toBe('0.00%');
    expect(priceTone()).toBe('flat');
  });

  it('signs a positive and negative change', () => {
    commitPrice({ symbol: 'BTCUSDT', value: 101, prevClose: 100 });
    expect(formatPriceChange()).toBe('+1.00%');
    commitPrice({ symbol: 'BTCUSDT', value: 99, prevClose: 100 });
    expect(formatPriceChange()).toBe('-1.00%');
  });
});

describe('pure helpers', () => {
  it('priceChangePct refuses a zero / missing previous close', () => {
    expect(priceChangePct(101, 0)).toBeNaN();
    expect(priceChangePct(101, Number.NaN)).toBeNaN();
    expect(priceChangePct(Number.NaN, 100)).toBeNaN();
    expect(priceChangePct(99, 100)).toBeCloseTo(-1, 10);
  });

  it('priceDirection is flat when either side is unknown', () => {
    expect(priceDirection(101, 100)).toBe('up');
    expect(priceDirection(99, 100)).toBe('down');
    expect(priceDirection(100, 100)).toBe('flat');
    expect(priceDirection(Number.NaN, 100)).toBe('flat');
  });
});
