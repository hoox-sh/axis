/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * LWC's candle geometry constants, mirrored for the GPU overlay.
 *
 * The overlay draws the same candles Lightweight Charts draws, so its body
 * and wick widths have to be **the same CSS pixels**, not merely a similar
 * fraction of the slot: LWC derives the body from `barSpacing`, the device
 * pixel ratio and a spacing-dependent coefficient (`optimalCandlestickWidth`
 * in `lightweight-charts`), while the wick is a flat one-CSS-pixel line.
 * Guessing `0.75 · barSpacing` leaves a visible fringe at every candle edge.
 *
 * Both functions return **device pixels**, mirroring LWC; callers divide by
 * the same `pixelRatio` to get the CSS width they hand the renderer.
 *
 * @module hp/render/lwc-candle-width
 */

/** LWC special-cases small spacings to a flat 3-device-pixel body. */
const SPECIAL_FROM = 2.5;
const SPECIAL_TO = 4;
const SPECIAL_COEFF = 3;

/** How fast the body narrows as spacing grows. */
const REDUCING_COEFF = 0.2;

/**
 * Body width in **device pixels**, exactly LWC's `optimalCandlestickWidth`.
 *
 * @param barSpacing CSS px per candle slot.
 * @param pixelRatio device pixels per CSS px of LWC's canvas.
 */
export function lwcCandleBodyPx(barSpacing: number, pixelRatio: number): number {
  const bs = Number.isFinite(barSpacing) ? Math.max(0, barSpacing) : 0;
  const hr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  if (bs >= SPECIAL_FROM && bs <= SPECIAL_TO) return Math.floor(SPECIAL_COEFF * hr);
  const coeff =
    1 - (REDUCING_COEFF * Math.atan(Math.max(SPECIAL_TO, bs) - SPECIAL_TO)) / (Math.PI * 0.5);
  const res = Math.floor(bs * coeff * hr);
  const scaled = Math.floor(bs * hr);
  return Math.max(Math.floor(hr), Math.min(res, scaled));
}

/**
 * Wick width in **device pixels** — LWC's
 * `min(floor(pixelRatio), floor(barSpacing * pixelRatio))`: a one-CSS-pixel
 * line whenever the slot is at least one pixel wide.
 */
export function lwcCandleWickPx(barSpacing: number, pixelRatio: number): number {
  const bs = Number.isFinite(barSpacing) ? Math.max(0, barSpacing) : 0;
  const hr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.min(Math.floor(hr), Math.floor(bs * hr));
}

/** Body width in CSS px for a renderer viewport. */
export function lwcCandleBodyCss(barSpacing: number, pixelRatio: number): number {
  const hr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return lwcCandleBodyPx(barSpacing, hr) / hr;
}

/** Wick width in CSS px for a renderer viewport. */
export function lwcCandleWickCss(barSpacing: number, pixelRatio: number): number {
  const hr = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return lwcCandleWickPx(barSpacing, hr) / hr;
}
