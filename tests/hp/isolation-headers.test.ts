/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COEP_VALUE,
  COOP_VALUE,
  CORP_VALUE,
  HP_ISOLATION_HEADERS,
  sourceHasIsolationHeaders,
} from '../../src/hp/isolation-headers';
import { HP_ISOLATION_HEADERS as swIsolationHeaders } from '../../src/sw/strategy';

const root = join(import.meta.dir, '../..');

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('HP isolation headers lockstep', () => {
  test('canonical map is the isolating pair', () => {
    expect(HP_ISOLATION_HEADERS['Cross-Origin-Opener-Policy']).toBe(COOP_VALUE);
    expect(HP_ISOLATION_HEADERS['Cross-Origin-Embedder-Policy']).toBe(COEP_VALUE);
    expect(HP_ISOLATION_HEADERS['Cross-Origin-Resource-Policy']).toBe(CORP_VALUE);
    expect(COOP_VALUE).toBe('same-origin');
    expect(COEP_VALUE).toBe('credentialless');
    expect(CORP_VALUE).toBe('same-origin');
  });

  test('Pages _headers, nginx, Python server, and SW offline shell all carry the pair', () => {
    const files = [
      'public/_headers',
      'docker/nginx.conf',
      'docker/nginx.proxy.conf',
      'axis_pwa_server.py',
      'public/sw.js',
    ];
    for (const rel of files) {
      expect(sourceHasIsolationHeaders(read(rel)), rel).toBe(true);
    }
  });

  test('Vite and Bun servers import the canonical map', () => {
    expect(read('vite.config.ts')).toContain('HP_ISOLATION_HEADERS');
    expect(read('vite.config.ts')).toContain('server:');
    expect(read('vite.config.ts')).toContain('preview:');
    expect(read('axis-pwa-server.ts')).toContain('HP_ISOLATION_HEADERS');
  });

  test('SW strategy re-exports the same map the classic worker stamps', () => {
    expect(swIsolationHeaders).toEqual(HP_ISOLATION_HEADERS);
    expect(read('public/sw.js')).toContain("'Cross-Origin-Opener-Policy': 'same-origin'");
  });

  test('sourceHasIsolationHeaders rejects a file missing a value', () => {
    expect(sourceHasIsolationHeaders('Cross-Origin-Opener-Policy: same-origin')).toBe(false);
    expect(sourceHasIsolationHeaders('')).toBe(false);
  });
});
