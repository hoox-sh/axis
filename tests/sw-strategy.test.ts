/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Unit tests for pure SW strategy helpers (`src/sw/strategy.ts`).
 *
 * Manual checklist (DevTools → Application) after a production build:
 * - [ ] `/sw.js` is served from dist and registers once
 * - [ ] Version bump removes old `axis-*` caches; current shell/runtime remain
 * - [ ] Offline: shell + cached `/pyodide/*` + `/vendor/*` still work
 * - [ ] `/api/*` offline with no cache → 503 JSON OFFLINE
 * - [ ] Opaque / 4xx / 5xx responses are not stored as successful cache hits
 */

import { describe, expect, it } from 'bun:test';
import {
  SW_VERSION,
  CACHE_PREFIX,
  RUNTIME_CACHE_MAX_ENTRIES,
  runtimeCacheDropCount,
  shellCacheName,
  runtimeCacheName,
  isAxisCacheName,
  cachesToDelete,
  isCdnHost,
  isApiPath,
  classifyRequest,
  shouldCacheStaticResponse,
  shouldCacheApiResponse,
  OFFLINE_API_JSON,
} from '../src/sw/strategy';

describe('SW cache names', () => {
  it('uses axis-* shell and runtime names with version', () => {
    expect(shellCacheName()).toBe(`axis-shell-${SW_VERSION}`);
    expect(runtimeCacheName()).toBe(`axis-runtime-${SW_VERSION}`);
    expect(SW_VERSION).toBe('v5');
    expect(shellCacheName('v9')).toBe('axis-shell-v9');
    expect(isAxisCacheName(shellCacheName())).toBe(true);
    expect(isAxisCacheName('workbox-precache-v2')).toBe(false);
    expect(CACHE_PREFIX).toBe('axis-');
    expect(RUNTIME_CACHE_MAX_ENTRIES).toBeGreaterThan(0);
  });

  it('runtimeCacheDropCount trims only when over the soft cap', () => {
    expect(runtimeCacheDropCount(0)).toBe(0);
    expect(runtimeCacheDropCount(RUNTIME_CACHE_MAX_ENTRIES)).toBe(0);
    expect(runtimeCacheDropCount(RUNTIME_CACHE_MAX_ENTRIES + 5)).toBe(5);
    expect(runtimeCacheDropCount(10, 8)).toBe(2);
  });

  it('activate cleanup deletes old axis caches but not current or foreign', () => {
    const shell = shellCacheName('v5');
    const runtime = runtimeCacheName('v5');
    const existing = [
      shell,
      runtime,
      'axis-shell-v2',
      'axis-runtime-v2',
      'axis-shell-v3',
      'axis-runtime-v3',
      'axis-shell-v4',
      'axis-runtime-v4',
      'workbox-precache-v2',
      'other-app-cache',
    ];
    const doomed = cachesToDelete(existing, [shell, runtime]);
    expect(doomed.sort()).toEqual(
      [
        'axis-runtime-v2',
        'axis-shell-v2',
        'axis-runtime-v3',
        'axis-shell-v3',
        'axis-runtime-v4',
        'axis-shell-v4',
      ].sort(),
    );
    expect(doomed).not.toContain(shell);
    expect(doomed).not.toContain(runtime);
    expect(doomed).not.toContain('workbox-precache-v2');
  });

  it('does not delete current when only current exist', () => {
    const keep = [shellCacheName(), runtimeCacheName()];
    expect(cachesToDelete(keep, keep)).toEqual([]);
  });
});

describe('classifyRequest', () => {
  const origin = 'https://app.example';

  it('routes /api/* as api', () => {
    expect(
      classifyRequest(
        { origin, pathname: '/api/keys', host: 'app.example' },
        { method: 'GET' },
        origin,
      ),
    ).toBe('api');
    expect(
      classifyRequest(
        { origin, pathname: '/api', host: 'app.example' },
        { method: 'GET' },
        origin,
      ),
    ).toBe('api');
  });

  it('routes navigations network-first class', () => {
    expect(
      classifyRequest(
        { origin, pathname: '/', host: 'app.example' },
        { method: 'GET', mode: 'navigate' },
        origin,
      ),
    ).toBe('navigate');
    expect(
      classifyRequest(
        { origin, pathname: '/chart', host: 'app.example' },
        { method: 'GET', destination: 'document' },
        origin,
      ),
    ).toBe('navigate');
  });

  it('routes CDN hosts and same-origin static (pyodide/vendor)', () => {
    expect(
      classifyRequest(
        { origin: 'https://cdn.jsdelivr.net', pathname: '/npm/x', host: 'cdn.jsdelivr.net' },
        { method: 'GET' },
        origin,
      ),
    ).toBe('cdn');
    expect(
      classifyRequest(
        { origin, pathname: '/pyodide/v0.26.2/pyodide.js', host: 'app.example' },
        { method: 'GET' },
        origin,
      ),
    ).toBe('static');
    expect(
      classifyRequest(
        { origin, pathname: '/vendor/pynescript-0.4.0-py3-none-any.whl', host: 'app.example' },
        { method: 'GET' },
        origin,
      ),
    ).toBe('static');
  });

  it('bypasses non-GET and other cross-origin', () => {
    expect(
      classifyRequest(
        { origin, pathname: '/api/x', host: 'app.example' },
        { method: 'POST' },
        origin,
      ),
    ).toBe('bypass');
    expect(
      classifyRequest(
        { origin: 'https://other.test', pathname: '/x', host: 'other.test' },
        { method: 'GET' },
        origin,
      ),
    ).toBe('bypass');
  });

  it('isApiPath and isCdnHost helpers', () => {
    expect(isApiPath('/api/foo')).toBe(true);
    expect(isApiPath('/apis')).toBe(false);
    expect(isCdnHost('esm.sh')).toBe(true);
    expect(isCdnHost('cdn.jsdelivr.net')).toBe(true);
    expect(isCdnHost('evil.com')).toBe(false);
  });
});

describe('shouldCache*Response — no opaque-as-success', () => {
  it('rejects opaque / error for static and api', () => {
    const opaque = { ok: false, status: 0, type: 'opaque' };
    const err = { ok: false, status: 0, type: 'error' };
    expect(shouldCacheStaticResponse(opaque)).toBe(false);
    expect(shouldCacheApiResponse(opaque)).toBe(false);
    expect(shouldCacheStaticResponse(err)).toBe(false);
    expect(shouldCacheApiResponse(err)).toBe(false);
  });

  it('rejects 4xx/5xx for static and api', () => {
    expect(shouldCacheStaticResponse({ ok: false, status: 404, type: 'basic' })).toBe(false);
    expect(shouldCacheStaticResponse({ ok: false, status: 503, type: 'basic' })).toBe(false);
    expect(shouldCacheApiResponse({ ok: false, status: 500, type: 'basic' })).toBe(false);
    expect(shouldCacheApiResponse({ ok: true, status: 204, type: 'basic' })).toBe(false);
  });

  it('accepts 200 basic for api; 2xx basic/cors for static', () => {
    expect(shouldCacheApiResponse({ ok: true, status: 200, type: 'basic' })).toBe(true);
    expect(shouldCacheStaticResponse({ ok: true, status: 200, type: 'basic' })).toBe(true);
    expect(shouldCacheStaticResponse({ ok: true, status: 200, type: 'cors' })).toBe(true);
    // API must not cache cors/opaque from accidental cross-origin
    expect(shouldCacheApiResponse({ ok: true, status: 200, type: 'cors' })).toBe(false);
  });

  it('exports offline API JSON shape', () => {
    const body = JSON.parse(OFFLINE_API_JSON);
    expect(body.code).toBe('OFFLINE');
    expect(body.status).toBe('error');
  });
});
