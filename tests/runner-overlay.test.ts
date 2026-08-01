/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Overlay routing helpers — indicators/oscillators must not vanish on price scale.
 */

import { describe, expect, it } from 'bun:test';
import {
  resolveOverlayFlag,
  seriesWouldHideOnPrice,
} from '../src/indicators/runner';

describe('resolveOverlayFlag', () => {
  it('respects explicit false', () => {
    expect(resolveOverlayFlag(false, 'strategy')).toBe(false);
    expect(resolveOverlayFlag(0, 'strategy')).toBe(false);
    expect(resolveOverlayFlag('false', 'strategy')).toBe(false);
  });

  it('respects explicit true', () => {
    expect(resolveOverlayFlag(true, 'indicator')).toBe(true);
    expect(resolveOverlayFlag(1, 'indicator')).toBe(true);
  });

  it('defaults indicator to sub-pane when missing', () => {
    expect(resolveOverlayFlag(undefined, 'indicator')).toBe(false);
    expect(resolveOverlayFlag(null, 'library')).toBe(false);
  });

  it('defaults strategy / unknown to overlay', () => {
    expect(resolveOverlayFlag(undefined, 'strategy')).toBe(true);
    expect(resolveOverlayFlag(undefined, '')).toBe(true);
  });
});

describe('seriesWouldHideOnPrice', () => {
  const btcBars = Array.from({ length: 20 }, (_, i) => ({ close: 50_000 + i * 10 }));

  it('detects RSI-scale series vs BTC price', () => {
    const rsi = Array.from({ length: 20 }, (_, i) => 30 + (i % 40));
    expect(seriesWouldHideOnPrice([['rsi', rsi]], btcBars)).toBe(true);
  });

  it('detects rsi*0.01 scaled overlay demo', () => {
    const scaled = Array.from({ length: 20 }, (_, i) => 0.3 + (i % 40) * 0.01);
    expect(seriesWouldHideOnPrice([['RSI scaled', scaled]], btcBars)).toBe(true);
  });

  it('keeps price-like series on overlay', () => {
    const ema = btcBars.map((b) => b.close * 0.99);
    expect(seriesWouldHideOnPrice([['ema', ema]], btcBars)).toBe(false);
  });

  it('returns false for empty / all-na series', () => {
    expect(seriesWouldHideOnPrice([['x', [null, null]]], btcBars)).toBe(false);
    expect(seriesWouldHideOnPrice([], btcBars)).toBe(false);
  });
});
