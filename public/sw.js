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
 *   - Same-origin static    → cache-first (shell for precache paths, else runtime)
 *     includes /pyodide/* + /vendor/* for offline pyodide engine
 *   - CDN (esm.sh, jsdelivr, unpkg, cdnjs) → cache-first runtime
 *   - Same-origin /api/*    → network-first; cache only HTTP 200 basic;
 *     offline miss → 503 JSON (never cache opaque/errors as success)
 *   - Non-GET / other cross-origin → do not intercept
 *
 * Version bump (VERSION) when precache list or strategy semantics change.
 * Activate deletes old `axis-*` caches only; current shell/runtime kept.
 */

const VERSION = 'v5';
const CACHE_PREFIX = 'axis-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${VERSION}`;
/** Soft cap on runtime cache entries (hashed assets + pyodide + CDN). Keep in sync with src/sw/strategy.ts. */
const RUNTIME_CACHE_MAX_ENTRIES = 96;

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

/** Opaque / error must never be stored as a successful cache entry. */
function shouldCacheStaticResponse(res) {
    if (!res) return false;
    if (res.type === 'opaque' || res.type === 'error' || res.type === 'opaqueredirect') {
        return false;
    }
    if (res.type !== 'basic' && res.type !== 'cors' && res.type !== 'default') {
        return false;
    }
    return res.ok === true && res.status >= 200 && res.status < 300;
}

function shouldCacheApiResponse(res) {
    if (!res) return false;
    if (res.type === 'opaque' || res.type === 'error' || res.type === 'opaqueredirect') {
        return false;
    }
    if (res.type !== 'basic' && res.type !== 'default') return false;
    return res.status === 200;
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
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
        await Promise.all(
            names
                .filter((n) => n.startsWith(CACHE_PREFIX) && !keep.has(n))
                .map((n) => caches.delete(n)),
        );
        await self.clients.claim();
    })());
});

/** After put into runtime cache, drop oldest entries past the soft cap. */
async function trimRuntimeCache(cache) {
    try {
        const keys = await cache.keys();
        const drop = keys.length - RUNTIME_CACHE_MAX_ENTRIES;
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

async function putRuntime(cache, req, res) {
    await cache.put(req, res);
    await trimRuntimeCache(cache);
}

async function cacheFirst(req, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (shouldCacheStaticResponse(res)) {
        try {
            if (cacheName === RUNTIME_CACHE) {
                await putRuntime(cache, req, res.clone());
            } else {
                await cache.put(req, res.clone());
            }
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

async function networkFirstStatic(req, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const res = await fetch(req);
        if (shouldCacheStaticResponse(res)) {
            try {
                if (cacheName === RUNTIME_CACHE) {
                    await putRuntime(cache, req, res.clone());
                } else {
                    await cache.put(req, res.clone());
                }
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

async function networkFirstApi(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
        const res = await fetch(req);
        if (shouldCacheApiResponse(res)) {
            try {
                await putRuntime(cache, req, res.clone());
            } catch {
                /* ignore */
            }
        }
        // Return network result even when non-200 (do not mask API errors with stale).
        return res;
    } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
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
        event.respondWith(cacheFirst(req, RUNTIME_CACHE));
        return;
    }
    // same-origin static (JS/CSS/wasm/whl/py/icons/plugins/…)
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
});

// Allow the page to trigger an immediate skip-waiting via postMessage.
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
