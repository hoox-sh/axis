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
 * Best-effort in-isolate fixed-window rate limiter.
 *
 * Extracted from verbatim copies in `runtime.ts` (`/api/run`) and
 * `git-oauth.ts` (device-flow relay). The MCP plane used to keep its own
 * fork of this algorithm; it now shares this one.
 *
 * **Not durable.** Buckets live in isolate memory: per-isolate, best-effort on
 * the edge, and reset whenever an isolate recycles. That is deliberate for
 * these two routes — it blunts casual abuse without a KV/D1 round trip per
 * request. Anything that needs a hard global limit must use `USAGE` KV or D1.
 *
 * @module worker/rate-limit
 */

interface Bucket {
  count: number;
  windowStart: number;
}

/** Shared bucket map — one per isolate, keyed by caller-supplied bucket key. */
const buckets = new Map<string, Bucket>();

/** Opportunistic prune threshold; keeps the map from growing without bound. */
const MAX_BUCKETS = 5000;

/**
 * Fixed-window counter.
 *
 * @param key Bucket identity (usually a client IP or an API key). Callers
 *   **must** namespace it — the map is shared by every route.
 * @param limit Allowed calls per window.
 * @param windowMs Window length in ms.
 * @param weight Calls this request consumes. A request is allowed only if the
 *   whole weight fits in the remaining budget, so a batch can never be
 *   counted twice.
 * @returns `true` when the call is allowed (and counted), `false` once over.
 */
export function allowRate(key: string, limit: number, windowMs: number, weight = 1): boolean {
  const now = Date.now();
  const w = weight > 0 ? Math.floor(weight) : 1;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    // Fresh window — the whole request must fit in the limit.
    if (w > limit) return false;
    buckets.set(key, { count: w, windowStart: now });
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, v] of buckets) {
        if (now - v.windowStart > windowMs * 2) buckets.delete(k);
      }
    }
    return true;
  }
  // All-or-nothing: a request that does not fit is rejected *without* being
  // counted, so a rejected batch never eats into the next caller's budget.
  if (bucket.count + w > limit) return false;
  bucket.count += w;
  return true;
}

/** @internal test helper — clear buckets between cases. */
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}