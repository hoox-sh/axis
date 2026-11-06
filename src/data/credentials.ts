// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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
import { createEmitter } from '../utils/emitter';

/** True: vault is RAM-only. Phase 1.5: Tauri keychain / AES-GCM wrap. */
export const CREDENTIALS_MEMORY_ONLY = true;

/**
 * One entry in the RAM-only credential vault. Never persisted — secrets stay in
 * this process and are cloned on every read so callers cannot mutate the vault.
 */
export type ExchangeCredential = {
  id: string; // `venue:binance` or `ccxt:bybit`
  venue: ProviderVenue;
  /** CCXT exchange id when {@link id} is `ccxt:<id>`. */
  exchange?: string;
  apiKey: string;
  secret: string;
  passphrase?: string; // OKX / Coinbase / CCXT `password`
  uid?: string;
  label?: string;
};

/**
 * Secret-free projection of a vault entry for UI lists: presence flags only, so
 * a settings panel can show "configured" without ever holding the key material.
 */
export type CredentialMeta = {
  id: string;
  venue: ProviderVenue;
  exchange?: string;
  label?: string;
  hasKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
  hasUid?: boolean;
};

/** Vault id for a CCXT gateway exchange (`bybit` → `ccxt:bybit`). */
export function ccxtCredentialId(exchange: string): string {
  return `ccxt:${String(exchange || '')
    .trim()
    .toLowerCase()}`;
}

/**
 * True when `id` names a CCXT-gateway entry (`ccxt:` prefix plus a non-empty
 * exchange). Such entries bypass the one-credential-per-venue rule.
 *
 * @param id - Vault id, e.g. `ccxt:bybit`.
 */
export function isCcxtCredentialId(id: string): boolean {
  return id.startsWith('ccxt:') && id.length > 5;
}

const vault = new Map<string, ExchangeCredential>();
/** One credential per venue (v1). Maps venue → credential id. */
const byVenue = new Map<ProviderVenue, string>();
const credentialsEmitter = createEmitter<() => void>();

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
  if (c.exchange != null) out.exchange = c.exchange;
  if (c.passphrase != null) out.passphrase = c.passphrase;
  if (c.uid != null) out.uid = c.uid;
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
  if (c.exchange) meta.exchange = c.exchange;
  if (c.label != null && c.label !== '') meta.label = c.label;
  if (c.uid) meta.hasUid = true;
  return meta;
}

function notify(): void {
  credentialsEmitter.emit();
}

/**
 * Exchange id configured on the CCXT source/stream plugin bag, lowercased.
 * Returns `''` when neither bag names one (or the store is unavailable) —
 * callers must treat empty as "no CCXT venue selected".
 */
export function activeCcxtExchange(): string {
  try {
    const bags = store.pluginsConfig || {};
    const src = bags['source:ccxt-rest'] as Record<string, unknown> | undefined;
    const stm = bags['stream:ccxt-ws'] as Record<string, unknown> | undefined;
    const ex = String(src?.['exchange'] || stm?.['exchange'] || '')
      .trim()
      .toLowerCase();
    return ex;
  } catch {
    return '';
  }
}

/**
 * Gateway configured for the CCXT plugins. Any value other than `pyne` or
 * `sidecar` — including a missing bag — collapses to `auto`.
 */
export function activeCcxtGateway(): 'auto' | 'pyne' | 'sidecar' {
  try {
    const bags = store.pluginsConfig || {};
    const src = bags['source:ccxt-rest'] as Record<string, unknown> | undefined;
    const stm = bags['stream:ccxt-ws'] as Record<string, unknown> | undefined;
    const g = String(src?.['gateway'] || stm?.['gateway'] || 'auto');
    return g === 'pyne' || g === 'sidecar' ? g : 'auto';
  } catch {
    return 'auto';
  }
}

function credMatchesStore(cred: ExchangeCredential): boolean {
  try {
    if (isCcxtCredentialId(cred.id)) {
      const sourceId = String(store.source || '');
      const streamId = String(store.live?.streamId || '');
      const onCcxt = sourceId === 'ccxt-rest' || streamId === 'ccxt-ws';
      return onCcxt && !!cred.exchange && cred.exchange === activeCcxtExchange();
    }
    const venue = cred.venue;
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
  if (!credMatchesStore(cred)) return;
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

/**
 * Store a credential in the RAM vault and return a clone of what was stored.
 * A non-CCXT id replaces the venue's previous entry (v1 keeps one per venue);
 * when the active chart provider is that venue, the store is flipped to
 * vault-auth and subscribers are notified. Secrets are never written to disk.
 *
 * @param input - Credential fields; `id` defaults to `venue:<venue>`.
 * @returns A clone, safe for the caller to keep.
 */
export function putCredential(
  input: Omit<ExchangeCredential, 'id'> & { id?: string },
): ExchangeCredential {
  const venue = input.venue;
  const id = (typeof input.id === 'string' && input.id.trim()) || defaultId(venue);
  if (!isCcxtCredentialId(id)) {
    const prevId = byVenue.get(venue);
    if (prevId && prevId !== id) {
      vault.delete(prevId);
      syncStoreOnDelete(prevId);
    }
    byVenue.set(venue, id);
  }
  const cred = cloneCred({
    id,
    venue,
    exchange: input.exchange,
    apiKey: input.apiKey,
    secret: input.secret,
    passphrase: input.passphrase,
    uid: input.uid,
    label: input.label,
  });
  vault.set(id, cred);
  syncStoreOnPut(cred);
  notify();
  return cloneCred(cred);
}

/**
 * Store a CCXT-gateway credential under `ccxt:<exchange>` with venue
 * `generic`, so several exchanges can be configured side by side.
 *
 * @param input - Exchange id plus secrets; the id is trimmed and lowercased.
 * @throws Error when the exchange id is empty.
 */
export function putCcxtCredential(input: {
  exchange: string;
  apiKey: string;
  secret: string;
  passphrase?: string;
  uid?: string;
  label?: string;
}): ExchangeCredential {
  const exchange = String(input.exchange || '')
    .trim()
    .toLowerCase();
  if (!exchange) throw new Error('CCXT exchange id is required');
  return putCredential({
    id: ccxtCredentialId(exchange),
    venue: 'generic',
    exchange,
    apiKey: input.apiKey,
    secret: input.secret,
    passphrase: input.passphrase,
    uid: input.uid,
    label: input.label || `CCXT ${exchange}`,
  });
}

/**
 * CCXT credential for `exchange` (case-insensitive), or `undefined` when none
 * is stored. The returned object is a clone.
 */
export function getCcxtCredential(exchange: string): ExchangeCredential | undefined {
  return getCredential(ccxtCredentialId(exchange));
}

/**
 * True when a CCXT credential exists for `exchange` **and** carries both an API
 * key and a secret — presence alone is not enough to sign a request.
 */
export function hasCcxtCredential(exchange: string): boolean {
  const c = getCcxtCredential(exchange);
  return !!(c && c.apiKey && c.secret);
}

/**
 * Clone of the vault entry for `id`, or `undefined` when the id is unknown.
 * Mutating the result cannot corrupt the vault.
 *
 * @param id - Vault id (`venue:<venue>` or `ccxt:<exchange>`).
 */
export function getCredential(id: string): ExchangeCredential | undefined {
  const c = vault.get(id);
  return c ? cloneCred(c) : undefined;
}

/**
 * Clone of the venue's current credential, or `undefined`. Only the venue index
 * is consulted — CCXT entries are reached through {@link getCcxtCredential}.
 */
export function getCredentialForVenue(venue: ProviderVenue): ExchangeCredential | undefined {
  const id = byVenue.get(venue);
  return id ? getCredential(id) : undefined;
}

/**
 * Drop a vault entry and clear the store's vault-auth flag if the chart was
 * using it. Notifies subscribers.
 *
 * @param id - Vault id to remove.
 * @returns `false` when the id was not present (nothing changed).
 */
export function deleteCredential(id: string): boolean {
  const cred = vault.get(id);
  if (!cred) return false;
  vault.delete(id);
  if (byVenue.get(cred.venue) === id) byVenue.delete(cred.venue);
  syncStoreOnDelete(id);
  notify();
  return true;
}

/**
 * Secret-free metadata for every stored credential — the only list form that is
 * safe to render or export. Flags show which fields are present, not their value.
 */
export function listCredentialMeta(): CredentialMeta[] {
  return [...vault.values()].map(toMeta);
}

/**
 * True when the venue index points at a vault entry. Says nothing about the
 * key/secret being non-empty — use {@link hasSignedCreds} for that.
 */
export function hasCredentialForVenue(venue: ProviderVenue): boolean {
  const id = byVenue.get(venue);
  return !!(id && vault.has(id));
}

/**
 * Wipe the whole vault and the venue index, clear any vault-auth flag on the
 * store, and notify subscribers. RAM only — there is no durable copy to erase.
 */
export function clearCredentials(): void {
  const ids = [...vault.keys()];
  vault.clear();
  byVenue.clear();
  for (const id of ids) syncStoreOnDelete(id);
  notify();
}

/**
 * Listen for vault mutations (put / delete / clear).
 *
 * @param cb - Called with no arguments after each change.
 * @returns Unsubscribe function.
 */
export function subscribeCredentials(cb: () => void): () => void {
  return credentialsEmitter.on(cb);
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
