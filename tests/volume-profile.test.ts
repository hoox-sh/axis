/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Fixed-range volume profile pure math (OHLCV approximation).
 */

import { describe, expect, it } from 'bun:test';
import {
  computeVolumeProfile,
  expandValueArea,
  formatVpPrice,
  formatVpVolume,
  priceToBinIndex,
  DEFAULT_VP_ROWS,
  DEFAULT_VALUE_AREA_PCT,
  type VpBar,
} from '../src/chart/volume-profile.ts';

function bar(low: number, high: number, close: number, volume: number): VpBar {
  return { low, high, close, volume };
}

describe('computeVolumeProfile', () => {
  it('returns empty result for empty bars', () => {
    const r = computeVolumeProfile([]);
    expect(r.bins).toEqual([]);
    expect(r.poc).toBeNull();
    expect(r.vaHigh).toBeNull();
    expect(r.vaLow).toBeNull();
    expect(r.pocIndex).toBe(-1);
    expect(r.totalVolume).toBe(0);
    expect(r.rows).toBe(DEFAULT_VP_ROWS);
  });

  it('bins price range into N rows (default 24)', () => {
    const bars = [bar(100, 124, 112, 1000)];
    const r = computeVolumeProfile(bars);
    expect(r.bins.length).toBe(24);
    expect(r.bins[0]!.priceLow).toBeCloseTo(100, 8);
    expect(r.bins[23]!.priceHigh).toBeCloseTo(124, 8);
    // Equal-height bins
    const h = r.bins[0]!.priceHigh - r.bins[0]!.priceLow;
    for (const b of r.bins) {
      expect(b.priceHigh - b.priceLow).toBeCloseTo(h, 8);
    }
  });

  it('respects custom rows and clamps extremes', () => {
    const bars = [bar(10, 20, 15, 100)];
    expect(computeVolumeProfile(bars, { rows: 4 }).bins.length).toBe(4);
    expect(computeVolumeProfile(bars, { rows: 1 }).bins.length).toBe(1);
    expect(computeVolumeProfile(bars, { rows: 0 }).bins.length).toBe(DEFAULT_VP_ROWS);
    expect(computeVolumeProfile(bars, { rows: 9999 }).bins.length).toBe(512);
  });

  it('uniform mode distributes volume by high–low overlap', () => {
    // One bar spans full [0, 10], volume 100 → 2 bins get 50 each
    const bars = [bar(0, 10, 5, 100)];
    const r = computeVolumeProfile(bars, { rows: 2, mode: 'uniform' });
    expect(r.totalVolume).toBeCloseTo(100, 8);
    expect(r.bins[0]!.volume).toBeCloseTo(50, 8);
    expect(r.bins[1]!.volume).toBeCloseTo(50, 8);
  });

  it('uniform mode splits partial overlap proportionally', () => {
    // Anchor session range to [0, 10] with a zero-volume extreme, then trade only lower half
    const bars = [bar(0, 10, 5, 0), bar(0, 5, 2, 80)];
    const r = computeVolumeProfile(bars, { rows: 2, mode: 'uniform' });
    expect(r.totalVolume).toBeCloseTo(80, 8);
    expect(r.bins[0]!.volume).toBeCloseTo(80, 8);
    expect(r.bins[1]!.volume).toBeCloseTo(0, 8);
  });

  it('close mode puts all volume in the close bin', () => {
    const bars = [bar(0, 10, 7.5, 100)];
    const r = computeVolumeProfile(bars, { rows: 2, mode: 'close' });
    expect(r.totalVolume).toBeCloseTo(100, 8);
    // [0,5) and [5,10] — close 7.5 → bin 1
    expect(r.bins[0]!.volume).toBeCloseTo(0, 8);
    expect(r.bins[1]!.volume).toBeCloseTo(100, 8);
    expect(r.pocIndex).toBe(1);
  });

  it('zero-range bar puts volume in one bin (both modes)', () => {
    const bars = [bar(50, 50, 50, 40)];
    for (const mode of ['uniform', 'close'] as const) {
      const r = computeVolumeProfile(bars, { rows: 8, mode });
      expect(r.totalVolume).toBeCloseTo(40, 8);
      const nonzero = r.bins.filter((b) => b.volume > 0);
      expect(nonzero.length).toBe(1);
      expect(nonzero[0]!.volume).toBeCloseTo(40, 8);
    }
  });

  it('ignores missing / non-finite / non-positive volume', () => {
    const bars: VpBar[] = [
      { low: 1, high: 2, close: 1.5 },
      { low: 1, high: 2, close: 1.5, volume: 0 },
      { low: 1, high: 2, close: 1.5, volume: -5 },
      { low: 1, high: 2, close: 1.5, volume: NaN },
      { low: 1, high: 2, close: 1.5, volume: 10 },
    ];
    const r = computeVolumeProfile(bars, { rows: 4 });
    expect(r.totalVolume).toBeCloseTo(10, 8);
  });

  it('respects fromIndex / toIndex range', () => {
    // Index 0 anchors full [0,10] range so later slices keep comparable bins
    const bars = [
      bar(0, 10, 5, 100), // full range
      bar(0, 5, 2, 50), // lower only
      bar(5, 10, 8, 50), // upper only
    ];
    // Slice only bar[1]; price range shrinks to that bar's high/low [0,5]
    const onlyMid = computeVolumeProfile(bars, {
      rows: 2,
      mode: 'uniform',
      fromIndex: 1,
      toIndex: 1,
    });
    expect(onlyMid.totalVolume).toBeCloseTo(50, 8);
    // Range is [0,5] → both bins share the bar span equally
    expect(onlyMid.bins[0]!.volume + onlyMid.bins[1]!.volume).toBeCloseTo(50, 8);
    expect(onlyMid.fromIndex).toBe(1);
    expect(onlyMid.toIndex).toBe(1);

    // from/to exclude the heavy first bar
    const both = computeVolumeProfile(bars, {
      rows: 2,
      mode: 'uniform',
      fromIndex: 1,
      toIndex: 2,
    });
    expect(both.totalVolume).toBeCloseTo(100, 8);
    // Range [0,10] from bars 1–2; lower + upper halves
    expect(both.bins[0]!.volume).toBeCloseTo(50, 8);
    expect(both.bins[1]!.volume).toBeCloseTo(50, 8);

    // Explicit full range: first bar alone
    const onlyFirst = computeVolumeProfile(bars, {
      rows: 2,
      mode: 'uniform',
      fromIndex: 0,
      toIndex: 0,
    });
    expect(onlyFirst.totalVolume).toBeCloseTo(100, 8);
    expect(onlyFirst.bins[0]!.volume).toBeCloseTo(50, 8);
    expect(onlyFirst.bins[1]!.volume).toBeCloseTo(50, 8);
  });

  it('POC is the max-volume bin mid-price', () => {
    // Two bars: heavy volume near high
    const bars = [bar(0, 5, 2, 10), bar(5, 10, 8, 90)];
    const r = computeVolumeProfile(bars, { rows: 2, mode: 'uniform' });
    expect(r.pocIndex).toBe(1);
    expect(r.poc).toBeCloseTo(7.5, 8);
  });

  it('POC tie-break prefers bin nearer session mid', () => {
    // Equal volume in both halves → mid is 5; both bin mids equidistant…
    // Use 3 bins so mid (5) is closer to center bin
    const bars = [
      bar(0, 10 / 3, 1, 50),
      bar(10 / 3, 20 / 3, 5, 50),
      bar(20 / 3, 10, 9, 50),
    ];
    const r = computeVolumeProfile(bars, { rows: 3, mode: 'uniform' });
    // All equal → nearest mid price (5) is bin 1
    expect(r.pocIndex).toBe(1);
  });

  it('value area expands around POC to ~70% volume', () => {
    // 10 equal bins, volume concentrated: bin 4 has 100, neighbors 20, rest 1
    const rows = 10;
    const bars: VpBar[] = [];
    for (let i = 0; i < rows; i++) {
      const lo = i;
      const hi = i + 1;
      let vol = 1;
      if (i === 4) vol = 100;
      else if (i === 3 || i === 5) vol = 20;
      else if (i === 2 || i === 6) vol = 10;
      bars.push(bar(lo, hi, lo + 0.5, vol));
    }
    const r = computeVolumeProfile(bars, {
      rows,
      mode: 'uniform',
      valueAreaPct: 0.7,
    });
    expect(r.pocIndex).toBe(4);
    expect(r.totalVolume).toBeCloseTo(
      100 + 40 + 20 + 1 * 5,
      5,
    );
    // VA must include POC and grow
    expect(r.vaLow).not.toBeNull();
    expect(r.vaHigh).not.toBeNull();
    expect(r.vaLow!).toBeLessThanOrEqual(r.bins[r.pocIndex]!.priceLow + 1e-9);
    expect(r.vaHigh!).toBeGreaterThanOrEqual(r.bins[r.pocIndex]!.priceHigh - 1e-9);

    // Sum volumes in VA ≥ 70% of total
    let vaSum = 0;
    for (const b of r.bins) {
      if (b.priceLow >= r.vaLow! - 1e-12 && b.priceHigh <= r.vaHigh! + 1e-12) {
        vaSum += b.volume;
      }
    }
    expect(vaSum).toBeGreaterThanOrEqual(r.totalVolume * DEFAULT_VALUE_AREA_PCT - 1e-6);
  });

  it('value area covers full range when pct is 1', () => {
    const bars = [bar(0, 10, 5, 100)];
    const r = computeVolumeProfile(bars, { rows: 5, valueAreaPct: 1 });
    expect(r.vaLow).toBeCloseTo(0, 8);
    expect(r.vaHigh).toBeCloseTo(10, 8);
  });

  it('returns bins with zero volume but null POC when no volume', () => {
    const bars = [bar(1, 2, 1.5, 0), bar(2, 3, 2.5)];
    const r = computeVolumeProfile(bars, { rows: 4 });
    expect(r.bins.length).toBe(4);
    expect(r.totalVolume).toBe(0);
    expect(r.poc).toBeNull();
  });

  it('skips bars with non-finite high/low', () => {
    const bars: VpBar[] = [
      { low: NaN, high: 10, close: 5, volume: 50 },
      { low: 0, high: Infinity, close: 5, volume: 50 },
      bar(0, 10, 5, 40),
    ];
    const r = computeVolumeProfile(bars, { rows: 2 });
    expect(r.totalVolume).toBeCloseTo(40, 8);
  });
});

describe('expandValueArea', () => {
  it('starts at POC and expands richer side first', () => {
    // index: 0  1  2  3  4
    // vol:   1  5  20 8  2   POC=2 (20)
    const vols = [1, 5, 20, 8, 2];
    // target 30 → need 20+8+5 = 33 → indices 1..3
    const { vaLowIdx, vaHighIdx } = expandValueArea(vols, 2, 30);
    expect(vaLowIdx).toBe(1);
    expect(vaHighIdx).toBe(3);
  });

  it('ties prefer upper side', () => {
    const vols = [10, 50, 10];
    // from POC=1, target 60 → need one side; both = 10 → pick up → hi=2
    const { vaLowIdx, vaHighIdx } = expandValueArea(vols, 1, 60);
    expect(vaLowIdx).toBe(1);
    expect(vaHighIdx).toBe(2);
  });

  it('handles empty / single bin', () => {
    expect(expandValueArea([], 0, 10)).toEqual({ vaLowIdx: 0, vaHighIdx: 0 });
    expect(expandValueArea([42], 0, 100)).toEqual({ vaLowIdx: 0, vaHighIdx: 0 });
  });
});

describe('priceToBinIndex', () => {
  it('maps edges and clamps out of range', () => {
    // priceMin=0, binH=1, rows=4 → [0,1)[1,2)[2,3)[3,4]
    expect(priceToBinIndex(0, 0, 1, 4)).toBe(0);
    expect(priceToBinIndex(0.9, 0, 1, 4)).toBe(0);
    expect(priceToBinIndex(1, 0, 1, 4)).toBe(1);
    expect(priceToBinIndex(3.9, 0, 1, 4)).toBe(3);
    expect(priceToBinIndex(4, 0, 1, 4)).toBe(3);
    expect(priceToBinIndex(-5, 0, 1, 4)).toBe(0);
    expect(priceToBinIndex(99, 0, 1, 4)).toBe(3);
  });
});

describe('format helpers', () => {
  it('formatVpVolume uses compact suffixes', () => {
    expect(formatVpVolume(500)).toBe('500');
    expect(formatVpVolume(12_500)).toBe('12.5K');
    expect(formatVpVolume(2_500_000)).toBe('2.50M');
    expect(formatVpVolume(1.2e9)).toBe('1.20B');
    expect(formatVpVolume(NaN)).toBe('—');
  });

  it('formatVpPrice adapts decimals', () => {
    expect(formatVpPrice(1234.56)).toBe('1234.6');
    expect(formatVpPrice(12.345)).toBe('12.35');
    expect(formatVpPrice(0.01234)).toBe('0.0123');
    expect(formatVpPrice(NaN)).toBe('—');
  });
});

describe('volume conservation', () => {
  it('uniform total volume equals sum of positive bar volumes', () => {
    const bars = [
      bar(100, 110, 105, 1000),
      bar(108, 120, 115, 500),
      bar(90, 100, 95, 250),
      bar(95, 95, 95, 50), // doji
    ];
    const r = computeVolumeProfile(bars, { rows: 24, mode: 'uniform' });
    expect(r.totalVolume).toBeCloseTo(1800, 6);
    const sumBins = r.bins.reduce((a, b) => a + b.volume, 0);
    expect(sumBins).toBeCloseTo(1800, 6);
  });

  it('close mode also conserves volume', () => {
    const bars = [bar(1, 3, 2.2, 10), bar(2, 4, 3.5, 20), bar(0, 1, 0.5, 5)];
    const r = computeVolumeProfile(bars, { rows: 8, mode: 'close' });
    expect(r.totalVolume).toBeCloseTo(35, 8);
  });
});
