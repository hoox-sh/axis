/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSET_CACHE_CONTROL,
  connectSrcIsAllowlisted,
  CSP_CONNECT_SRC,
  CSP_VALUE,
  HTML_CACHE_CONTROL,
  HSTS_VALUE,
  PAGES_CSP_VALUE,
  PERMISSIONS_POLICY,
} from '../../src/hp/security-headers';

const root = join(import.meta.dir, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

/** Parse Cloudflare Pages `_headers` path blocks (incl. `! Header` detach). */
function parsePagesHeaders(source: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>();
  let path = '';
  let headers: Record<string, string> = {};
  const flush = () => {
    if (path) blocks.set(path, headers);
  };
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Detach form: "! Cache-Control" (no colon) — record presence for asserts.
    if (line.startsWith('! ')) {
      headers[`! ${line.slice(2).trim()}`] = '';
      continue;
    }
    if (!line.includes(':')) {
      flush();
      path = line;
      headers = {};
      continue;
    }
    const idx = line.indexOf(':');
    headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  flush();
  return blocks;
}

describe('Pages / nginx / Worker security + cache headers', () => {
  test('canonical tokens', () => {
    expect(ASSET_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
    expect(HTML_CACHE_CONTROL).toBe('public, max-age=0, must-revalidate');
    expect(HSTS_VALUE).toBe('max-age=15552000; includeSubDomains');
    expect(HSTS_VALUE.includes('preload')).toBe(false);
    expect(PERMISSIONS_POLICY).toContain('camera=()');
    expect(PERMISSIONS_POLICY).toContain('microphone=()');
    expect(PAGES_CSP_VALUE).toContain("'wasm-unsafe-eval'");
    expect(connectSrcIsAllowlisted(PAGES_CSP_VALUE)).toBe(true);
    expect(connectSrcIsAllowlisted(CSP_VALUE)).toBe(true);
    expect(connectSrcIsAllowlisted("connect-src 'self' https: wss:")).toBe(false);
  });

  test('public/_headers: HTML revalidates, hashed /assets/* immutable, HSTS, allowlisted connect-src', () => {
    const blocks = parsePagesHeaders(read('public/_headers'));
    const html = blocks.get('/*');
    const assets = blocks.get('/assets/*');
    expect(html, '/* block').toBeDefined();
    expect(assets, '/assets/* block').toBeDefined();

    expect(html?.['Cache-Control']).toBe(HTML_CACHE_CONTROL);
    expect(assets?.['Cache-Control']).toBe(ASSET_CACHE_CONTROL);
    // Pages joins every matching rule — /assets/* must detach Cache-Control
    // and must not re-declare security headers (live HSTS parse failures).
    expect(Object.prototype.hasOwnProperty.call(assets, '! Cache-Control')).toBe(true);
    expect(assets?.['Strict-Transport-Security']).toBeUndefined();
    expect(assets?.['Content-Security-Policy']).toBeUndefined();

    expect(html?.['Strict-Transport-Security']).toBe(HSTS_VALUE);
    expect(html?.['Permissions-Policy']).toBe(PERMISSIONS_POLICY);
    expect(html?.['Content-Security-Policy']).toBe(PAGES_CSP_VALUE);
    expect(connectSrcIsAllowlisted(html?.['Content-Security-Policy'] || '')).toBe(true);
    expect(html?.['Content-Security-Policy']).toContain("'wasm-unsafe-eval'");

    const file = read('public/_headers');
    expect(file).toContain('static.cloudflareinsights.com');
    expect(file).toContain('pages.dev vs custom-domain');
    expect(file.includes('preload')).toBe(false);
  });

  test('nginx, proxy, Tauri, and PWA servers lockstep the connect-src list and cache tokens', () => {
    const files = [
      'docker/nginx.conf',
      'docker/nginx.proxy.conf',
      'src-tauri/tauri.conf.json',
      'axis-pwa-server.ts',
      'axis_pwa_server.py',
    ];
    for (const rel of files) {
      const text = read(rel);
      if (rel.endsWith('.json') || rel.endsWith('.conf')) {
        expect(text.includes(CSP_CONNECT_SRC), rel).toBe(true);
        expect(connectSrcIsAllowlisted(text), rel).toBe(true);
        expect(text.includes("'wasm-unsafe-eval'"), rel).toBe(true);
      }
      expect(text.includes(ASSET_CACHE_CONTROL), `${rel} assets cache`).toBe(
        rel !== 'src-tauri/tauri.conf.json',
      );
    }
    expect(read('docker/nginx.conf')).toContain(HTML_CACHE_CONTROL);
    expect(read('docker/nginx.proxy.conf')).toContain(HTML_CACHE_CONTROL);
    expect(read('docker/nginx.conf')).toContain(HSTS_VALUE);
    expect(read('docker/nginx.proxy.conf')).toContain(HSTS_VALUE);
    expect(read('docker/nginx.conf')).toContain(PERMISSIONS_POLICY);
    expect(read('axis-pwa-server.ts')).toContain(HTML_CACHE_CONTROL);
    expect(read('axis_pwa_server.py')).toContain(HTML_CACHE_CONTROL);
  });

  test('Worker stamps the same HSTS value', () => {
    const http = read('worker/src/http.ts');
    const index = read('worker/src/index.ts');
    expect(http).toContain(HSTS_VALUE);
    expect(http).toContain('withSecurityHeaders');
    expect(index).toContain('withSecurityHeaders');
    expect(HSTS_VALUE.includes('preload')).toBe(false);
    expect(http).toContain("X-Content-Type-Options");
    expect(http).toContain('nosniff');
    expect(http).toContain('X-Frame-Options');
    expect(http).toContain('DENY');
    expect(http).toContain('Referrer-Policy');
    expect(http).toContain('strict-origin-when-cross-origin');
  });
});
