/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cloud storage config: never use the Pine engine URL, persist Worker
 * credentials, generate well-formed demo keys.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  coerceWorkerEndpoint,
  defaultCloudEndpoint,
  generateDemoApiKey,
  resolveCloudConfig,
  writeStoredCloudConfig,
} from '../src/storage/cloud-config';
import { DEFAULT_AXIS_WORKER_BASE } from '../src/data/worker-origin';
import { setStore, store } from '../src/store';

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  setStore('pluginsConfig', 'storage:cloud', { endpoint: '', apiKey: '' });
  setStore('endpoint', 'http://127.0.0.1:5002');
});

describe('cloud-config', () => {
  it('does not fall back to the Pine engine URL', () => {
    const cfg = resolveCloudConfig();
    expect(cfg.endpoint).not.toContain(':5002');
    expect(cfg.endpoint).toBe(defaultCloudEndpoint());
  });

  it('rejects engine-looking URLs', () => {
    expect(coerceWorkerEndpoint('http://127.0.0.1:5002')).toBe(defaultCloudEndpoint());
    expect(coerceWorkerEndpoint('http://host/api/run')).toBe(defaultCloudEndpoint());
  });

  it('keeps a real Worker URL', () => {
    expect(coerceWorkerEndpoint('https://pynescript-axis.cryptolinx.workers.dev')).toBe(
      'https://pynescript-axis.cryptolinx.workers.dev',
    );
    expect(coerceWorkerEndpoint('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
  });

  it('persists API key under storage:cloud', () => {
    const key = `pn_${'b'.repeat(48)}`;
    writeStoredCloudConfig('http://127.0.0.1:8787', key);
    const cfg = resolveCloudConfig();
    expect(cfg.apiKey).toBe(key);
    expect(cfg.endpoint).toBe('http://127.0.0.1:8787');
    expect(store.pluginsConfig['storage:cloud']?.apiKey).toBe(key);
  });

  it('generates a well-formed pn_ key', () => {
    const key = generateDemoApiKey();
    expect(key).toMatch(/^pn_[a-f0-9]{48}$/);
    expect(generateDemoApiKey()).not.toBe(key);
  });

  it('default endpoint is a Worker host, not the engine', () => {
    const d = defaultCloudEndpoint();
    expect(d === 'http://127.0.0.1:8787' || d === DEFAULT_AXIS_WORKER_BASE).toBe(true);
  });
});
