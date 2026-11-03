// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  approximateFootprintFromOhlcv,
  footprintPaintCells,
  packFootprintRows,
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
});
