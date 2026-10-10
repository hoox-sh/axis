/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * WS-D vault + transport safety: session vault round-trip (D1), legacy bag
 * migration, persist sanitizer, and https enforcement for Bearer keys (D14).
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  putSecret,
  getSecret,
  hasSecret,
  forgetSecret,
  migratePlaintextSecrets,
  captureSecretsFromBags,
  sanitizePluginsConfigForPersist,
  getCloudApiKey,
  getGitToken,
  getAgentApiKey,
  CLOUD_API_KEY_SLOT,
  GIT_TOKEN_SLOT,
} from '../src/storage/vault';
import {
  resolveCloudConfig,
  writeStoredCloudConfig,
  isLocalhostEndpoint,
  isSecureCloudEndpoint,
  requireSecureCloudEndpoint,
} from '../src/storage/cloud-config';
import { setStore } from '../src/store';

beforeEach(() => {
  forgetSecret(CLOUD_API_KEY_SLOT);
  forgetSecret(GIT_TOKEN_SLOT);
  forgetSecret('agent.apiKey');
});

describe('session vault', () => {
  it('round-trips put/get/has/forget', () => {
    putSecret('wsd.slot', 's3cr3t');
    expect(getSecret('wsd.slot')).toBe('s3cr3t');
    expect(hasSecret('wsd.slot')).toBe(true);
    forgetSecret('wsd.slot');
    expect(getSecret('wsd.slot')).toBe('');
    expect(hasSecret('wsd.slot')).toBe(false);
  });

  it('putSecret with empty value clears the slot', () => {
    putSecret('wsd.slot', 'x');
    putSecret('wsd.slot', '   ');
    expect(hasSecret('wsd.slot')).toBe(false);
  });

  it('migrates plaintext bags into the vault', () => {
    const moved = migratePlaintextSecrets({
      'storage:cloud': { endpoint: 'https://w.example', apiKey: 'pn_abc' },
      'storage:git': { token: 'ghp_abc' },
      'component:pyne-agent': { apiKey: 'ag_abc' },
    });
    expect(moved).toContain(CLOUD_API_KEY_SLOT);
    expect(moved).toContain(GIT_TOKEN_SLOT);
    expect(getCloudApiKey({})).toBe('pn_abc');
    expect(getGitToken({})).toBe('ghp_abc');
    expect(getAgentApiKey({})).toBe('ag_abc');
  });

  it('captureSecretsFromBags vaults in-memory UI writes before persist strips them', () => {
    const bags = { 'storage:cloud': { endpoint: 'https://w.example', apiKey: 'pn_live' } };
    captureSecretsFromBags(bags);
    const clean = sanitizePluginsConfigForPersist(
      bags as Record<string, Record<string, unknown>>,
    );
    expect(clean['storage:cloud']?.endpoint).toBe('https://w.example');
    expect(clean['storage:cloud']).not.toHaveProperty('apiKey');
    expect(getSecret(CLOUD_API_KEY_SLOT)).toBe('pn_live');
  });

  it('sanitizer keeps non-secret keys and drops secret-like variants', () => {
    const clean = sanitizePluginsConfigForPersist({
      bag: {
        endpoint: 'https://w.example',
        exchange: 'bybit',
        apiKey: 'x',
        token: 'y',
        password: 'z',
        oauthClientId: 'public-id',
      },
    });
    expect(clean.bag.endpoint).toBe('https://w.example');
    expect(clean.bag.exchange).toBe('bybit');
    expect(clean.bag.oauthClientId).toBe('public-id');
    expect(clean.bag).not.toHaveProperty('apiKey');
    expect(clean.bag).not.toHaveProperty('token');
    expect(clean.bag).not.toHaveProperty('password');
  });
});

describe('cloud config vault routing', () => {
  it('writeStoredCloudConfig vaults the key and resolve serves it back', () => {
    writeStoredCloudConfig('https://worker.example', 'pn_roundtrip');
    expect(getSecret(CLOUD_API_KEY_SLOT)).toBe('pn_roundtrip');
    expect(resolveCloudConfig().apiKey).toBe('pn_roundtrip');
    setStore('pluginsConfig', 'storage:cloud', { endpoint: 'https://worker.example' });
    forgetSecret(CLOUD_API_KEY_SLOT);
  });
});

describe('D14 — https except localhost', () => {
  it('classifies loopback http as acceptable, remote http as not', () => {
    expect(isLocalhostEndpoint('http://127.0.0.1:8787')).toBe(true);
    expect(isLocalhostEndpoint('http://localhost:8787')).toBe(true);
    expect(isLocalhostEndpoint('https://worker.example')).toBe(false);
    expect(isSecureCloudEndpoint('https://worker.example')).toBe(true);
    expect(isSecureCloudEndpoint('http://127.0.0.1:8787')).toBe(true);
    expect(isSecureCloudEndpoint('http://worker.example')).toBe(false);
    expect(isSecureCloudEndpoint('http://192.168.1.10:8787')).toBe(false);
  });

  it('requireSecureCloudEndpoint throws for remote http', () => {
    expect(() => requireSecureCloudEndpoint('https://worker.example')).not.toThrow();
    expect(() => requireSecureCloudEndpoint('http://127.0.0.1:8787')).not.toThrow();
    expect(() => requireSecureCloudEndpoint('http://worker.example')).toThrow(/https/);
  });
});
