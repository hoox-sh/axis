// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-memory exchange credential vault: meta never leaks secrets; persist omits them.
 */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  CREDENTIALS_MEMORY_ONLY,
  clearCredentials,
  deleteCredential,
  getCredential,
  getCredentialForVenue,
  hasCredentialForVenue,
  listCredentialMeta,
  putCredential,
  redactSecrets,
} from '../src/data/credentials';
import { flushPersist, parsePersistedState, STORAGE_KEY, store } from '../src/store';

const SECRET = 's3cr3t-NEVER-PERSIST-9f3a';
const API_KEY = 'ak_LIVE_never_dump';
const PASSPHRASE = 'okx-pass-do-not-leak';

beforeEach(() => {
  clearCredentials();
});

afterEach(() => {
  clearCredentials();
});

describe('put / get / list meta', () => {
  it('stores one credential per venue and lists meta without secrets', () => {
    expect(CREDENTIALS_MEMORY_ONLY).toBe(true);
    const cred = putCredential({
      venue: 'binance',
      apiKey: API_KEY,
      secret: SECRET,
      label: 'spot key',
    });
    expect(cred.id).toBe('venue:binance');
    expect(getCredential(cred.id)?.secret).toBe(SECRET);
    expect(getCredentialForVenue('binance')?.apiKey).toBe(API_KEY);
    expect(hasCredentialForVenue('binance')).toBe(true);

    const meta = listCredentialMeta();
    expect(meta).toHaveLength(1);
    expect(meta[0]).toEqual({
      id: 'venue:binance',
      venue: 'binance',
      label: 'spot key',
      hasKey: true,
      hasSecret: true,
      hasPassphrase: false,
    });
    expect(meta[0]).not.toHaveProperty('apiKey');
    expect(meta[0]).not.toHaveProperty('secret');
    expect(meta[0]).not.toHaveProperty('passphrase');
    expect(JSON.stringify(meta)).not.toContain(SECRET);
    expect(JSON.stringify(meta)).not.toContain(API_KEY);
  });

  it('JSON.stringify(listCredentialMeta()) does not contain the secret', () => {
    putCredential({
      venue: 'okx',
      apiKey: API_KEY,
      secret: SECRET,
      passphrase: PASSPHRASE,
    });
    const dumped = JSON.stringify(listCredentialMeta());
    expect(dumped).not.toContain(SECRET);
    expect(dumped).not.toContain(API_KEY);
    expect(dumped).not.toContain(PASSPHRASE);
    expect(dumped).toContain('"hasPassphrase":true');
  });
});

describe('deleteCredential', () => {
  it('drops the entry', () => {
    const cred = putCredential({ venue: 'bybit', apiKey: API_KEY, secret: SECRET });
    expect(deleteCredential(cred.id)).toBe(true);
    expect(getCredential(cred.id)).toBeUndefined();
    expect(hasCredentialForVenue('bybit')).toBe(false);
    expect(listCredentialMeta()).toEqual([]);
    expect(deleteCredential(cred.id)).toBe(false);
  });
});

describe('redactSecrets', () => {
  it('strips apiKey, secret, passphrase, password, token', () => {
    const raw = {
      apiKey: API_KEY,
      secret: SECRET,
      passphrase: PASSPHRASE,
      password: 'hunter2',
      token: 'tok_live',
      keep: 'ok',
      nested: { api_key: 'nested-key', token: 'inner', label: 'x' },
    };
    const redacted = redactSecrets(raw) as Record<string, unknown>;
    expect(redacted.apiKey).toBe('[redacted]');
    expect(redacted.secret).toBe('[redacted]');
    expect(redacted.passphrase).toBe('[redacted]');
    expect(redacted.password).toBe('[redacted]');
    expect(redacted.token).toBe('[redacted]');
    expect(redacted.keep).toBe('ok');
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.api_key).toBe('[redacted]');
    expect(nested.token).toBe('[redacted]');
    expect(nested.label).toBe('x');
    const json = JSON.stringify(redacted);
    expect(json).not.toContain(API_KEY);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(PASSPHRASE);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('tok_live');
  });
});

describe('store handle (no secret persist)', () => {
  it('sets authMode + credentialId on the matching venue; persist omits secrets', () => {
    expect(store.provider.venue).toBe('binance');
    const cred = putCredential({ venue: 'binance', apiKey: API_KEY, secret: SECRET });
    expect(store.provider.authMode).toBe('authenticated');
    expect(store.provider.credentialId).toBe(cred.id);

    flushPersist();
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(API_KEY);
    const parsed = parsePersistedState(raw);
    expect((parsed?.provider as { credentialId?: string } | undefined)?.credentialId).toBe(cred.id);
    expect((parsed?.provider as { secret?: string } | undefined)?.secret).toBeUndefined();
    expect((parsed?.pluginsConfig as Record<string, unknown> | undefined)?.apiKey).toBeUndefined();

    expect(deleteCredential(cred.id)).toBe(true);
    expect(store.provider.authMode).toBe('public');
    expect(store.provider.credentialId).toBeUndefined();
  });
});
