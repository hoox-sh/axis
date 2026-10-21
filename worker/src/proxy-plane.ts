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
 * The shared machinery behind the Worker's public proxy planes.
 *
 * `/api/onchain` and `/api/market` are both public, allowlisted, short-TTL
 * cached proxies. They had the same cache entry, the same cache lookup, the
 * same cache eviction, the same in-flight coalescing and the same response
 * builder — copied into each module, with the differences (cache header
 * name, eviction policy, upstream transport) hidden inside the copies.
 *
 * A proxy plane now states its differences once and shares the rest.
 *
 * @module worker/proxy-plane
 */

import type { UpstreamResult } from './http';

/** One cached upstream response. */
export interface CacheEntry {
  body: string;
  status: number;
  contentType: string;
  expiresAt: number;
}

/** How a plane drops entries when its cache is full. */
export type CacheEviction = 'oldest' | 'clear';

/** What a proxy plane states about itself. */
export interface ProxyPlaneOptions {
  /** CORS header set for the resolved origin. */
  cors: (origin: string) => Record<string, string>;
  /** Cache-status header name (`X-Axis-Onchain-Cache` / `X-Axis-Market-Cache`). */
  cacheHeader: string;
  /** Soft cap on cached entries. */
  maxEntries: number;
  /** What to drop when the cap is reached. */
  eviction: CacheEviction;
  /** Fetch an upstream. The plane owns the URL and the headers. */
  fetchUpstream: (url: string) => Promise<UpstreamResult>;
  /** Build a JSON response with the plane's CORS policy. */
  json: (
    body: unknown,
    status?: number,
    origin?: string,
    headers?: Record<string, string>,
  ) => Response;
}

/** A public proxy plane. */
export interface ProxyPlane {
  /** Number of entries currently cached. */
  readonly size: number;
  /** The cached entry for `key`, or `null` when it is missing or expired. */
  get(key: string): CacheEntry | null;
  /** Store a cache entry, evicting per the plane's policy when it is full. */
  put(key: string, entry: CacheEntry): void;
  /** A `Response` for a cached entry, with the plane's cache-status header. */
  cachedResponse(entry: CacheEntry, origin: string, cacheStatus: string): Response;
  /** Coalesce concurrent identical upstream fetches — one flight per key. */
  coalesce<T>(key: string, task: () => Promise<T>): Promise<T>;
  /** Fetch an upstream through the plane's transport. */
  fetch(url: string): Promise<UpstreamResult>;
  /** Build a JSON response with the plane's CORS policy. */
  json: ProxyPlaneOptions['json'];
  /** @internal test helper — drop the cached entries. */
  _resetCache(): void;
}

/** Create a proxy plane. */
export function createProxyPlane(opts: ProxyPlaneOptions): ProxyPlane {
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<unknown>>();

  const get = (key: string): CacheEntry | null => {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      cache.delete(key);
      return null;
    }
    return entry;
  };

  const put = (key: string, entry: CacheEntry): void => {
    if (cache.size >= opts.maxEntries) {
      if (opts.eviction === 'clear') {
        cache.clear();
      } else {
        const first = cache.keys().next().value;
        if (first !== undefined) cache.delete(first);
      }
    }
    cache.set(key, entry);
  };

  const cachedResponse = (entry: CacheEntry, origin: string, cacheStatus: string): Response =>
    new Response(entry.body, {
      status: entry.status,
      headers: {
        'Content-Type': entry.contentType || 'application/json',
        [opts.cacheHeader]: cacheStatus,
        ...opts.cors(origin),
      },
    });

  const coalesce = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const pending = task();
    inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (inflight.get(key) === pending) inflight.delete(key);
    }
  };

  return {
    get size() {
      return cache.size;
    },
    get,
    put,
    cachedResponse,
    coalesce,
    fetch: opts.fetchUpstream,
    json: opts.json,
    _resetCache: () => {
      cache.clear();
      inflight.clear();
    },
  };
}
