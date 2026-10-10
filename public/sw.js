/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* AXIS — service worker (shipping classic SW; Vite copies public/ → dist/).
 *
 * Pure helpers mirrored in `src/sw/strategy.ts` (keep in sync).
 *
 * Strategy:
 *   - Navigation (HTML)     → network-first, shell cache fallback
 *   - Same-origin immutable static (`/assets/`, `/pyodide/v<ver>/`)
 *                           → cache-first (hashed/versioned; safe to pin)
 *   - Same-origin other static (plugins, unversioned wheels, root files)
 *                           → network-first with cache fallback (never pin
 *     old code); pyodide/vendor payloads live in their own cache + cap
 *   - CDN (esm.sh, jsdelivr, unpkg, cdnjs) → cache-first runtime
 *   - Same-origin /api/*    → network-only; NEVER write to cache (responses
 *     may carry auth/session context). A stale entry from an older SW may
 *     serve an offline fallback, else 503 JSON. `no-store` requests skip
 *     the cache read; `private`/`no-store` responses are never stored.
 *   - Same-origin /version.json → do not intercept (update poll must hit network)
 *   - Non-GET / other cross-origin → do not intercept
 *
 * Activation (skipWaiting) NEVER happens on install: the page opts in via
 * `SKIP_WAITING` postMessage only after the user consents through the update
 * banner, so a reload never lands mid-edit. Automatic reloads keep the
 * close guard enabled (see `src/pwa/register-sw.ts`).
 *
 * Version bump (VERSION) when precache list or strategy semantics change.
 * Activate deletes old `axis-*` caches only; current shell/runtime/pyodide kept.
 */

const VERSION = 'v8';
const CACHE_PREFIX = 'axis-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${VERSION}`;
const PYODIDE_CACHE = `${CACHE_PREFIX}pyodide-${VERSION}`;
/** Soft cap on runtime cache entries (hashed assets + CDN). Keep in sync with src/sw/strategy.ts. */
const RUNTIME_CACHE_MAX_ENTRIES = 96;
/** Soft cap on pyodide/vendor cache entries (own cap so engine files cannot evict app assets). Keep in sync. */
const PYODIDE_CACHE_MAX_ENTRIES = 32;
/** API responses are never written to cache (D2). Keep in sync with src/sw/strategy.ts. */
const API_CACHE_ENABLED = false;
/** Uncached static/CDN fetch retries. Keep in sync with src/sw/strategy.ts. */
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_TIMEOUT_MS = 8000;

/** Stable shell assets present in Vite dist and legacy root trees. */
const SHELL_ASSETS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/icon-maskable-512.png',
];

const CDN_HOST_RE =
    /(?:^|\.)(esm\.sh|jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)$/i;

function isCdnHost(host) {
    return CDN_HOST_RE.test(host);
}

function isApiPath(pathname) {
    return pathname === '/api' || pathname.startsWith('/api/');
}

function isVersionProbe(pathname) {
    return pathname === '/version.json' || pathname.endsWith('/version.json');
}

/** Same-origin engine/wheel payloads → own cache + cap (D15). Mirrors strategy.ts. */
function isPyodidePath(pathname) {
    return pathname === '/pyodide' || pathname.startsWith('/pyodide/') ||
        pathname === '/vendor' || pathname.startsWith('/vendor/');
}

/** Immutable statics (hashed bundles, versioned engine) → cache-first (D4). Mirrors strategy.ts. */
function isImmutableStaticPath(pathname) {
    if (pathname === '/assets' || pathname.startsWith('/assets/')) return true;
    return /^\/pyodide\/v[^/]+\//.test(pathname);
}

/** `no-store` requests skip the cache read. Mirrors strategy.ts. */
function isNoStoreRequest(req) {
    try {
        if (req.cache === 'no-store') return true;
        const cc = String(req.headers ? req.headers.get('Cache-Control') || '' : '').toLowerCase();
        return cc.split(',').map((s) => s.trim()).includes('no-store');
    } catch {
        return false;
    }
}

/** `private` / `no-store` responses are never stored. Mirrors strategy.ts. */
function isNonCacheableResponse(res) {
    try {
        const cc = String(res.headers ? res.headers.get('Cache-Control') || '' : '').toLowerCase();
        const parts = cc.split(',').map((s) => s.trim());
        return parts.includes('no-store') || parts.includes('private');
    } catch {
        return false;
    }
}

/** Opaque / error must never be stored as a successful cache entry. */
function shouldCacheStaticResponse(res) {
    if (!res) return false;
    if (res.type === 'opaque' || res.type === 'error' || res.type === 'opaqueredirect') {
        return false;
    }
    if (res.type !== 'basic' && res.type !== 'cors' && res.type !== 'default') {
        return false;
    }
    if (res.ok !== true || res.status < 200 || res.status >= 300) return false;
    return !isNonCacheableResponse(res);
}

/**
 * API responses are NEVER cached (D2) — see API_CACHE_ENABLED. Kept as a
 * function so the shape mirrors src/sw/strategy.ts for the parity test.
 */
function shouldCacheApiResponse(res) {
    void res;
    return false;
}

function offlineApiResponse() {
    return new Response(
        JSON.stringify({
            status: 'error',
            code: 'OFFLINE',
            message: 'No network and no cached response.',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        // Resilient precache: one missing asset must not fail the whole install.
        await Promise.all(
            SHELL_ASSETS.map(async (asset) => {
                try {
                    const req = new Request(asset, { cache: 'reload' });
                    const res = await fetch(req);
                    if (shouldCacheStaticResponse(res)) {
                        await cache.put(req, res);
                    }
                } catch {
                    /* ignore missing legacy/optional shell files */
                }
            }),
        );
        // D3: NO skipWaiting here. The new worker stays `waiting` until the
        // page opts in with a SKIP_WAITING postMessage after the user
        // consents through the update banner — a version bump never reloads
        // mid-edit on its own.
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, PYODIDE_CACHE]);
        await Promise.all(
            names
                .filter((n) => n.startsWith(CACHE_PREFIX) && !keep.has(n))
                .map((n) => caches.delete(n)),
        );
        await self.clients.claim();
    })());
});

/** After put into a capped cache, drop oldest entries past the soft cap. */
async function trimCache(cache, maxEntries) {
    try {
        const keys = await cache.keys();
        const drop = keys.length - maxEntries;
        if (drop <= 0) return;
        for (let i = 0; i < drop; i++) {
            try {
                await cache.delete(keys[i]);
            } catch {
                /* ignore */
            }
        }
    } catch {
        /* ignore */
    }
}

async function putCapped(cache, maxEntries, req, res) {
    await cache.put(req, res);
    await trimCache(cache, maxEntries);
}

/**
 * Retry thrown network errors (not HTTP 4xx). Clone each attempt so a
 * consumed body cannot poison later tries; abort hung sockets.
 */
async function fetchWithRetry(req, attempts = FETCH_RETRY_ATTEMPTS) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), FETCH_RETRY_TIMEOUT_MS);
        try {
            return await fetch(req.clone(), { signal: ac.signal });
        } catch (err) {
            lastErr = err;
        } finally {
            clearTimeout(timer);
        }
        if (i < attempts - 1) {
            await new Promise((r) => setTimeout(r, i === 0 ? 50 : 100));
        }
    }
    throw lastErr;
}

async function cacheFirst(req, cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) return cached;
    let res;
    try {
        res = await fetchWithRetry(req);
    } catch (err) {
        // Still offline/broken after retries — serve a raced cache hit if one
        // landed meanwhile, else let the browser report the failure.
        const raced = await cache.match(req);
        if (raced) return raced;
        throw err;
    }
    if (shouldCacheStaticResponse(res)) {
        try {
            await putCapped(cache, maxEntries, req, res.clone());
        } catch {
            /* quota / opaque clone edge */
        }
    }
    return res;
}

/** Minimal offline shell when network + cache both miss (never reject respondWith). */
function offlineShellResponse() {
    const html =
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
        '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
        '<title>AXIS offline</title>' +
        '<style>body{margin:0;font:15px/1.45 system-ui,sans-serif;background:#0a0b10;color:#e8eaed;' +
        'display:grid;place-items:center;min-height:100vh;padding:1.5rem;box-sizing:border-box}' +
        'main{max-width:28rem}a{color:#8ab4ff}</style></head><body><main>' +
        '<h1>AXIS is offline</h1>' +
        '<p>Network unavailable and no cached shell. Reconnect, then reload.</p>' +
        '<p><a href="./">Retry</a></p></main></body></html>';
    return new Response(html, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

async function networkFirstStatic(req, cacheName, maxEntries = Number.POSITIVE_INFINITY) {
    const cache = await caches.open(cacheName);
    try {
        const res = await fetch(req);
        if (shouldCacheStaticResponse(res)) {
            try {
                await putCapped(cache, maxEntries, req, res.clone());
            } catch {
                /* ignore */
            }
        }
        return res;
    } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        // index.html fallback for navigations
        const shell = await cache.match('./index.html') || await cache.match('./');
        if (shell) return shell;
        // Never reject respondWith — a thrown NetworkError surfaces as SW failure in the console
        return offlineShellResponse();
    }
}

/**
 * D2: network-only. Responses are never written (API_CACHE_ENABLED is false
 * and shouldCacheApiResponse() is false) because cached 200s ignored
 * auth/session context. A stale entry left by an older SW may still serve
 * an offline fallback; `no-store` requests skip even that read.
 */
async function networkFirstApi(req) {
    const noStore = isNoStoreRequest(req);
    const cache = noStore ? null : await caches.open(RUNTIME_CACHE);
    try {
        const res = await fetch(req);
        // Deliberately no cache write, even for HTTP 200.
        if (API_CACHE_ENABLED && res && shouldCacheApiResponse(res)) {
            try {
                await putCapped(cache, RUNTIME_CACHE_MAX_ENTRIES, req, res.clone());
            } catch {
                /* ignore */
            }
        }
        // Return network result even when non-200 (do not mask API errors with stale).
        return res;
    } catch {
        if (cache) {
            const cached = await cache.match(req);
            if (cached) return cached;
        }
        return offlineApiResponse();
    }
}

/**
 * @returns {'api'|'navigate'|'cdn'|'static'|null} null = do not intercept
 */
function classify(req, url) {
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return null;

    if (url.origin === self.location.origin && isApiPath(url.pathname)) return 'api';
    if (req.mode === 'navigate' || req.destination === 'document') return 'navigate';
    if (isCdnHost(url.host)) return 'cdn';
    if (url.origin === self.location.origin && isVersionProbe(url.pathname)) return null;
    if (url.origin === self.location.origin) return 'static';
    return null;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    let url;
    try {
        url = new URL(req.url);
    } catch {
        return;
    }

    const kind = classify(req, url);
    if (!kind) return; // non-GET or unhandled cross-origin — browser default

    if (kind === 'api') {
        event.respondWith(networkFirstApi(req));
        return;
    }
    if (kind === 'navigate') {
        event.respondWith(networkFirstStatic(req, SHELL_CACHE));
        return;
    }
    if (kind === 'cdn') {
        event.respondWith(cacheFirst(req, RUNTIME_CACHE, RUNTIME_CACHE_MAX_ENTRIES));
        return;
    }
    // Same-origin static (JS/CSS/wasm/whl/py/icons/plugins/…):
    // - engine/wheel payloads → own pyodide cache + cap (D15)
    // - immutable hashed/versioned paths → cache-first (D4)
    // - everything else unhashed → network-first so old code is never pinned
    const engine = isPyodidePath(url.pathname);
    const targetCache = engine ? PYODIDE_CACHE : RUNTIME_CACHE;
    const targetCap = engine ? PYODIDE_CACHE_MAX_ENTRIES : RUNTIME_CACHE_MAX_ENTRIES;
    if (isImmutableStaticPath(url.pathname)) {
        event.respondWith(cacheFirst(req, targetCache, targetCap));
    } else {
        event.respondWith(networkFirstStatic(req, targetCache, targetCap));
    }
});

// Allow the page to trigger an immediate skip-waiting via postMessage.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
