// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  approximateFootprintFromOhlcv,
  footprintEnabled,
  footprintLayoutKey,
  footprintPaintCells,
  numTicksForPixelHeight,
  packFootprintRows,
  setFootprintEnabled,
  toggleFootprintEnabled,
  unpackFootprintRows,
} from '../src/chart/footprint.ts';

describe('approximateFootprintFromOhlcv', () => {
  it('builds rows with POC / VA and buy bias on green bars', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 100, open: 100, high: 110, low: 90, close: 108, volume: 1000 },
      { numTicks: 10, vaPercentage: 70 },
    );
    expect(fp).toBeTruthy();
    expect(fp!.source).toBe('approx');
    expect(fp!.rows).toHaveLength(10);
    expect(fp!.totalVolume).toBeCloseTo(1000, 5);
    expect(fp!.buyVolume).toBeGreaterThan(fp!.sellVolume);
    expect(fp!.rows.some((r) => r.isPoc)).toBe(true);
    expect(fp!.rows.some((r) => r.isVah)).toBe(true);
    expect(fp!.rows.some((r) => r.isVal)).toBe(true);
    expect(fp!.poc).not.toBeNull();
    expect(fp!.vaHigh).toBeGreaterThanOrEqual(fp!.vaLow!);
  });

  it('rejects invalid OHLC', () => {
    expect(
      approximateFootprintFromOhlcv({ time: 1, open: 1, high: 0, low: 2, close: 1, volume: 1 }),
    ).toBeNull();
  });

  it('splits buy/sell by where the candle closed, not just its colour', () => {
    // Red candle (close < open) but closing near the high: the print was bought.
    const redNearHigh = approximateFootprintFromOhlcv(
      { time: 1, open: 10, high: 10.5, low: 9, close: 10.4, volume: 100 },
      { numTicks: 10 },
    )!;
    expect(redNearHigh.buyVolume).toBeGreaterThan(redNearHigh.sellVolume);

    // Green candle closing near the low: the print was sold.
    const greenNearLow = approximateFootprintFromOhlcv(
      { time: 2, open: 9.2, high: 10.5, low: 9, close: 9.3, volume: 100 },
      { numTicks: 10 },
    )!;
    expect(greenNearLow.sellVolume).toBeGreaterThan(greenNearLow.buyVolume);
  });

  it('keeps the POC row containing the print on a symmetric doji', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 1, open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { numTicks: 8 },
    )!;
    const poc = fp.rows.find((r) => r.isPoc)!;
    expect(poc).toBeTruthy();
    expect(poc.downPrice).toBeLessThanOrEqual(10);
    expect(poc.upPrice).toBeGreaterThanOrEqual(10);
  });

  it('value area covers at least the requested percentage', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 500 },
      { numTicks: 16, vaPercentage: 70 },
    )!;
    const hi = fp.rows.findIndex((r) => r.isVah);
    const lo = fp.rows.findIndex((r) => r.isVal);
    expect(hi).toBeGreaterThanOrEqual(0);
    expect(lo).toBeGreaterThanOrEqual(0);
    const inVa = fp.rows
      .slice(Math.min(lo, hi), Math.max(lo, hi) + 1)
      .reduce((s, r) => s + r.buyVolume + r.sellVolume, 0);
    expect(inVa).toBeGreaterThanOrEqual(fp.totalVolume * 0.7 - 1e-6);
  });

  it('handles a zero-range bar without dividing by zero', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 25 },
      { numTicks: 4 },
    )!;
    expect(fp.totalVolume).toBeCloseTo(25, 6);
    expect(fp.rows.every((r) => Number.isFinite(r.upPrice) && Number.isFinite(r.downPrice))).toBe(
      true,
    );
    expect(fp.rows.filter((r) => r.isPoc)).toHaveLength(1);
  });
});

describe('packFootprintRows', () => {
  it('round-trips without JSON', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 1, open: 10, high: 12, low: 8, close: 9, volume: 50 },
      { numTicks: 8 },
    )!;
    const packed = packFootprintRows(fp.rows);
    expect(packed.floats.length).toBe(fp.rows.length * 4);
    expect(packed.flags.length).toBe(fp.rows.length);
    const back = unpackFootprintRows(packed.floats, packed.flags);
    expect(back).toHaveLength(fp.rows.length);
    for (let i = 0; i < back.length; i++) {
      expect(back[i]!.downPrice).toBeCloseTo(fp.rows[i]!.downPrice, 5);
      expect(back[i]!.buyVolume).toBeCloseTo(fp.rows[i]!.buyVolume, 5);
      expect(back[i]!.isPoc).toBe(fp.rows[i]!.isPoc);
    }
  });

  it('round-trips every flag bit', () => {
    const rows = [
      {
        upPrice: 3,
        downPrice: 2,
        buyVolume: 5,
        sellVolume: 1,
        delta: 4,
        isImbalance: true,
        isPoc: true,
        isVah: true,
        isVal: true,
      },
      {
        upPrice: 2,
        downPrice: 1,
        buyVolume: 1,
        sellVolume: 5,
        delta: -4,
        isImbalance: false,
        isPoc: false,
        isVah: false,
        isVal: false,
      },
    ];
    const back = unpackFootprintRows(packFootprintRows(rows).floats, packFootprintRows(rows).flags);
    expect(back[0]).toMatchObject({
      isImbalance: true,
      isPoc: true,
      isVah: true,
      isVal: true,
      delta: 4,
    });
    expect(back[1]).toMatchObject({
      isImbalance: false,
      isPoc: false,
      isVah: false,
      isVal: false,
      delta: -4,
    });
  });
});

describe('footprintPaintCells', () => {
  it('emits one cell per row with positive height', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 1, open: 1, high: 3, low: 0, close: 2, volume: 10 },
      { numTicks: 5 },
    )!;
    const cells = footprintPaintCells(fp, {
      barLeft: 100,
      barWidth: 20,
      priceToY: (p) => 500 - p * 10,
    });
    expect(cells).toHaveLength(5);
    expect(cells.every((c) => c.h >= 1 && c.w > 0)).toBe(true);
    expect(cells.some((c) => c.poc)).toBe(true);
  });

  it('keeps cells inside the bar slot and ordered by price', () => {
    const fp = approximateFootprintFromOhlcv(
      { time: 1, open: 1, high: 3, low: 0, close: 2, volume: 10 },
      { numTicks: 6 },
    )!;
    const cells = footprintPaintCells(fp, {
      barLeft: 100,
      barWidth: 20,
      priceToY: (p) => 500 - p * 10,
    });
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(100);
      expect(c.x + c.w).toBeLessThanOrEqual(120);
    }
    // priceToY is inverted, so higher price rows paint at smaller y.
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.y).toBeLessThanOrEqual(cells[i - 1]!.y);
    }
    expect(cells.filter((c) => c.poc)).toHaveLength(1);
  });
});

describe('footprintLayoutKey', () => {
  const geom = { numTicks: 24, xCenter: 100, barWidth: 6, yHigh: 20, yLow: 80 };
  const bar = { time: 1_700_000_000, open: 100, high: 102, low: 99, close: 101, volume: 10 };

  it('changes when volume changes with identical geometry', () => {
    const a = footprintLayoutKey(bar, geom);
    const b = footprintLayoutKey({ ...bar, volume: 11 }, geom);
    expect(a).not.toBe(b);
  });

  it('changes when the print moves inside the same pixel range', () => {
    const a = footprintLayoutKey(bar, geom);
    const b = footprintLayoutKey({ ...bar, close: 101.5 }, geom);
    expect(a).not.toBe(b);
  });

  it('reuses the key for an unchanged bar', () => {
    expect(footprintLayoutKey(bar, geom)).toBe(footprintLayoutKey({ ...bar }, geom));
  });

  it('still keys on geometry', () => {
    const a = footprintLayoutKey(bar, geom);
    expect(a).not.toBe(footprintLayoutKey(bar, { ...geom, xCenter: 104 }));
    expect(a).not.toBe(footprintLayoutKey(bar, { ...geom, numTicks: 12 }));
  });
});

describe('numTicksForPixelHeight', () => {
  it('sizes rows to the candle height so cells stay inside the bar', () => {
    expect(numTicksForPixelHeight(6)).toBe(3); // 3 px minimum
    expect(numTicksForPixelHeight(20)).toBe(10);
    expect(numTicksForPixelHeight(200)).toBe(24); // default cap
    expect(numTicksForPixelHeight(0)).toBe(3);
    expect(numTicksForPixelHeight(Number.NaN)).toBe(3);
  });

  it('honours custom bounds', () => {
    expect(numTicksForPixelHeight(4, { min: 4, max: 8 })).toBe(4);
    expect(numTicksForPixelHeight(100, { min: 4, max: 8 })).toBe(8);
    expect(numTicksForPixelHeight(100, { min: 4, max: 8, pxPerRow: 10 })).toBe(8);
  });
});

describe('footprintEnabled toggle', () => {
  it('toggles the Layers / overlay signal', () => {
    setFootprintEnabled(false);
    expect(footprintEnabled()).toBe(false);
    expect(toggleFootprintEnabled()).toBe(true);
    expect(footprintEnabled()).toBe(true);
    expect(toggleFootprintEnabled()).toBe(false);
    expect(footprintEnabled()).toBe(false);
  });
});
