/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Drawing snap-to-bar helpers: nearest index + OHLC/time snap modes.
 * Invariant: cursor maps to nearest bar time/price without inventing bars.
 */

import { describe, expect, it } from 'bun:test';
import {
  findNearestBarIndex,
  snapToBars,
  type BarLike,
} from '../src/chart/drawings/snap.ts';

/** Fake bars: times 100, 200, 300 with distinct OHLC. */
const bars: readonly BarLike[] = [
  { time: 100, open: 10, high: 20, low: 5, close: 15 },
  { time: 200, open: 15, high: 30, low: 12, close: 25 },
  { time: 300, open: 25, high: 40, low: 20, close: 35 },
];

/** Linear price→Y: y = 1000 - price * 10 (price 0 → y 1000, price 100 → y 0). */
function priceToY(price: number): number {
  return 1000 - price * 10;
}

function snap(
  partial: Partial<Parameters<typeof snapToBars>[0]> & {
    raw: { time: number; price: number };
    mode: Parameters<typeof snapToBars>[0]['mode'];
  },
) {
  const raw = partial.raw;
  return snapToBars({
    bars,
    priceToY,
    rawXY: { x: 0, y: priceToY(raw.price) },
    ...partial,
  });
}

describe('findNearestBarIndex', () => {
  it('returns -1 for empty', () => {
    expect(findNearestBarIndex([], 150)).toBe(-1);
  });

  it('exact match', () => {
    expect(findNearestBarIndex(bars, 200)).toBe(1);
  });

  it('midway prefers earlier or closer', () => {
    expect(findNearestBarIndex(bars, 140)).toBe(0); // closer to 100
    expect(findNearestBarIndex(bars, 160)).toBe(1); // closer to 200
  });

  it('before first / after last', () => {
    expect(findNearestBarIndex(bars, 0)).toBe(0);
    expect(findNearestBarIndex(bars, 999)).toBe(2);
  });
});

describe('snapToBars', () => {
  it('mode off returns raw unchanged', () => {
    const raw = { time: 205, price: 29 };
    const out = snap({ mode: 'off', raw });
    expect(out).toEqual(raw);
  });

  it('empty bars returns raw', () => {
    const raw = { time: 200, price: 25 };
    const out = snapToBars({
      bars: [],
      raw,
      rawXY: { x: 0, y: priceToY(25) },
      priceToY,
      mode: 'strong',
    });
    expect(out).toEqual(raw);
  });

  it('strong snaps to nearest bar time + nearest OHLC price', () => {
    // Near bar 200, price near high (30)
    const out = snap({
      mode: 'strong',
      raw: { time: 210, price: 28.5 },
    });
    expect(out.time).toBe(200);
    expect(out.price).toBe(30); // high
  });

  it('strong always snaps even when far in price', () => {
    // price 99 is far from any OHLC on bar 200; still snaps
    const out = snap({
      mode: 'strong',
      raw: { time: 200, price: 99 },
    });
    expect(out.time).toBe(200);
    // closest among O15 H30 L12 C25 → high 30 (y dist)
    // y(99)=10, y(30)=700, y(25)=750, y(15)=850, y(12)=880 → high is closest
    expect(out.price).toBe(30);
  });

  it('strong uses bar.time not interpolated raw time', () => {
    const out = snap({
      mode: 'strong',
      raw: { time: 187, price: 15 },
    });
    expect(out.time).toBe(200);
    expect(out.price).toBe(15); // open
  });

  it('weak snaps when within pixelTol', () => {
    // high=30 → y=700; raw price 29.5 → y=705; dist=5 ≤ 10
    const out = snap({
      mode: 'weak',
      pixelTol: 10,
      raw: { time: 200, price: 29.5 },
    });
    expect(out.time).toBe(200);
    expect(out.price).toBe(30);
  });

  it('weak returns raw when pixel distance exceeds pixelTol', () => {
    // mid-range price far from all OHLC in pixels
    // bar 200: 12,15,25,30 → y 880,850,750,700
    // raw price 50 → y=500; min dist to high y700 = 200 > 10
    const raw = { time: 200, price: 50 };
    const out = snap({ mode: 'weak', pixelTol: 10, raw });
    expect(out).toEqual(raw);
  });

  it('weak considers ±1 neighbor bars', () => {
    // Nearest by time is bar 200, but raw price is near bar 300 high (40)
    // price 39.5 → y=605; bar300 high y=600; dist=5
    // bar200 high y=700; dist=95
    const out = snap({
      mode: 'weak',
      pixelTol: 10,
      raw: { time: 210, price: 39.5 },
    });
    expect(out.time).toBe(300);
    expect(out.price).toBe(40);
  });

  it('strong does not use neighbor bars', () => {
    // Same point: nearest bar is 200; must snap to bar 200 OHLC only
    const out = snap({
      mode: 'strong',
      raw: { time: 210, price: 39.5 },
    });
    expect(out.time).toBe(200);
    expect(out.price).toBe(30); // high of bar 200
  });

  it('supports hl2 target', () => {
    // bar 200: hl2 = (30+12)/2 = 21
    const out = snap({
      mode: 'strong',
      targets: ['hl2'],
      raw: { time: 200, price: 21.2 },
    });
    expect(out.time).toBe(200);
    expect(out.price).toBe(21);
  });

  it('respects custom targets (close only)', () => {
    const out = snap({
      mode: 'strong',
      targets: ['close'],
      raw: { time: 200, price: 29 }, // nearer high than close, but only close allowed
    });
    expect(out.time).toBe(200);
    expect(out.price).toBe(25);
  });

  it('default pixelTol is 10 for weak', () => {
    // dist = |y(29) - y(30)| = |710-700| = 10 → should snap
    const atEdge = snap({
      mode: 'weak',
      raw: { time: 200, price: 29 },
    });
    expect(atEdge.price).toBe(30);

    // dist = |y(28.9) - y(30)| = 11 → no snap
    const raw = { time: 200, price: 28.9 };
    const beyond = snap({ mode: 'weak', raw });
    expect(beyond).toEqual(raw);
  });

  it('skips targets where priceToY returns null', () => {
    const raw = { time: 200, price: 25 };
    const out = snapToBars({
      bars,
      raw,
      rawXY: { x: 0, y: 100 },
      priceToY: () => null,
      mode: 'strong',
    });
    expect(out).toEqual(raw);
  });
});
