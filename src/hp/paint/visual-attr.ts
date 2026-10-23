// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Visual attribute buffer — the GPU / LWC staging boundary (HP PR 8, §6.5).
 *
 * One candle becomes one 32-byte record. The Float32 fields are
 * **viewport-normalized NDC only**: price ticks never cross into this
 * struct, so the GPU never needs a float64 or an `int64` view (neither is
 * renderable, and WebGPU has no float64). Canonical values stay in the SAB.
 *
 * ```text
 * struct VisualCandle {   // 32 bytes, 8-byte aligned
 *   f32 x_index;          // 0 .. visibleCount
 *   f32 y_open_ndc;       // -1 .. +1, y = -1 at yMin (bottom)
 *   f32 y_high_ndc;
 *   f32 y_low_ndc;
 *   f32 y_close_ndc;
 *   f32 volume_norm;      // 0 .. 1 of the visible maximum
 *   u32 rgba;             // 0xAABBGGRR (little-endian: bytes read R,G,B,A)
 *   u32 flags;            // BAR_FLAG_* bits, mirrored from the hot slot
 * }
 * ```
 *
 * `rgba` is packed **little-endian** so its bytes read as `R G B A` in
 * memory. That is what a `Uint32Array`-backed 2D canvas expects (its
 * `Uint8ClampedArray` view is RGBA in byte order), and a WebGL2 `RGBA8`
 * vertex attribute consumes the same bytes. A WebGPU `vec4<f32>` attribute
 * would need a shader-side swizzle — noted here so the WebGPU backend does
 * not inherit the assumption silently.
 *
 * NDC is computed in float64 and narrowed once, at the store. The local
 * viewport range masks the float32 mantissa loss (`§6.5`): prices span a
 * few thousand device pixels at most, so relative error stays far below one
 * pixel.
 *
 * @module hp/paint/visual-attr
 */

import { BAR_FLAG_CLOSED, BAR_FLAG_FORMING, type HotBuffer } from '../memory/hot-buffer';

/** Bytes per `VisualCandle` (6 × f32 + u32 + u32). */
export const VISUAL_CANDLE_BYTES = 32;

/** Float32 fields per record (`x, open, high, low, close, volume`). */
export const VISUAL_CANDLE_F32 = 6;

/**
 * Record stride in 4-byte words (and in `f32`/`u32` index space).
 *
 * The record is 8 words: the 6 float fields, then `color` and `flags`.
 * Field *n* of record *i* lives at index `i * VISUAL_RECORD_WORDS + n` — the
 * stride is **8**, not 6; using the field count as a stride makes record
 * `i+1` overwrite record *i*'s color/flags.
 */
export const VISUAL_RECORD_WORDS = VISUAL_CANDLE_BYTES >> 2;

/** Byte offset of each field, for building GPU vertex layouts. */
export const VISUAL_OFFSET = {
  x: 0,
  open: 4,
  high: 8,
  low: 12,
  close: 16,
  volume: 20,
  /** `u32` color, packed `0xAABBGGRR`. */
  color: 24,
  /** `u32` {@link BAR_FLAG_CLOSED} / {@link BAR_FLAG_FORMING} mirror. */
  flags: 28,
} as const;

/**
 * How far past the last visible candle the buffer is filled (`§6.5`).
 * Double-buffer **visible + 64**, not `HOT_CAP` — the tail absorbs a
 * forming-bar append or a one-tick pan before the next fill.
 */
export const VISUAL_TAIL = 64;

/** Re-exported so callers do not reach into `memory/hot-buffer` for bits. */
export { BAR_FLAG_CLOSED, BAR_FLAG_FORMING };

/** Colors handed to a fill. Already resolved from theme tokens by the caller. */
export type VisualPalette = {
  /** `0xRRGGBB` — close ≥ open. */
  up: number;
  /** `0xRRGGBB` — close < open. */
  down: number;
};

/** One candle, in float64. `x` is the caller's screen-space slot. */
export type VisualSourceBar = {
  x: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** {@link BAR_FLAG_CLOSED} | {@link BAR_FLAG_FORMING}. */
  flags: number;
};

/** The visible price window a fill maps onto. */
export type VisualYRange = {
  /** Lowest visible price → NDC `-1` (bottom). */
  yMin: number;
  /** Highest visible price → NDC `+1` (top). */
  yMax: number;
};

/**
 * Float32 color with `alpha255`, packed `0xAABBGGRR`.
 *
 * `0xRRGGBB` is re-ordered so the stored bytes are `R, G, B, A` — the byte
 * order a 2D-canvas `Uint32Array` and a WebGL2 `RGBA8` attribute both read.
 */
export function packRgba(color: number, alpha255 = 255): number {
  const rgb = color & 0xffffff;
  const a = alpha255 & 0xff;
  // `>>> 0`: with alpha ≥ 0x80 bit 31 is set, and this value is stored into a
  // Uint32Array — returning a negative int32 would only surprise assertions.
  return (((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff) | (a << 24)) >>> 0;
}

/**
 * Map a price to NDC in float64, then narrow to float32.
 *
 * `y = -1` is `yMin` (bottom), so NDC matches the screen's up-is-positive
 * convention rather than clip space's +1-is-top.
 */
export function priceToNdc(price: number, yMin: number, yMax: number): number {
  const span = yMax - yMin;
  if (!(span > 0)) return 0;
  return Math.fround(2 * ((price - yMin) / span) - 1);
}

/** Clip a volume to `0..1` of the visible maximum (float32-safe). */
export function normalizeVolume(volume: number, maxVolume: number): number {
  if (!(maxVolume > 0) || !(volume > 0)) return 0;
  return Math.fround(Math.min(1, volume / maxVolume));
}

/** How many records a viewport of `visibleCount` candles needs. */
export function visualCapacity(visibleCount: number): number {
  const n = Math.max(0, Math.trunc(visibleCount));
  if (n === 0) return 0;
  return n + VISUAL_TAIL;
}

export type VisualAttrBuffer = {
  /** `Float32Array` over the whole buffer (`capacity × 8` words). */
  f32: Float32Array;
  /** `Uint32Array` over the same bytes, for `color` / `flags`. */
  u32: Uint32Array;
  /** Backing storage, handed to the GPU as a vertex buffer. */
  bytes: ArrayBuffer;
  capacity: number;
};

/** Allocate a staging buffer for `visibleCount` candles (`null` when empty). */
export function allocateVisualAttr(visibleCount: number): VisualAttrBuffer | null {
  const capacity = visualCapacity(visibleCount);
  if (capacity === 0) return null;
  const bytes = new ArrayBuffer(capacity * VISUAL_CANDLE_BYTES);
  return {
    f32: new Float32Array(bytes),
    u32: new Uint32Array(bytes),
    bytes,
    capacity,
  };
}

export type FillVisualOptions = {
  buf: VisualAttrBuffer;
  bars: readonly VisualSourceBar[];
  y: VisualYRange;
  /** Visible maximum volume; `0` leaves every `volume_norm` at `0`. */
  maxVolume?: number;
  palette: VisualPalette;
  /** Body/wick alpha `0..255`. Default 194 ≈ `.76`, matching LWC body alpha. */
  alpha255?: number;
};

/**
 * Fill `buf` from float64 bars.
 *
 * Returns the number of records written. Bars beyond `buf.capacity` are
 * dropped rather than wrapping — a caller that outgrows the buffer must
 * reallocate (`visible + 64` already absorbs normal pan slack).
 *
 * This is the CPU reference for the GPU path: `tests/hp/visual-attr.test.ts`
 * pins it, and a renderer is compared against it.
 */
export function fillVisualAttr(opts: FillVisualOptions): number {
  const { buf, bars, y, palette } = opts;
  const maxVolume = opts.maxVolume ?? 0;
  const alpha = opts.alpha255 ?? 194;
  const n = Math.min(bars.length, buf.capacity);
  const { f32, u32 } = buf;

  for (let i = 0; i < n; i++) {
    const bar = bars[i] as VisualSourceBar;
    const o = i * VISUAL_RECORD_WORDS;
    f32[o] = Math.fround(bar.x);
    f32[o + 1] = priceToNdc(bar.open, y.yMin, y.yMax);
    f32[o + 2] = priceToNdc(bar.high, y.yMin, y.yMax);
    f32[o + 3] = priceToNdc(bar.low, y.yMin, y.yMax);
    f32[o + 4] = priceToNdc(bar.close, y.yMin, y.yMax);
    f32[o + 5] = normalizeVolume(bar.volume, maxVolume);
    const word = i * VISUAL_RECORD_WORDS;
    // The forming bar keeps the palette color: it is a live candle, not an
    // absent one. `flags` carries FORMING so a renderer may style it apart.
    const rising = bar.close >= bar.open;
    u32[word + (VISUAL_OFFSET.color >> 2)] = packRgba(rising ? palette.up : palette.down, alpha);
    u32[word + (VISUAL_OFFSET.flags >> 2)] = bar.flags >>> 0;
  }
  return n;
}

export type FillFromHotRequest = {
  /** Absolute index of the first visible bar (0 = oldest known bar). */
  fromAbs: number;
  /** Candles the viewport shows (before the `+64` tail). */
  visibleCount: number;
  /** Visible price window — the same one LWC's right scale is showing. */
  y: VisualYRange;
};

/**
 * Fill from the hot SAB, seqlock-verified, mirroring `copy-out-lwc`.
 *
 * `null` — keep the previous frame — when a write is in flight for the whole
 * retry budget, the window is empty, or the viewport misses the hot window
 * (cold ranges need the page slot — see `fillVisualAttrFromViewport`).
 * Never paints a torn sample.
 */
export function fillVisualAttrFromHot(
  buffer: HotBuffer,
  buf: VisualAttrBuffer,
  req: FillFromHotRequest,
  palette: VisualPalette,
  attempts = 8,
): number | null {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.visibleCount)) return null;
  if (!(req.y.yMax > req.y.yMin)) return null;
  const wantFrom = Math.trunc(req.fromAbs);
  const wantCount = Math.trunc(req.visibleCount);
  if (wantCount <= 0) return null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const sample = buffer.control.sample();
    if (!sample) continue; // odd generation — a write is in flight

    const hotFrom = buffer.control.hotFromIndex;
    const hotCount = buffer.control.hotCount;
    if (hotCount <= 0) return null;

    const from = Math.max(wantFrom, hotFrom);
    const to = Math.min(wantFrom + wantCount, hotFrom + hotCount);
    if (to <= from) return null; // viewport is outside the hot window

    const scale = buffer.priceScale;
    const first = from - hotFrom;
    const len = to - from;
    const n = Math.min(len, buf.capacity);

    // Pass 1: the visible volume maximum, so `volume_norm` is viewport-relative.
    let maxVolume = 0;
    for (let i = 0; i < n; i++) {
      // `noUncheckedIndexedAccess`: the column read is typed `| undefined`.
      const v = buffer.readBar(sample.slot, first + i, scale).volume ?? 0;
      if (v > maxVolume) maxVolume = v;
    }

    // Pass 2: write the records. x_index is the slot within this fill; the
    // renderer turns it into screen x via barSpacing.
    const { f32, u32 } = buf;
    for (let i = 0; i < n; i++) {
      // `noUncheckedIndexedAccess` types each column read `| undefined`.
      const bar = buffer.readBar(sample.slot, first + i, scale);
      const open = bar.open ?? 0;
      const high = bar.high ?? 0;
      const low = bar.low ?? 0;
      const close = bar.close ?? 0;
      const volume = bar.volume ?? 0;
      const word = i * VISUAL_RECORD_WORDS;
      f32[word] = Math.fround(i);
      f32[word + 1] = priceToNdc(open, req.y.yMin, req.y.yMax);
      f32[word + 2] = priceToNdc(high, req.y.yMin, req.y.yMax);
      f32[word + 3] = priceToNdc(low, req.y.yMin, req.y.yMax);
      f32[word + 4] = priceToNdc(close, req.y.yMin, req.y.yMax);
      f32[word + 5] = normalizeVolume(volume, maxVolume);
      const flags = (bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED) >>> 0;
      const rising = close >= open;
      u32[word + (VISUAL_OFFSET.color >> 2)] = packRgba(rising ? palette.up : palette.down, 194);
      u32[word + (VISUAL_OFFSET.flags >> 2)] = flags;
    }

    // Seqlock verify: a write that landed mid-copy discards the whole sample.
    if (buffer.control.generation !== sample.generation) continue;
    return n;
  }
  return null;
}

/**
 * Fill a viewport from the hot window **and** the cold page slot (HP PR 5
 * wiring, §9.2) — one seqlock sample for both sections.
 *
 * Same dispatch as `copyOutViewport`, but merged into one fill: the cold
 * prefix (records `[0, coldLen)`) reads the page slot, the hot suffix reads
 * the published hot slot, and `x_index` stays the slot within the viewport
 * so the renderer needs no section awareness. Volume is normalized over the
 * merged covered prefix.
 *
 * The fill is a **contiguous run from `req.fromAbs`**: it stops at the first
 * bar neither section covers (a gap means the page is stale or pending — the
 * caller re-requests it and LWC keeps painting underneath). `null` when
 * nothing is covered, the window is empty, or a write is in flight for the
 * whole retry budget. Never paints a torn sample.
 */
export function fillVisualAttrFromViewport(
  buffer: HotBuffer,
  buf: VisualAttrBuffer,
  req: FillFromHotRequest,
  palette: VisualPalette,
  attempts = 8,
): number | null {
  if (!Number.isFinite(req.fromAbs) || !Number.isFinite(req.visibleCount)) return null;
  if (!(req.y.yMax > req.y.yMin)) return null;
  const wantFrom = Math.trunc(req.fromAbs);
  const wantCount = Math.trunc(req.visibleCount);
  if (wantCount <= 0) return null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const sample = buffer.control.sample();
    if (!sample) continue; // odd generation — a write is in flight

    const hotFrom = buffer.control.hotFromIndex;
    const hotCount = buffer.control.hotCount;
    const pageOn = buffer.pageActive;
    const pageFrom = buffer.control.pageFromIndex;
    const pageCount = buffer.control.pageCount;
    if (hotCount <= 0 && !(pageOn && pageCount > 0)) return null;

    const scale = buffer.priceScale;
    const slot = sample.slot;
    const inHot = (abs: number): boolean => abs >= hotFrom && abs < hotFrom + hotCount;
    const inPage = (abs: number): boolean =>
      pageOn && abs >= pageFrom && abs < pageFrom + pageCount;

    // Pass 1: the covered prefix length and its visible volume maximum.
    let len = 0;
    let maxVolume = 0;
    while (len < wantCount && len < buf.capacity) {
      const abs = wantFrom + len;
      let v: number | undefined;
      if (inHot(abs)) v = buffer.readBar(slot, abs - hotFrom, scale).volume ?? 0;
      else if (inPage(abs)) v = buffer.readPageBar(abs - pageFrom, scale).volume ?? 0;
      else break; // gap — the page is stale or pending; stop the run
      if (v > maxVolume) maxVolume = v;
      len++;
    }
    if (len <= 0) return null;

    // Pass 2: write the records. x_index is the slot within this fill.
    const { f32, u32 } = buf;
    for (let i = 0; i < len; i++) {
      const abs = wantFrom + i;
      const bar = inHot(abs)
        ? buffer.readBar(slot, abs - hotFrom, scale)
        : buffer.readPageBar(abs - pageFrom, scale);
      const open = bar.open ?? 0;
      const high = bar.high ?? 0;
      const low = bar.low ?? 0;
      const close = bar.close ?? 0;
      const volume = bar.volume ?? 0;
      const word = i * VISUAL_RECORD_WORDS;
      f32[word] = Math.fround(i);
      f32[word + 1] = priceToNdc(open, req.y.yMin, req.y.yMax);
      f32[word + 2] = priceToNdc(high, req.y.yMin, req.y.yMax);
      f32[word + 3] = priceToNdc(low, req.y.yMin, req.y.yMax);
      f32[word + 4] = priceToNdc(close, req.y.yMin, req.y.yMax);
      f32[word + 5] = normalizeVolume(volume, maxVolume);
      const flags = (bar.closed === false ? BAR_FLAG_FORMING : BAR_FLAG_CLOSED) >>> 0;
      const rising = close >= open;
      u32[word + (VISUAL_OFFSET.color >> 2)] = packRgba(rising ? palette.up : palette.down, 194);
      u32[word + (VISUAL_OFFSET.flags >> 2)] = flags;
    }

    // Seqlock verify: a write that landed mid-copy discards the whole sample.
    if (buffer.control.generation !== sample.generation) continue;
    return len;
  }
  return null;
}
