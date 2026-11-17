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
 * Bar-close verification state machine for Redesign2.
 *
 * On bar close the client re-verifies the closed OHLCV against the exchange
 * (final/plan.mdx §7): the engine's `close` frame carries the finalized bar,
 * the client fetches the same bar from the venue (or Worker proxy), and a
 * field-by-field compare (1e-9 relative tolerance) decides `match` vs `mismatch`. A mismatch
 * sends `repair {from_time}` — the exchange's version always wins; the client
 * never edits closed bars locally.
 *
 * Transport (venue fetch / repair dispatch) hooks up in F-16; this module
 * owns the compare + pending-guard so the rule is unit-tested in isolation.
 *
 * @module engine/bar-close-verify
 */

/**
 * Verdict for a closed bar: `match` (identical OHLCV), `mismatch` (repair the engine copy),
 * or `unknown` (a side was non-finite, so nothing can be proven).
 */
export type VerificationResult = 'match' | 'mismatch' | 'unknown';

/** A closed bar's five values, as the engine and the venue each report them. */
export interface ClosedOhlcv {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Venue lookup key for re-verifying one closed bar: the canonical series key plus the bar's
 * open time in unix seconds.
 */
export interface VerifyRequest {
  seriesKey: string;
  time: number;
}

/**
 * Field-by-field compare of a closed bar with a relative tolerance.
 *
 * The engine rebuilds bars from a streamed feed while the verifier re-reads
 * the venue's REST kline; two honest paths can disagree by float round-off
 * (string→double parsing, different summation order for volume). An exact
 * compare read that dust as a venue "revision" and fired the repair path on
 * good bars, which in turn re-pinned sealed indicator paint. Anything beyond
 * {@link COMPARE_REL_TOL} relative is a real revision and still reports
 * `mismatch`. Non-finite values on either side are `unknown`.
 */
const COMPARE_REL_TOL = 1e-9;
const COMPARE_ABS_FLOOR = Number.EPSILON * 8;

function sameClosedValue(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return diff <= Math.max(scale * COMPARE_REL_TOL, COMPARE_ABS_FLOOR);
}

export function compareClosedOhlcv(engine: ClosedOhlcv, venue: ClosedOhlcv): VerificationResult {
  const fields = ['open', 'high', 'low', 'close', 'volume'] as const;
  for (const f of fields) {
    const a = engine[f];
    const b = venue[f];
    if (typeof a !== 'number' || typeof b !== 'number') return 'unknown';
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 'unknown';
    if (!sameClosedValue(a, b)) return 'mismatch';
  }
  return 'match';
}

/** Build the venue lookup for re-verifying one closed bar. */
export function verifyRequestFor(seriesKey: string, time: number): VerifyRequest {
  return { seriesKey, time };
}

/**
 * Single-flight guard for bar-close verification: a second `begin()` before `finish()` throws,
 * so two venue checks for the same close cannot interleave and both report.
 */
export class Redesign2BarCloseVerifier {
  private pending = false;

  begin(): void {
    if (this.pending) throw new Error('verification already pending');
    this.pending = true;
  }

  finish(result: VerificationResult): VerificationResult {
    if (!this.pending) throw new Error('no verification pending');
    this.pending = false;
    return result;
  }

  get isPending(): boolean {
    return this.pending;
  }
}
