/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure service-worker strategy helpers (unit-testable).
 *
 * The shipping classic SW (`public/sw.js`, root `sw.js`) mirrors these rules
 * inline — keep both in sync when changing cache policy.
 *
 * ## Invariants (manual + unit)
 *
 * 1. Cache names are `axis-shell-*` / `axis-runtime-*` only.
 * 2. Activate deletes **old axis-*** caches and never the current pair.
 * 3. API (`/api/*`) is network-first; only cache HTTP 200 basic responses.
 * 4. Never treat opaque / error responses as cacheable success.
 * 5. Non-GET is not handled by the SW (browser default).
 * 6. Self-hosted pyodide + vendor paths are same-origin static → cache-first
 *    after first successful fetch (offline engine).
 * 7. Navigation is network-first with shell fallback (fresh HTML when online).
 * 8. Navigation never rejects `respondWith` — offline shell HTML if cache miss.
 *
 * ## Manual checklist (DevTools → Application)
 *
 * - [ ] Production build serves `/sw.js` (dist) and registers once.
 * - [ ] After version bump, old `axis-*` caches disappear; current remain.
 * - [ ] Offline: shell + previously loaded `/pyodide/*` + `/vendor/*` still load.
 * - [ ] `/api/*` while offline returns 503 JSON when nothing cached.
 * - [ ] Failed opaque / non-OK responses do not appear as successful cache entries.
 */

/** Bump when shell precache or strategy semantics change. */
export const SW_VERSION = 'v5';

export const CACHE_PREFIX = 'axis-';

/**
 * Soft cap on `axis-runtime-*` entries (hashed assets, pyodide, CDN).
 * FIFO trim after put — prevents unbounded Cache Storage growth.
 * Mirrored in `public/sw.js` / root `sw.js`.
 */
export const RUNTIME_CACHE_MAX_ENTRIES = 96;

export function shellCacheName(version: string = SW_VERSION): string {
  return `${CACHE_PREFIX}shell-${version}`;
}

export function runtimeCacheName(version: string = SW_VERSION): string {
  return `${CACHE_PREFIX}runtime-${version}`;
}

export function isAxisCacheName(name: string): boolean {
  return name.startsWith(CACHE_PREFIX);
}

/**
 * When `keyCount` exceeds `max`, return how many leading keys to drop
 * (Cache.keys() is insertion order — approximate FIFO / LRU-adjacent).
 */
export function runtimeCacheDropCount(
  keyCount: number,
  max: number = RUNTIME_CACHE_MAX_ENTRIES,
): number {
  if (!Number.isFinite(keyCount) || keyCount <= 0) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return keyCount > max ? keyCount - max : 0;
}

/**
 * Names to delete on activate: axis-* caches that are not the live shell/runtime pair.
 * Leaves unrelated (non-axis) caches alone.
 */
export function cachesToDelete(
  existing: readonly string[],
  keep: readonly string[],
): string[] {
  const keepSet = new Set(keep);
  return existing.filter((n) => isAxisCacheName(n) && !keepSet.has(n));
}

const CDN_HOST_RE =
  /(?:^|\.)(esm\.sh|jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/i;

export function isCdnHost(host: string): boolean {
  return CDN_HOST_RE.test(host);
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export type RequestClass =
  | 'api'
  | 'navigate'
  | 'cdn'
  | 'static'
  | 'bypass';

export type RequestLike = {
  method: string;
  mode?: string;
  destination?: string;
};

/**
 * Classify a request for fetch routing.
 * `swOrigin` is the service worker script origin (usually `self.location.origin`).
 */
export function classifyRequest(
  url: { origin: string; pathname: string; host: string },
  request: RequestLike,
  swOrigin: string,
): RequestClass {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return 'bypass';

  if (url.origin === swOrigin && isApiPath(url.pathname)) return 'api';

  if (request.mode === 'navigate' || request.destination === 'document') {
    return 'navigate';
  }

  if (isCdnHost(url.host)) return 'cdn';

  if (url.origin === swOrigin) return 'static';

  return 'bypass';
}

export type ResponseLike = {
  ok: boolean;
  status: number;
  type: string;
};

/**
 * Static / CDN: cache only verifiable successes (basic/cors, ok).
 * Opaque responses cannot be inspected — never treat as success.
 */
export function shouldCacheStaticResponse(res: ResponseLike): boolean {
  if (res.type === 'opaque' || res.type === 'error' || res.type === 'opaqueredirect') {
    return false;
  }
  if (res.type !== 'basic' && res.type !== 'cors' && res.type !== 'default') {
    return false;
  }
  return res.ok === true && res.status >= 200 && res.status < 300;
}

/**
 * API: only cache same-origin basic HTTP 200 (not 204/206/opaque/errors).
 */
export function shouldCacheApiResponse(res: ResponseLike): boolean {
  if (res.type === 'opaque' || res.type === 'error' || res.type === 'opaqueredirect') {
    return false;
  }
  // API is same-origin; prefer basic. `default` can appear in some test/polyfill envs.
  if (res.type !== 'basic' && res.type !== 'default') return false;
  return res.status === 200;
}

/** Offline API body used when network fails and cache miss. */
export const OFFLINE_API_JSON = JSON.stringify({
  status: 'error',
  code: 'OFFLINE',
  message: 'No network and no cached response.',
});
