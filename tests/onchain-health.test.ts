/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain proxy health probe + telemetry plane (`src/onchain/health.ts`).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { setStore, store } from '../src/store';
import {
  checkOnchainProxyHealth,
  refreshOnchainTelemetry,
  _resetOnchainHealthProbeState,
  ONCHAIN_HEALTH_PATH,
} from '../src/onchain/health';
import { DEFAULT_ONCHAIN_WORKER_BASE } from '../src/onchain/proxy';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';

let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  _resetOnchainHealthProbeState();
  // Pro API host — health must still hit DEFAULT_ONCHAIN_WORKER_BASE
  setStore('endpoint', 'https://axis.hoox.sh');
  setStore('telemetry', 'onchain', undefined as never);
  restoreFetch?.();
  restoreFetch = undefined;
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
  _resetOnchainHealthProbeState();
});

describe('checkOnchainProxyHealth', () => {
  it('fails when explicit endpoint override is empty', async () => {
    const r = await checkOnchainProxyHealth({ endpoint: '' });
    expect(r.ok).toBe(false);
    expect(r.providers).toEqual([]);
    expect(r.detail).toMatch(/Worker base|endpoint/i);
  });

  it('probes default AXIS Worker (not Pro API host)', async () => {
    restoreFetch = mockFetch((input) => {
      const url = String(input);
      expect(url).toBe(`${DEFAULT_ONCHAIN_WORKER_BASE}${ONCHAIN_HEALTH_PATH}`);
      expect(url).not.toContain('axis.hoox.sh');
      return jsonResponse({
        status: 'healthy',
        service: 'axis-onchain',
        providers: {
          defillama: { id: 'defillama' },
          geckoterminal: { id: 'geckoterminal' },
        },
      });
    });
    const r = await checkOnchainProxyHealth();
    expect(r.ok).toBe(true);
    expect(r.providers).toContain('defillama');
    expect(r.providers).toContain('geckoterminal');
    expect(r.detail).toMatch(/proxy/);
  });

  it('reports HTTP errors', async () => {
    restoreFetch = mockFetch(() => jsonResponse({ status: 'error' }, 502));
    const r = await checkOnchainProxyHealth();
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/502/);
  });
});

describe('refreshOnchainTelemetry', () => {
  it('sets telemetry.onchain open on success', async () => {
    restoreFetch = mockFetch(() =>
      jsonResponse({
        status: 'healthy',
        providers: { defillama: {}, geckoterminal: {} },
      }),
    );
    const r = await refreshOnchainTelemetry({ force: true });
    expect(r.ok).toBe(true);
    const plane = store.telemetry.onchain;
    expect(plane).toBeTruthy();
    expect(plane!.id).toBe('onchain-proxy');
    expect(plane!.state).toBe('open');
    expect(plane!.transport).toBe('rest');
    expect(plane!.error).toBeNull();
  });

  it('sets telemetry.onchain error on failure', async () => {
    restoreFetch = mockFetch(() => {
      throw new Error('network down');
    });
    const r = await refreshOnchainTelemetry({ force: true });
    expect(r.ok).toBe(false);
    const plane = store.telemetry.onchain;
    expect(plane?.state).toBe('error');
    expect(plane?.error).toMatch(/network down/i);
  });
});
