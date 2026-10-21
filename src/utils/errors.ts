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
 * Shared error helpers for network / adapter code (on-chain, alerts, workers).
 *
 * @module utils/errors
 */

/**
 * Human message for an unknown thrown value; never empty.
 *
 * @param fallback Text used when the value carries no message of its own.
 */
export function errMessage(err: unknown, fallback = 'Unknown error'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

/** True for fetch / timer aborts (`AbortError`, `TimeoutError`). */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * True when the value *looks* like a cancellation or a timeout.
 *
 * Broader than {@link isAbortError}: some runtimes surface an abort only as
 * text (`"The operation was aborted due to timeout"`, `"signal timed out"`)
 * with no `name` to inspect.
 *
 * Use this for **message shaping**. Use {@link isAbortError} when the answer
 * decides whether to rethrow — a network error whose text happens to mention
 * a timeout must still be reported as a network error.
 */
export function isAbortLike(err: unknown): boolean {
  if (isAbortError(err)) return true;
  return /abort(ed)?|timed?\s*out|timeout/i.test(errText(err));
}

/** True when an abort-like value is specifically a *timeout*. */
export function isTimeoutLike(err: unknown): boolean {
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'TimeoutError') {
    return true;
  }
  return /timed?\s*out|timeout/i.test(errText(err));
}

/** Message text of a thrown value, without the `Error` wrapper. */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}
