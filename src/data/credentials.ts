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
 * In-memory exchange credential vault.
 *
 * Secrets MUST NEVER appear in `store.persist()`, `pluginsConfig`, error-share,
 * or CHANGELOG dumps. {@link listCredentialMeta} returns flags only.
 *
 * v1 is process-memory only ({@link CREDENTIALS_MEMORY_ONLY}). Tauri keychain /
 * AES-GCM durable wrap is Phase 1.5 — do not write plaintext secrets to
 * localStorage.
 *
 * @module data/credentials
 */

import type { ProviderVenue } from './provider';
import { resolveProviderVenue, venueFromPluginId } from './provider';
import { getDataManagerSelection } from './data-manager-source';
import { applyProviderVaultAuth, store } from '../store';

/** True: vault is RAM-only. Phase 1.5: Tauri keychain / AES-GCM wrap. */
export const CREDENTIALS_MEMORY_ONLY = true;

export type ExchangeCredential = {
  id: string; // stable, e.g. `venue:binance`
  venue: ProviderVenue;
  apiKey: string;
  secret: string;
  passphrase?: string; // OKX / Coinbase
  label?: string;
};

export type CredentialMeta = {
  id: string;
  venue: ProviderVenue;
  label?: string;
  hasKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
};

const vault = new Map<string, ExchangeCredential>();
/** One credential per venue (v1). Maps venue → credential id. */
const byVenue = new Map<ProviderVenue, string>();
const listeners = new Set<() => void>();

const SECRET_KEY_RE =
  /^(api[_-]?key|secret|api[_-]?secret|passphrase|password|passwd|token|access[_-]?token|refresh[_-]?token)$/i;

function defaultId(venue: ProviderVenue): string {
  return `venue:${venue}`;
}

function cloneCred(c: ExchangeCredential): ExchangeCredential {
  const out: ExchangeCredential = {
    id: c.id,
    venue: c.venue,
    apiKey: c.apiKey,
    secret: c.secret,
  };
  if (c.passphrase != null) out.passphrase = c.passphrase;
  if (c.label != null) out.label = c.label;
  return out;
}

function toMeta(c: ExchangeCredential): CredentialMeta {
  const meta: CredentialMeta = {
    id: c.id,
    venue: c.venue,
    hasKey: Boolean(c.apiKey),
    hasSecret: Boolean(c.secret),
    hasPassphrase: Boolean(c.passphrase),
  };
  if (c.label != null && c.label !== '') meta.label = c.label;
  return meta;
}

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      // Subscriber errors must not break the vault.
    }
  }
}

function venueMatchesStore(venue: ProviderVenue): boolean {
  try {
    if (store.provider?.venue === venue) return true;
    const sourceId = String(store.source || '');
    if (venueFromPluginId(sourceId) === venue) return true;
    const streamId = store.live?.streamId;
    const underlying =
      sourceId === 'data-manager' ? getDataManagerSelection()?.sourceId : undefined;
    return resolveProviderVenue(sourceId, streamId, { underlyingSourceId: underlying }) === venue;
  } catch {
    return false;
  }
}

function syncStoreOnPut(cred: ExchangeCredential): void {
  if (!venueMatchesStore(cred.venue)) return;
  applyProviderVaultAuth(cred.id, true);
}

function syncStoreOnDelete(id: string): void {
  try {
    if (store.provider?.credentialId !== id) return;
  } catch {
    return;
  }
  applyProviderVaultAuth(undefined, false);
}

export function putCredential(
  input: Omit<ExchangeCredential, 'id'> & { id?: string },
): ExchangeCredential {
  const venue = input.venue;
  const id = (typeof input.id === 'string' && input.id.trim()) || defaultId(venue);
  const prevId = byVenue.get(venue);
  if (prevId && prevId !== id) {
    vault.delete(prevId);
    syncStoreOnDelete(prevId);
  }
  const cred = cloneCred({
    id,
    venue,
    apiKey: input.apiKey,
    secret: input.secret,
    passphrase: input.passphrase,
    label: input.label,
  });
  vault.set(id, cred);
  byVenue.set(venue, id);
  syncStoreOnPut(cred);
  notify();
  return cloneCred(cred);
}

export function getCredential(id: string): ExchangeCredential | undefined {
  const c = vault.get(id);
  return c ? cloneCred(c) : undefined;
}

export function getCredentialForVenue(venue: ProviderVenue): ExchangeCredential | undefined {
  const id = byVenue.get(venue);
  return id ? getCredential(id) : undefined;
}

export function deleteCredential(id: string): boolean {
  const cred = vault.get(id);
  if (!cred) return false;
  vault.delete(id);
  if (byVenue.get(cred.venue) === id) byVenue.delete(cred.venue);
  syncStoreOnDelete(id);
  notify();
  return true;
}

export function listCredentialMeta(): CredentialMeta[] {
  return [...vault.values()].map(toMeta);
}

export function hasCredentialForVenue(venue: ProviderVenue): boolean {
  const id = byVenue.get(venue);
  return !!(id && vault.has(id));
}

export function clearCredentials(): void {
  const ids = [...vault.keys()];
  vault.clear();
  byVenue.clear();
  for (const id of ids) syncStoreOnDelete(id);
  notify();
}

export function subscribeCredentials(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Recursively replace secret-like keys (`apiKey`, `secret`, `passphrase`,
 * `password`, `token`, and common variants) with `'[redacted]'`.
 */
export function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_RE.test(key) ? '[redacted]' : redactSecrets(child);
  }
  return out;
}
