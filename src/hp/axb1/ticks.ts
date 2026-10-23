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
 * Canonical AXB1 price ticks: int64 = round(decimal × 10^scale).
 *
 * float32 is never used here. GPU NDC float32 happens later, after a
 * viewport-normalized copy-out.
 *
 * @module hp/axb1/ticks
 */

import { PRICE_SCALE_MAX, PRICE_SCALE_MIN } from './constants';

export function assertPriceScale(scale: number): number {
  if (!Number.isInteger(scale) || scale < PRICE_SCALE_MIN || scale > PRICE_SCALE_MAX) {
    throw new RangeError(`price_scale must be an integer ${PRICE_SCALE_MIN}..${PRICE_SCALE_MAX}`);
  }
  return scale;
}

/**
 * JS-number fallback. Stays in IEEE-754 binary64, then `Math.round`.
 *
 * Venue/engine decimal strings must use {@link decimalToTicks} — `0.1` style
 * values are not bit-exact in float64.
 */
export function priceToTicks(price: number, scale: number): bigint {
  if (!Number.isFinite(price)) throw new TypeError('price must be finite');
  assertPriceScale(scale);
  const m = 10 ** scale;
  return BigInt(Math.round(price * m));
}

/** Display copy-out. Loses integer precision for huge tick counts (LWC uses JS numbers). */
export function ticksToPrice(ticks: bigint, scale: number): number {
  assertPriceScale(scale);
  return Number(ticks) / 10 ** scale;
}

/**
 * Exact decimal-string → ticks. Extra fractional digits round half away from 0.
 *
 * `decimalToTicks('0.00000012', 8) === 12n`
 */
export function decimalToTicks(s: string, scale: number): bigint {
  assertPriceScale(scale);
  const raw = String(s).trim();
  if (!raw) throw new TypeError('decimal');
  let sign = 1n;
  let body = raw;
  if (body.charAt(0) === '-') {
    sign = -1n;
    body = body.slice(1);
  } else if (body.charAt(0) === '+') {
    body = body.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(body)) throw new TypeError(`invalid decimal: ${s}`);
  const dot = body.indexOf('.');
  const ip = dot < 0 ? body : body.slice(0, dot);
  const fp = dot < 0 ? '' : body.slice(dot + 1);
  const scaleN = BigInt(scale);
  const ten = 10n ** scaleN;
  const whole = BigInt(ip || '0') * ten;
  if (fp.length <= scale) {
    const frac = BigInt((fp + '0'.repeat(scale - fp.length)) || '0');
    return sign * (whole + frac);
  }
  const keep = BigInt(fp.slice(0, scale) || '0');
  let n = whole + keep;
  const roundDigit = fp.charCodeAt(scale) - 48;
  if (roundDigit >= 5) n += 1n;
  return sign * n;
}

/** True when a float32 rounding of `price` disagrees with float64 ticks at `scale`. */
export function float32LosesTicks(price: number, scale: number): boolean {
  if (!Number.isFinite(price)) return false;
  const f32 = new Float32Array(1);
  f32[0] = price;
  return priceToTicks(price, scale) !== priceToTicks(f32[0] as number, scale);
}
