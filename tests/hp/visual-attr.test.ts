/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Visual attribute buffer (HP PR 8, §6.5): the CPU reference fill.
 *
 * Three contracts:
 *
 * 1. **Layout** — one candle is exactly 32 bytes (`6 × f32` + `2 × u32`),
 *    readable through a `Uint32Array` at the documented word offsets, and a
 *    viewport of `visibleCount` candles allocates `visible + 64` records
 *    (never `HOT_CAP`).
 * 2. **NDC math** — float64 in, float32 out; `yMin → -1`, `yMax → +1`; a
 *    degenerate range yields `0` rather than `NaN`/`Infinity`; volumes are
 *    clipped to the *visible* maximum.
 * 3. **Hot fill** — `fillVisualAttrFromHot` samples only even generations
 *    (a torn sample is discarded, never painted), fills x_index as the slot
 *    within the fill, mirrors `BAR_FLAG_*` from the slot, and returns
 *    `null` — keep the previous frame — for an empty window, a write in
 *    flight, or a viewport outside the hot window.
 */

import '../setup';
import { describe, expect, it } from 'bun:test';
import {
  allocateHotBuffer,
  BAR_FLAG_CLOSED,
  BAR_FLAG_FORMING,
  type HotBarTicks,
} from '../../src/hp/memory/hot-buffer';
import {
  allocateVisualAttr,
  fillVisualAttr,
  fillVisualAttrFromHot,
  fillVisualAttrFromViewport,
  normalizeVolume,
  packRgba,
  priceToNdc,
  VISUAL_CANDLE_BYTES,
  VISUAL_CANDLE_F32,
  VISUAL_OFFSET,
  VISUAL_TAIL,
  visualCapacity,
  type VisualSourceBar,
} from '../../src/hp/paint/visual-attr';

const PALETTE = { up: 0x26a69a, down: 0xef5350 };
const Y = { yMin: 100, yMax: 200 };

function src(partial: Partial<VisualSourceBar> = {}): VisualSourceBar {
  return {
    x: 0,
    open: 110,
    high: 150,
    low: 90,
    close: 140,
    volume: 5,
    flags: BAR_FLAG_CLOSED,
    ...partial,
  };
}

function hot() {
  const buf = allocateHotBuffer();
  if (!buf) throw new Error('allocate');
  buf.priceScale = 0; // ticks are the display price — assertions read as-is
  return buf;
}

function ticks(close: number, flags: number, volume = 1): HotBarTicks {
  const t = BigInt(close);
  return {
    time: 60 + close,
    openTicks: t,
    highTicks: t,
    lowTicks: t,
    closeTicks: t,
    volume,
    flags,
  };
}

describe('visual-attr layout', () => {
  it('pins the struct size and record stride', () => {
    expect(VISUAL_CANDLE_BYTES).toBe(32);
    expect(VISUAL_CANDLE_F32).toBe(6);
    expect(VISUAL_OFFSET.color).toBe(24);
    expect(VISUAL_OFFSET.flags).toBe(28);
    expect(VISUAL_OFFSET.flags).toBe(VISUAL_OFFSET.color + 4);
  });

  it('allocates visible + 64, not HOT_CAP', () => {
    expect(VISUAL_TAIL).toBe(64);
    expect(visualCapacity(0)).toBe(0);
    expect(visualCapacity(100)).toBe(164);
    expect(visualCapacity(-5)).toBe(0);
    expect(allocateVisualAttr(0)).toBeNull();

    const buf = allocateVisualAttr(100);
    if (!buf) throw new Error('alloc');
    expect(buf.capacity).toBe(164);
    expect(buf.bytes.byteLength).toBe(164 * VISUAL_CANDLE_BYTES);
    expect(buf.f32.length).toBe(164 * (VISUAL_CANDLE_BYTES >> 2));
    // The u32 view aliases the same bytes, one word per 4 bytes.
    expect(buf.u32.length).toBe(buf.bytes.byteLength / 4);
  });
});

describe('priceToNdc / normalizeVolume', () => {
  it('maps the range endpoints and midpoint', () => {
    expect(priceToNdc(100, 100, 200)).toBe(-1);
    expect(priceToNdc(200, 100, 200)).toBe(1);
    expect(priceToNdc(150, 100, 200)).toBe(0);
    expect(priceToNdc(175, 100, 200)).toBe(0.5);
  });

  it('yields 0 for a degenerate range instead of NaN/Infinity', () => {
    expect(priceToNdc(150, 100, 100)).toBe(0);
    expect(priceToNdc(150, 200, 100)).toBe(0); // inverted range is not a range
    expect(Number.isNaN(priceToNdc(150, 100, 100))).toBe(false);
  });

  it('narrows to float32', () => {
    const v = priceToNdc(133.7, 100, 200);
    expect(v).toBe(Math.fround(v));
  });

  it('clips volumes to the visible maximum', () => {
    expect(normalizeVolume(5, 10)).toBe(0.5);
    expect(normalizeVolume(50, 10)).toBe(1); // clipped, never > 1
    expect(normalizeVolume(5, 0)).toBe(0); // no visible volume
    expect(normalizeVolume(0, 10)).toBe(0);
    expect(normalizeVolume(-1, 10)).toBe(0);
  });
});

describe('packRgba byte order', () => {
  it('stores 0xRRGGBB as bytes R,G,B,A in memory', () => {
    const packed = packRgba(0x112233, 255);
    const bytes = new Uint8Array(new Uint32Array([packed]).buffer);
    expect([...bytes]).toEqual([0x11, 0x22, 0x33, 0xff]);
  });

  it('keeps alpha in the most significant byte', () => {
    const packed = packRgba(0xffffff, 194);
    expect(packed >>> 24).toBe(194);
    expect(packed & 0xffffff).toBe(0xffffff);
  });
});

describe('fillVisualAttr', () => {
  it('writes x, NDC ohlc, volume and flags per record', () => {
    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    const n = fillVisualAttr({
      buf,
      bars: [src({ x: 3 }), src({ x: 4, close: 105, flags: BAR_FLAG_FORMING })],
      y: Y,
      maxVolume: 10,
      palette: PALETTE,
    });
    expect(n).toBe(2);

    expect(buf.f32[0]).toBe(3); // x_index preserved as given
    expect(buf.f32[1]).toBe(priceToNdc(110, 100, 200)); // open
    expect(buf.f32[2]).toBe(priceToNdc(150, 100, 200)); // high
    expect(buf.f32[3]).toBe(priceToNdc(90, 100, 200)); // low
    expect(buf.f32[4]).toBe(priceToNdc(140, 100, 200)); // close
    expect(buf.f32[5]).toBe(0.5); // volume 5 of visible max 10

    // Record 1 starts at word 8 (32 bytes later); words 6/7 of record 0 are
    // that record's own color/flags, so the next record's fields start at 8.
    const r1 = VISUAL_CANDLE_BYTES >> 2;
    expect(buf.f32[r1]).toBe(4);
    expect(buf.u32[r1 + (VISUAL_OFFSET.flags >> 2)]).toBe(BAR_FLAG_FORMING);
  });

  it('colors by close vs open', () => {
    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    fillVisualAttr({
      buf,
      bars: [src({ close: 140 }), src({ close: 105 })],
      y: Y,
      palette: PALETTE,
    });
    const r1 = VISUAL_CANDLE_BYTES >> 2;
    expect(buf.u32[VISUAL_OFFSET.color >> 2]).toBe(packRgba(PALETTE.up, 194));
    expect(buf.u32[r1 + (VISUAL_OFFSET.color >> 2)]).toBe(packRgba(PALETTE.down, 194));
  });

  it('drops bars past capacity instead of wrapping', () => {
    const buf = allocateVisualAttr(1);
    if (!buf) throw new Error('alloc');
    const bars = [src({ x: 0 }), src({ x: 1 }), src({ x: 2 })];
    const n = fillVisualAttr({ buf, bars, y: Y, palette: PALETTE });
    // capacity = 1 + 64 = 65, so all three fit here...
    expect(n).toBe(3);

    // ...but a buffer exactly at capacity stops at the last record.
    const tiny = allocateVisualAttr(1);
    if (!tiny) throw new Error('alloc');
    tiny.capacity = 2; // simulate a narrowed buffer
    expect(fillVisualAttr({ buf: tiny, bars, y: Y, palette: PALETTE })).toBe(2);
  });
});

describe('fillVisualAttrFromHot', () => {
  it('fills from the published slot with x_index as the fill slot', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(100, BAR_FLAG_CLOSED), ticks(200, BAR_FLAG_CLOSED)], {
      hotFromIndex: 0,
    });

    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    const n = fillVisualAttrFromHot(hotBuf, buf, { fromAbs: 0, visibleCount: 2, y: Y }, PALETTE);
    expect(n).toBe(2);
    expect(buf.f32[0]).toBe(0); // slot within the fill, not the absolute index
    expect(buf.f32[1]).toBe(priceToNdc(100, 100, 200));
    const r1 = VISUAL_CANDLE_BYTES >> 2;
    expect(buf.f32[r1]).toBe(1);
    expect(buf.f32[r1 + 4]).toBe(priceToNdc(200, 100, 200));
  });

  it('clips the request to the hot window', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(100, BAR_FLAG_CLOSED), ticks(200, BAR_FLAG_CLOSED)], {
      hotFromIndex: 10,
    });

    const buf = allocateVisualAttr(8);
    if (!buf) throw new Error('alloc');
    // Request starts before the window: fill starts at the overlap.
    const n = fillVisualAttrFromHot(hotBuf, buf, { fromAbs: 8, visibleCount: 4, y: Y }, PALETTE);
    expect(n).toBe(2); // only indices 10, 11 exist
    expect(buf.f32[0]).toBe(0); // still slot-relative
  });

  it('mirrors the forming flag from the slot', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(100, BAR_FLAG_FORMING)], { hotFromIndex: 0 });

    const buf = allocateVisualAttr(1);
    if (!buf) throw new Error('alloc');
    fillVisualAttrFromHot(hotBuf, buf, { fromAbs: 0, visibleCount: 1, y: Y }, PALETTE);
    expect(buf.u32[VISUAL_OFFSET.flags >> 2]).toBe(BAR_FLAG_FORMING);
    // The forming candle keeps its palette color — it is live, not absent.
    expect(buf.u32[VISUAL_OFFSET.color >> 2]).toBe(packRgba(PALETTE.up, 194));
  });

  it('normalizes volume against the visible maximum', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(100, BAR_FLAG_CLOSED, 4), ticks(200, BAR_FLAG_CLOSED, 8)], {
      hotFromIndex: 0,
    });

    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    fillVisualAttrFromHot(hotBuf, buf, { fromAbs: 0, visibleCount: 2, y: Y }, PALETTE);
    expect(buf.f32[5]).toBe(0.5); // 4 of 8
    const r1 = VISUAL_CANDLE_BYTES >> 2;
    expect(buf.f32[r1 + 5]).toBe(1); // the max itself
  });

  it('returns null while a write is in flight (odd generation)', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(100, BAR_FLAG_CLOSED)], { hotFromIndex: 0 });
    hotBuf.beginWrite(); // odd generation, never committed

    const buf = allocateVisualAttr(1);
    if (!buf) throw new Error('alloc');
    expect(
      fillVisualAttrFromHot(hotBuf, buf, { fromAbs: 0, visibleCount: 1, y: Y }, PALETTE),
    ).toBeNull();
  });

  it('returns null for an empty window or a missed viewport', () => {
    const hotBuf = hot();
    const buf = allocateVisualAttr(1);
    if (!buf) throw new Error('alloc');
    const req = { fromAbs: 0, visibleCount: 1, y: Y };

    // Nothing published yet.
    expect(fillVisualAttrFromHot(hotBuf, buf, req, PALETTE)).toBeNull();

    hotBuf.publish([ticks(100, BAR_FLAG_CLOSED)], { hotFromIndex: 0 });
    // Viewport entirely to the right of the window.
    expect(fillVisualAttrFromHot(hotBuf, buf, { ...req, fromAbs: 99 }, PALETTE)).toBeNull();
    // Degenerate y-range is refused rather than painting garbage NDC.
    expect(
      fillVisualAttrFromHot(hotBuf, buf, { ...req, y: { yMin: 5, yMax: 5 } }, PALETTE),
    ).toBeNull();
    // Non-finite request is refused.
    expect(fillVisualAttrFromHot(hotBuf, buf, { ...req, fromAbs: Number.NaN }, PALETTE)).toBeNull();
  });
});

describe('fillVisualAttrFromViewport — merged hot+page fill (§9.2)', () => {
  /** Hot window [2, 4) + cold page [0, 2): a zoomed-out viewport [0, 4). */
  function hotWithPage() {
    const hotBuf = hot();
    hotBuf.publish([ticks(300, BAR_FLAG_CLOSED), ticks(400, BAR_FLAG_CLOSED)], { hotFromIndex: 2 });
    hotBuf.publishPage([ticks(100, BAR_FLAG_CLOSED), ticks(200, BAR_FLAG_CLOSED)], {
      pageFromIndex: 0,
    });
    return hotBuf;
  }

  const R1 = VISUAL_CANDLE_BYTES >> 2; // second record starts 8 words in

  it('fills a hot-only viewport exactly like the hot fill', () => {
    const hotBuf = hotWithPage();
    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    const n = fillVisualAttrFromViewport(
      hotBuf,
      buf,
      { fromAbs: 2, visibleCount: 2, y: Y },
      PALETTE,
    );
    expect(n).toBe(2);
    expect(buf.f32[0]).toBe(0);
    expect(buf.f32[1]).toBe(priceToNdc(300, 100, 200));
    expect(buf.f32[R1]).toBe(1);
    expect(buf.f32[R1 + 4]).toBe(priceToNdc(400, 100, 200));
  });

  it('fills a page-only cold viewport from the page slot', () => {
    const hotBuf = hotWithPage();
    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    const n = fillVisualAttrFromViewport(
      hotBuf,
      buf,
      { fromAbs: 0, visibleCount: 2, y: Y },
      PALETTE,
    );
    expect(n).toBe(2);
    expect(buf.f32[0]).toBe(0);
    expect(buf.f32[1]).toBe(priceToNdc(100, 100, 200));
    expect(buf.f32[R1]).toBe(1);
    expect(buf.f32[R1 + 4]).toBe(priceToNdc(200, 100, 200));
  });

  it('merges the page prefix and hot suffix with continuous x_index', () => {
    const hotBuf = hotWithPage();
    const buf = allocateVisualAttr(4);
    if (!buf) throw new Error('alloc');
    const n = fillVisualAttrFromViewport(
      hotBuf,
      buf,
      { fromAbs: 0, visibleCount: 4, y: Y },
      PALETTE,
    );
    expect(n).toBe(4);
    const closes = [0, 1, 2, 3].map((i) => buf.f32[i * R1 + 4]);
    expect(closes).toEqual([100, 200, 300, 400].map((c) => priceToNdc(c, 100, 200)));
    expect([buf.f32[0], buf.f32[R1], buf.f32[2 * R1], buf.f32[3 * R1]]).toEqual([0, 1, 2, 3]);
  });

  it('stops at the first bar neither section covers (stale page gap)', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(500, BAR_FLAG_CLOSED)], { hotFromIndex: 5 });
    hotBuf.publishPage([ticks(100, BAR_FLAG_CLOSED)], { pageFromIndex: 0 });
    const buf = allocateVisualAttr(4);
    if (!buf) throw new Error('alloc');
    // Absolute 1..4 are covered by nothing: only the page prefix survives.
    const n = fillVisualAttrFromViewport(
      hotBuf,
      buf,
      { fromAbs: 0, visibleCount: 4, y: Y },
      PALETTE,
    );
    expect(n).toBe(1);
    expect(buf.f32[1]).toBe(priceToNdc(100, 100, 200));
  });

  it('normalizes volume over the merged covered prefix', () => {
    const hotBuf = hot();
    hotBuf.publish([ticks(300, BAR_FLAG_CLOSED, 8)], { hotFromIndex: 1 });
    hotBuf.publishPage([ticks(100, BAR_FLAG_CLOSED, 4)], { pageFromIndex: 0 });
    const buf = allocateVisualAttr(2);
    if (!buf) throw new Error('alloc');
    const n = fillVisualAttrFromViewport(
      hotBuf,
      buf,
      { fromAbs: 0, visibleCount: 2, y: Y },
      PALETTE,
    );
    expect(n).toBe(2);
    expect(buf.f32[5]).toBe(0.5); // page volume 4 of merged max 8
    expect(buf.f32[R1 + 5]).toBe(1);
  });

  it('returns null when nothing is covered, torn, or degenerate', () => {
    const buf = allocateVisualAttr(1);
    if (!buf) throw new Error('alloc');
    const req = { fromAbs: 0, visibleCount: 1, y: Y };

    // Neither section has bars.
    expect(fillVisualAttrFromViewport(hot(), buf, req, PALETTE)).toBeNull();

    const hotBuf = hotWithPage();
    // Viewport past everything both sections cover.
    expect(fillVisualAttrFromViewport(hotBuf, buf, { ...req, fromAbs: 99 }, PALETTE)).toBeNull();
    // A write in flight poisons both sections (shared generation).
    hotBuf.beginWrite();
    expect(fillVisualAttrFromViewport(hotBuf, buf, req, PALETTE)).toBeNull();
    hotBuf.commit();
    // Degenerate y-range and non-finite requests are refused.
    expect(
      fillVisualAttrFromViewport(hotBuf, buf, { ...req, y: { yMin: 5, yMax: 5 } }, PALETTE),
    ).toBeNull();
    expect(
      fillVisualAttrFromViewport(hotBuf, buf, { ...req, visibleCount: 0 }, PALETTE),
    ).toBeNull();
  });
});
