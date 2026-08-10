/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  countSignificantDecimals,
  cyclePriceScaleDecimalsMode,
  decimalsFromMagnitude,
  detectDecimalsFromBars,
  detectDecimalsFromSymbol,
  normalizePriceScaleDecimalsMode,
  priceFormatForDecimals,
  priceScaleDecimalsLabel,
  resolvePriceDecimals,
} from '../src/chart/price-precision';
import type { Bar } from '../src/store/types';

describe('price-precision', () => {
  it('normalizes mode', () => {
    expect(normalizePriceScaleDecimalsMode('auto')).toBe('auto');
    expect(normalizePriceScaleDecimalsMode(2)).toBe(2);
    expect(normalizePriceScaleDecimalsMode('5')).toBe(5);
    expect(normalizePriceScaleDecimalsMode(99)).toBe(8);
    expect(normalizePriceScaleDecimalsMode(-1)).toBe(0);
  });

  it('detects from symbol majors / meme', () => {
    expect(detectDecimalsFromSymbol('BTCUSDT')).toBe(2);
    expect(detectDecimalsFromSymbol('eth-usdt')).toBe(2);
    expect(detectDecimalsFromSymbol('SOLUSDT')).toBe(3);
    expect(detectDecimalsFromSymbol('DOGEUSDT')).toBe(4);
    expect(detectDecimalsFromSymbol('PEPEUSDT')).toBe(8);
    expect(detectDecimalsFromSymbol('eth:0xabc')).toBeNull();
  });

  it('detects from bar samples', () => {
    const btc: Bar[] = [
      { time: 1, open: 90000, high: 91000, low: 89000, close: 90500.12 },
      { time: 2, open: 90500, high: 92000, low: 90000, close: 91000.5 },
    ];
    expect(detectDecimalsFromBars(btc)).toBeGreaterThanOrEqual(2);

    const micro: Bar[] = [
      { time: 1, open: 0.00001234, high: 0.0000125, low: 0.000012, close: 0.0000124 },
    ];
    expect(detectDecimalsFromBars(micro)).toBeGreaterThanOrEqual(6);
  });

  it('resolvePriceDecimals prefers max of symbol + bars in auto', () => {
    const bars: Bar[] = [
      { time: 1, open: 0.12, high: 0.13, low: 0.11, close: 0.12345 },
    ];
    // DOGE hint is 4, bars may want 5
    const d = resolvePriceDecimals('auto', { symbol: 'DOGEUSDT', bars });
    expect(d).toBeGreaterThanOrEqual(4);
    expect(resolvePriceDecimals(3, { symbol: 'BTCUSDT', bars })).toBe(3);
  });

  it('priceFormatForDecimals sets minMove', () => {
    expect(priceFormatForDecimals(2)).toEqual({
      type: 'price',
      precision: 2,
      minMove: 0.01,
    });
    expect(priceFormatForDecimals(0).minMove).toBe(1);
  });

  it('cycles auto → 0…8 → auto', () => {
    expect(cyclePriceScaleDecimalsMode('auto')).toBe(0);
    expect(cyclePriceScaleDecimalsMode(0)).toBe(1);
    expect(cyclePriceScaleDecimalsMode(8)).toBe('auto');
    expect(priceScaleDecimalsLabel('auto')).toBe('A');
    expect(priceScaleDecimalsLabel(2)).toBe('2');
  });

  it('countSignificantDecimals / magnitude helpers', () => {
    expect(countSignificantDecimals(1.23)).toBe(2);
    expect(decimalsFromMagnitude(50000)).toBe(2);
    expect(decimalsFromMagnitude(0.0001)).toBe(6);
  });
});
