/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained) (jango_blockchained)
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
 * 1. Cache names are `axis-shell-`, `axis-runtime-`, `axis-pyodide-` only.
 * 2. Activate deletes **old axis-** caches and never the current set.
 * 3. API (`/api/`) is network-only: responses are never written to cache
 *    (D2 — cached 200s ignored auth/session). A stale entry from an older SW
 *    may still serve an offline fallback, then 503 JSON.
 * 4. Never treat opaque / error responses as cacheable success.
 * 5. Non-GET is not handled by the SW (browser default).
 * 6. Same-origin static routing (D4): immutable paths (`/assets/` hashed
 *    bundles, `/pyodide/v<ver>/` versioned engine) are cache-first; everything
 *    else unhashed (plugins, `/vendor/` wheels, root files) is network-first
 *    with cache fallback so a stale SW never pins old code.
 * 7. Pyodide/vendor payloads live in their own cache with their own cap (D15)
 *    so big engine files cannot evict hashed app assets (and vice versa).
 * 8. Navigation is network-first with shell fallback (fresh HTML when online).
 * 9. Navigation never rejects `respondWith` — offline shell HTML if cache miss.
 * 10. Same-origin `/version.json` is bypass — the update probe must hit network.
 * 11. `no-store` requests skip the cache read; `private`/`no-store`
 *    responses are never stored.
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
export const SW_VERSION = 'v8';

export const CACHE_PREFIX = 'axis-';

/**
 * Soft cap on `axis-runtime-*` entries (hashed assets, CDN).
 * FIFO trim after put — prevents unbounded Cache Storage growth.
 * Mirrored in `public/sw.js` / root `sw.js`.
 */
export const RUNTIME_CACHE_MAX_ENTRIES = 96;

/**
 * Soft cap on `axis-pyodide-*` entries (engine + wheels). Separate from the
 * runtime cap (D15) so multi-MB engine payloads cannot evict app assets.
 * Mirrored in `public/sw.js`.
 */
export const PYODIDE_CACHE_MAX_ENTRIES = 32;

/**
 * API responses are never written to cache (D2). Kept as a named flag (not
 * a deleted code path) so the parity test can assert both copies agree.
 */
export const API_CACHE_ENABLED = false;

/** Uncached static/CDN fetch: retry thrown network errors this many times. Mirrored in `public/sw.js`. */
export const FETCH_RETRY_ATTEMPTS = 3;
/** Per-attempt AbortController timeout (ms) for uncached fetches. */
export const FETCH_RETRY_TIMEOUT_MS = 8000;

export function shellCacheName(version: string = SW_VERSION): string {
  return `${CACHE_PREFIX}shell-${version}`;
}

export function runtimeCacheName(version: string = SW_VERSION): string {
  return `${CACHE_PREFIX}runtime-${version}`;
}

export function pyodideCacheName(version: string = SW_VERSION): string {
  return `${CACHE_PREFIX}pyodide-${version}`;
}

/** Every cache the current SW owns (activate keeps exactly this set). */
export function currentCacheNames(version: string = SW_VERSION): string[] {
  return [shellCacheName(version), runtimeCacheName(version), pyodideCacheName(version)];
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

/** Deployed-version probe — must not be intercepted (query is not part of pathname). */
export function isVersionProbe(pathname: string): boolean {
  return pathname === '/version.json' || pathname.endsWith('/version.json');
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

  if (url.origin === swOrigin && isVersionProbe(url.pathname)) return 'bypass';

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
 * API: never cached (D2). Responses may carry auth/session context, so even
 * HTTP 200 basic entries must not be stored. The SW still serves a stale
 * entry written by an older worker as an offline fallback, then 503 JSON.
 */
export function shouldCacheApiResponse(_res: ResponseLike): boolean {
  return false;
}

/** True for same-origin engine/wheel payloads (own cache + cap, D15). */
export function isPyodidePath(pathname: string): boolean {
  return pathname === '/pyodide' || pathname.startsWith('/pyodide/') ||
    pathname === '/vendor' || pathname.startsWith('/vendor/');
}

/**
 * True for immutable same-origin statics: Vite hashed bundles and the
 * versioned pyodide engine (safe for cache-first, D4). Everything else
 * same-origin (plugins, unversioned wheels, root files) is network-first so
 * a stale SW never pins old code.
 */
export function isImmutableStaticPath(pathname: string): boolean {
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return true;
  return /^\/pyodide\/v[^/]+\//.test(pathname);
}

/** Cache-first for immutable statics, network-first otherwise (D4). */
export function staticStrategy(pathname: string): 'cache-first' | 'network-first' {
  return isImmutableStaticPath(pathname) ? 'cache-first' : 'network-first';
}

/**
 * True when a request opts out of the cache read (`Cache-Control: no-store`
 * or `cache: 'no-store'`). Mirrored in `public/sw.js` against real Requests.
 */
export function isNoStoreRequest(req: { cache?: string; cacheControl?: string | null }): boolean {
  if (req.cache === 'no-store') return true;
  const cc = String(req.cacheControl || '').toLowerCase();
  return cc.split(',').map((s) => s.trim()).includes('no-store');
}

/**
 * True when a response must not be stored (`Cache-Control: private` or
 * `no-store`). Mirrored in `public/sw.js` against real Responses.
 */
export function isNonCacheableResponse(cacheControl: string | null | undefined): boolean {
  const cc = String(cacheControl || '').toLowerCase();
  const parts = cc.split(',').map((s) => s.trim());
  return parts.includes('no-store') || parts.includes('private');
}

/** Offline API body used when network fails and cache miss. */
export const OFFLINE_API_JSON = JSON.stringify({
  status: 'error',
  code: 'OFFLINE',
  message: 'No network and no cached response.',
});
