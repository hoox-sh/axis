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
 * Bounded in-memory result cache for the indicator runner.
 *
 * Memoizes successful engine results by `(engine, scriptId, scriptHash,
 * inputs, config, barsGen, barsLength)` so repeated identical runs (re-apply,
 * panel re-attaches, quick toggles) do not pay for another engine round trip.
 *
 * The cache is intentionally **disabled** under test to avoid cross-test
 * pollution; it is also skipped for live ticks, isolated studies, aborted
 * runs, and any caller that passes `opts.disableCache`.
 *
 * @module indicators/run-cache
 */

import type { NormalizedRunResult } from './run-helpers';

type CacheEntry = {
  result: NormalizedRunResult;
  expiresAt: number;
};

const DEFAULT_MAX = 16;
const DEFAULT_TTL_MS = 30_000;

let maxEntries = DEFAULT_MAX;
let ttlMs = DEFAULT_TTL_MS;

const cache = new Map<string, CacheEntry>();

function isTestEnvironment(): boolean {
  try {
    if (import.meta.env && import.meta.env['TEST']) return true;
  } catch {
    /* import.meta may be unavailable in older runtimes */
  }
  try {
    if (typeof process !== 'undefined' && process.env && process.env['NODE_ENV'] === 'test') {
      return true;
    }
  } catch {
    /* process may be polyfilled differently */
  }
  return false;
}

function cloneResult(result: NormalizedRunResult): NormalizedRunResult {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(result) as NormalizedRunResult;
    } catch {
      /* fall through to JSON fallback */
    }
  }
  return JSON.parse(JSON.stringify(result)) as NormalizedRunResult;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

function evictLRU(): void {
  const first = cache.keys().next().value;
  if (first != null) cache.delete(first);
}

/** Configure cache size / TTL at runtime (mainly for tests). */
export function setRunCacheOptions(opts: { maxEntries?: number; ttlMs?: number }): void {
  if (opts.maxEntries != null && Number.isFinite(opts.maxEntries) && opts.maxEntries > 0) {
    maxEntries = opts.maxEntries;
    while (cache.size > maxEntries) evictLRU();
  }
  if (opts.ttlMs != null && Number.isFinite(opts.ttlMs) && opts.ttlMs >= 0) {
    ttlMs = opts.ttlMs;
    if (ttlMs === 0) cache.clear();
  }
}

/** Drop every cached result. */
export function resetRunCache(): void {
  cache.clear();
}

/** True when the environment and flags allow caching. */
export function runCacheEnabled(): boolean {
  if (isTestEnvironment()) return false;
  return ttlMs > 0 && maxEntries > 0;
}

/** Stable numeric hash for arbitrary strings (DJB2). */
export function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

/** Recursive, order-stable fingerprint for arbitrary input values. */
export function fingerprintValue(v: unknown): string {
  if (v == null) return 'null';
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v as number) ? String(v) : 'nan';
  if (t === 'boolean') return v ? 't' : 'f';
  if (t === 'string') return `s:${v}`;
  if (Array.isArray(v)) {
    const n = v.length;
    if (!n) return '[]';
    const first = fingerprintValue(v[0]);
    const last = fingerprintValue(v[n - 1]);
    const mid = fingerprintValue(v[Math.floor(n / 2)]);
    return `[${n}|${first}|${mid}|${last}]`;
  }
  if (t === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${fingerprintValue(obj[k])}`).join(',')}}`;
  }
  return `x:${String(v)}`;
}

/**
 * Build a cache key for the resolved run request.
 *
 * The key intentionally excludes the full bar array contents. Generation
 * counters + length alone are **not** enough anymore: the anchored live
 * window appends without bumping `barPlane.gen`, and the engine depth is
 * chunked in 100-bar steps, so both stay constant for many bars. The window's
 * first / last bar time pin the actual slice without hashing the array.
 */
export function buildRunCacheKey(input: {
  engineId: string;
  engineEndpoint?: string;
  scriptId: string;
  scriptSource: string;
  inputs: Record<string, unknown>;
  config: Record<string, unknown>;
  barsGen: number;
  barsLength: number;
  /** Oldest bar time in the evaluated window (unix seconds). */
  barsFirst?: number;
  /** Newest bar time in the evaluated window (unix seconds). */
  barsLast?: number;
  librariesKey?: string;
  isolate?: boolean;
  liveTick?: boolean;
}): string {
  const parts = [
    input.engineId,
    input.engineEndpoint ?? '',
    input.scriptId,
    hashString(input.scriptSource).toString(36),
    hashString(fingerprintValue(input.inputs)).toString(36),
    hashString(fingerprintValue(input.config)).toString(36),
    input.barsGen.toString(),
    input.barsLength.toString(),
    String(input.barsFirst ?? ''),
    String(input.barsLast ?? ''),
    input.librariesKey ?? '',
    input.isolate ? '1' : '0',
    input.liveTick ? '1' : '0',
  ];
  return parts.join('\0');
}

/** Look up a cached result; returns a clone so callers cannot mutate stored data. */
export function getRunCache(key: string): NormalizedRunResult | undefined {
  if (!runCacheEnabled()) return undefined;
  const now = Date.now();
  pruneExpired(now);
  const entry = cache.get(key);
  if (!entry) return undefined;
  // Move to most-recent position (LRU).
  cache.delete(key);
  cache.set(key, entry);
  return cloneResult(entry.result);
}

/**
 * Store a successful normalized result. The stored copy is cloned so later
 * chart apply stages cannot corrupt the cache entry.
 */
export function setRunCache(key: string, result: NormalizedRunResult): void {
  if (!runCacheEnabled()) return;
  const now = Date.now();
  pruneExpired(now);
  while (cache.size >= maxEntries && cache.size > 0) evictLRU();
  cache.set(key, { result: cloneResult(result), expiresAt: now + ttlMs });
}
