/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * WS-D service-worker parity (D2/D4/D15/D18): the shipping classic worker
 * (`public/sw.js`) must mirror the unit-testable rules in
 * `src/sw/strategy.ts` — versions, caps, and routing decisions.
 */

import { describe, expect, it } from 'bun:test';
import {
  SW_VERSION,
  RUNTIME_CACHE_MAX_ENTRIES,
  PYODIDE_CACHE_MAX_ENTRIES,
  FETCH_RETRY_ATTEMPTS,
  FETCH_RETRY_TIMEOUT_MS,
  API_CACHE_ENABLED,
  shellCacheName,
  runtimeCacheName,
  pyodideCacheName,
  currentCacheNames,
  isApiPath,
  isVersionProbe,
  isPyodidePath,
  isImmutableStaticPath,
  staticStrategy,
  isNoStoreRequest,
  isNonCacheableResponse,
  shouldCacheApiResponse,
  shouldCacheStaticResponse,
} from '../src/sw/strategy';

const swSource = await Bun.file(
  new URL('../public/sw.js', import.meta.url),
).text();

function swConst(name: string): string | null {
  const m = swSource.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  return m?.[1]?.trim() ?? null;
}

describe('sw.js ↔ strategy.ts parity (D18)', () => {
  it('versions match', () => {
    expect(swConst('VERSION')).toBe(`'${SW_VERSION}'`);
  });

  it('caps and retry constants match', () => {
    expect(swConst('RUNTIME_CACHE_MAX_ENTRIES')).toBe(String(RUNTIME_CACHE_MAX_ENTRIES));
    expect(swConst('PYODIDE_CACHE_MAX_ENTRIES')).toBe(String(PYODIDE_CACHE_MAX_ENTRIES));
    expect(swConst('FETCH_RETRY_ATTEMPTS')).toBe(String(FETCH_RETRY_ATTEMPTS));
    expect(swConst('FETCH_RETRY_TIMEOUT_MS')).toBe(String(FETCH_RETRY_TIMEOUT_MS));
    expect(swConst('API_CACHE_ENABLED')).toBe(String(API_CACHE_ENABLED));
    expect(RUNTIME_CACHE_MAX_ENTRIES).toBe(96);
    expect(PYODIDE_CACHE_MAX_ENTRIES).toBe(32);
  });

  it('cache names agree and activate keeps the full current set', () => {
    expect(shellCacheName()).toContain(SW_VERSION);
    expect(runtimeCacheName()).toContain(SW_VERSION);
    expect(pyodideCacheName()).toContain(SW_VERSION);
    expect(currentCacheNames()).toHaveLength(3);
    // sw.js keep-set must include all three caches.
    expect(swSource).toContain('PYODIDE_CACHE');
    const keep = swSource.match(/const keep = new Set\(\[([^\]]+)\]\)/);
    expect(keep?.[1]).toContain('SHELL_CACHE');
    expect(keep?.[1]).toContain('RUNTIME_CACHE');
    expect(keep?.[1]).toContain('PYODIDE_CACHE');
  });

  it('both copies classify API + version probes identically', () => {
    expect(isApiPath('/api/scripts')).toBe(true);
    expect(isApiPath('/apis')).toBe(false);
    expect(isVersionProbe('/version.json')).toBe(true);
    expect(swSource).toContain('pathname === \'/api\' || pathname.startsWith(\'/api/\')');
  });

  it('D2 — API responses are never cached in either copy', () => {
    expect(API_CACHE_ENABLED).toBe(false);
    expect(shouldCacheApiResponse({ ok: true, status: 200, type: 'basic' })).toBe(false);
    expect(shouldCacheApiResponse({ ok: true, status: 200, type: 'default' })).toBe(false);
    // sw.js gates its (dead) write path on the flag and the helper.
    expect(swSource).toContain('API_CACHE_ENABLED');
    expect(swSource).toMatch(/function shouldCacheApiResponse\([\s\S]*?return false/);
  });

  it('D3 — install never auto-activates; only the banner message does', () => {
    const skips = swSource.match(/self\.skipWaiting\(\)/g) || [];
    // Exactly one call site: the SKIP_WAITING postMessage handler.
    expect(skips).toHaveLength(1);
    expect(swSource).toContain("event.data === 'SKIP_WAITING'");
    const installAt = swSource.indexOf("addEventListener('install'");
    const activateAt = swSource.indexOf("addEventListener('activate'");
    expect(installAt).toBeGreaterThanOrEqual(0);
    expect(activateAt).toBeGreaterThan(installAt);
    expect(swSource.slice(installAt, activateAt)).not.toContain('skipWaiting()');
  });

  it('D4 — immutable statics cache-first, unhashed network-first', () => {
    expect(isImmutableStaticPath('/assets/index-abc123.js')).toBe(true);
    expect(isImmutableStaticPath('/pyodide/v0.29.5/pyodide.js')).toBe(true);
    expect(isImmutableStaticPath('/vendor/hoox_pyne-0.4.2-py3-none-any.whl')).toBe(false);
    expect(isImmutableStaticPath('/plugins/my-plugin.js')).toBe(false);
    expect(staticStrategy('/assets/index-abc123.js')).toBe('cache-first');
    expect(staticStrategy('/pyodide/v0.29.5/pyodide.js')).toBe('cache-first');
    expect(staticStrategy('/vendor/x.whl')).toBe('network-first');
    expect(staticStrategy('/plugins/x.js')).toBe('network-first');
    // sw.js mirrors both helpers and branches on them.
    expect(swSource).toContain('isImmutableStaticPath');
    expect(swSource).toContain('isPyodidePath');
  });

  it('D15 — engine payloads route to their own cache + cap', () => {
    expect(isPyodidePath('/pyodide/v0.29.5/pyodide.js')).toBe(true);
    expect(isPyodidePath('/vendor/x.whl')).toBe(true);
    expect(isPyodidePath('/assets/index-abc.js')).toBe(false);
    expect(isPyodidePath('/api/scripts')).toBe(false);
    expect(swSource).toContain('PYODIDE_CACHE_MAX_ENTRIES');
  });

  it('no-store / private semantics exist in both copies', () => {
    expect(isNoStoreRequest({ cache: 'no-store' })).toBe(true);
    expect(isNoStoreRequest({ cacheControl: 'max-age=60, no-store' })).toBe(true);
    expect(isNoStoreRequest({})).toBe(false);
    expect(isNonCacheableResponse('private')).toBe(true);
    expect(isNonCacheableResponse('max-age=60, no-store')).toBe(true);
    expect(isNonCacheableResponse('max-age=3600')).toBe(false);
    expect(shouldCacheStaticResponse({ ok: true, status: 200, type: 'basic' })).toBe(true);
    expect(swSource).toContain('isNoStoreRequest');
    expect(swSource).toContain('isNonCacheableResponse');
  });
});
