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
 * Durable secret vault for storage bearer keys (cloud Worker API key, git
 * PAT, agent key, engine API keys).
 *
 * Secrets MUST NEVER appear in the durable `localStorage` app-state payload
 * (`buildPersistPayload` strips them — that JSON is what workspace snapshots
 * and error-share walk). This vault keeps them in process memory, mirrors
 * them to `sessionStorage` for same-tab reloads, and to a dedicated
 * `localStorage` key so a new tab, PWA update, or browser restart still has
 * the Worker / engine keys. Exchange CEX keys stay in the RAM-only credentials
 * vault.
 *
 * Boot migration: blobs written before stripping still carry plaintext keys
 * under `pluginsConfig`. {@link migratePlaintextSecrets} moves them here and
 * reports which keys moved so callers can clear the in-memory copies after
 * the persisted payload has been re-written without them.
 *
 * `src/ui` settings forms keep reading/writing the in-memory store bags
 * (cross-workstream follow-up: WS-E should switch those forms to this vault);
 * resolvers below stay backward compatible by preferring the vault and
 * falling back to the legacy bag value.
 *
 * @module storage/vault
 */

import { engineFamilyForId } from '../plugins/engine-family';
import { createEmitter } from '../utils/emitter';
import { getJson, removeItem, setItem } from '../utils/storage';

/** Session-storage namespace (per-tab, cleared with the session). */
export const VAULT_SESSION_PREFIX = 'axis.session-secret.';
/** Dedicated durable bag — not the app-state `STORAGE_KEY` payload. */
export const VAULT_LOCAL_KEY = 'axis.secret-vault.v1';

const memory = new Map<string, string>();
const secretsEmitter = createEmitter<() => void>();

function notify(): void {
  secretsEmitter.emit();
}

function readSession(key: string): string | null {
  try {
    if (typeof sessionStorage === 'undefined' || sessionStorage == null) return null;
    return sessionStorage.getItem(VAULT_SESSION_PREFIX + key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    if (typeof sessionStorage === 'undefined' || sessionStorage == null) return;
    sessionStorage.setItem(VAULT_SESSION_PREFIX + key, value);
  } catch {
    /* private mode / quota — memory copy still works for this page */
  }
}

function clearSession(key: string): void {
  try {
    if (typeof sessionStorage === 'undefined' || sessionStorage == null) return;
    sessionStorage.removeItem(VAULT_SESSION_PREFIX + key);
  } catch {
    /* ignore */
  }
}

function readLocalVault(): Record<string, string> {
  const parsed = getJson<Record<string, unknown>>(VAULT_LOCAL_KEY);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof k === 'string' && k && typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
}

function writeLocalSlot(key: string, value: string | null): void {
  const bag = readLocalVault();
  if (value == null || !value.trim()) delete bag[key];
  else bag[key] = value;
  // Private mode / quota: memory + session still work for this page.
  if (Object.keys(bag).length === 0) removeItem(VAULT_LOCAL_KEY);
  else setItem(VAULT_LOCAL_KEY, JSON.stringify(bag));
}

function readLocalSlot(key: string): string {
  const v = readLocalVault()[key];
  return typeof v === 'string' ? v : '';
}

/** Subscribe to vault changes (settings forms). Returns an unsubscribe. */
export function subscribeSecrets(cb: () => void): () => void {
  return secretsEmitter.on(cb);
}

/** Store a secret (memory + session + durable local). Empty values clear the slot. */
export function putSecret(key: string, value: string): void {
  const id = String(key || '').trim();
  if (!id) return;
  const v = String(value ?? '');
  if (!v.trim()) {
    forgetSecret(id);
    return;
  }
  memory.set(id, v);
  writeSession(id, v);
  writeLocalSlot(id, v);
  notify();
}

/** Read a secret: memory, same-tab session, then durable local. */
export function getSecret(key: string): string {
  const id = String(key || '').trim();
  if (!id) return '';
  const mem = memory.get(id);
  if (typeof mem === 'string' && mem) return mem;
  const sess = readSession(id);
  if (sess) {
    memory.set(id, sess);
    writeLocalSlot(id, sess);
    return sess;
  }
  const local = readLocalSlot(id);
  if (local) {
    memory.set(id, local);
    writeSession(id, local);
    return local;
  }
  return '';
}

/** True when the vault holds a non-empty value for `key`. */
export function hasSecret(key: string): boolean {
  return getSecret(key) !== '';
}

/** Drop a secret from memory, session, and durable local. */
export function forgetSecret(key: string): void {
  const id = String(key || '').trim();
  if (!id) return;
  memory.delete(id);
  clearSession(id);
  writeLocalSlot(id, null);
  notify();
}

/** Test helper — clear memory only (session mirror untouched). */
export function _clearSecretMemoryForTests(): void {
  memory.clear();
}

// Well-known slots (dotted so future slots cannot collide with plugin ids).
/** Cloud Worker Bearer key (`pn_…`). */
export const CLOUD_API_KEY_SLOT = 'cloud.apiKey';
/** Git forge PAT / OAuth token. */
export const GIT_TOKEN_SLOT = 'git.token';
/** On-device agent component key. */
export const AGENT_API_KEY_SLOT = 'agent.apiKey';
/** Pro API key for the `server` engine (`pyn_…`). */
export const ENGINE_SERVER_API_KEY_SLOT = 'engine.server.apiKey';
/** API key for the `pyne-worker` engine. */
export const ENGINE_WORKER_API_KEY_SLOT = 'engine.pyne-worker.apiKey';

/** Bag locations for the `server` engine key. */
export const ENGINE_SERVER_KEY_BAGS = ['engine:server', 'server'];
/** Bag locations for the `pyne-worker` engine key. */
export const ENGINE_WORKER_KEY_BAGS = ['engine:pyne-worker', 'pyne-worker'];

/**
 * Secret-bearing `pluginsConfig` bag/key pairs, as `[bagKey, secretKey][]`.
 * `bagKey` accepts the canonical `scope:name` id and its legacy bare aliases.
 */
const KNOWN_SECRET_PATHS: Array<{ bags: string[]; key: string; slot: string }> = [
  {
    bags: ['storage:cloud', 'cloud', 'storage/cloud'],
    key: 'apiKey',
    slot: CLOUD_API_KEY_SLOT,
  },
  {
    bags: ['storage:git', 'git', 'storage/git'],
    key: 'token',
    slot: GIT_TOKEN_SLOT,
  },
  {
    bags: ['component:pyne-agent', 'pyne-agent'],
    key: 'apiKey',
    slot: AGENT_API_KEY_SLOT,
  },
  {
    bags: ENGINE_SERVER_KEY_BAGS,
    key: 'apiKey',
    slot: ENGINE_SERVER_API_KEY_SLOT,
  },
  {
    bags: ENGINE_WORKER_KEY_BAGS,
    key: 'apiKey',
    slot: ENGINE_WORKER_API_KEY_SLOT,
  },
];

function bagOf(pluginsConfig: unknown, bagKey: string): Record<string, unknown> | null {
  if (!pluginsConfig || typeof pluginsConfig !== 'object') return null;
  const bag = (pluginsConfig as Record<string, unknown>)[bagKey];
  return bag && typeof bag === 'object' && !Array.isArray(bag)
    ? (bag as Record<string, unknown>)
    : null;
}

/**
 * Move plaintext secrets found in a parsed `pluginsConfig` bag into the
 * session vault. Never throws. Returns the slots that were migrated.
 *
 * Callers keep the in-memory store values for the running session (legacy
 * `src/ui` forms read them) — only the *persisted* payload strips secrets.
 */
export function migratePlaintextSecrets(pluginsConfig: unknown): string[] {
  const moved: string[] = [];
  try {
    for (const { bags, key, slot } of KNOWN_SECRET_PATHS) {
      if (hasSecret(slot)) continue;
      for (const bagKey of bags) {
        const bag = bagOf(pluginsConfig, bagKey);
        const raw = bag?.[key];
        if (typeof raw === 'string' && raw.trim()) {
          putSecret(slot, raw.trim());
          moved.push(slot);
          break;
        }
      }
    }
  } catch {
    /* migration must never break boot */
  }
  return moved;
}

/**
 * Resolve a secret for `slot`, falling back to a legacy plaintext bag value
 * (migrating it into the vault on the way). Keeps pre-vault sessions and
 * `src/ui` forms working until WS-E switches them to {@link getSecret}.
 */
export function getVaultSecretWithLegacyFallback(
  slot: string,
  pluginsConfig: unknown,
  bags: string[],
  key: string,
): string {
  const direct = getSecret(slot);
  if (direct) return direct;
  try {
    for (const bagKey of bags) {
      const bag = bagOf(pluginsConfig, bagKey);
      const raw = bag?.[key];
      if (typeof raw === 'string' && raw.trim()) {
        putSecret(slot, raw.trim());
        return raw.trim();
      }
    }
  } catch {
    /* fall through */
  }
  return '';
}

/** Legacy bag locations for the cloud Worker API key. */
export const CLOUD_KEY_BAGS = ['storage:cloud', 'cloud', 'storage/cloud'];
/** Legacy bag locations for the git forge token. */
export const GIT_TOKEN_BAGS = ['storage:git', 'git', 'storage/git'];
/** Legacy bag locations for the on-device agent component key. */
export const AGENT_KEY_BAGS = ['component:pyne-agent', 'pyne-agent'];

/** Agent component key: vault first, legacy `pluginsConfig` bag fallback. */
export function getAgentApiKey(pluginsConfig: unknown): string {
  return getVaultSecretWithLegacyFallback(
    AGENT_API_KEY_SLOT,
    pluginsConfig,
    AGENT_KEY_BAGS,
    'apiKey',
  );
}

/**
 * Capture plaintext secrets currently sitting in in-memory `pluginsConfig`
 * bags (written by legacy `src/ui` forms straight into the store) into the
 * session vault. Called on every durable persist before
 * {@link sanitizePluginsConfigForPersist} strips them from the JSON payload,
 * so a reload (including a new tab / PWA update) keeps working without
 * writing secrets into the app-state JSON. Returns the slots that were (re)captured.
 */
export function captureSecretsFromBags(pluginsConfig: unknown): string[] {
  const captured: string[] = [];
  try {
    for (const { bags, key, slot } of KNOWN_SECRET_PATHS) {
      for (const bagKey of bags) {
        const bag = bagOf(pluginsConfig, bagKey);
        const raw = bag?.[key];
        if (typeof raw === 'string' && raw.trim()) {
          if (getSecret(slot) !== raw.trim()) putSecret(slot, raw.trim());
          captured.push(slot);
          break;
        }
      }
    }
  } catch {
    /* capture must never break persist */
  }
  return captured;
}

/** Cloud Worker API key: vault first, legacy `pluginsConfig` bag fallback. */
export function getCloudApiKey(pluginsConfig: unknown): string {
  return getVaultSecretWithLegacyFallback(
    CLOUD_API_KEY_SLOT,
    pluginsConfig,
    CLOUD_KEY_BAGS,
    'apiKey',
  );
}

/** Git forge token: vault first, legacy `pluginsConfig` bag fallback. */
export function getGitToken(pluginsConfig: unknown): string {
  return getVaultSecretWithLegacyFallback(GIT_TOKEN_SLOT, pluginsConfig, GIT_TOKEN_BAGS, 'token');
}

/**
 * Engine API key for `engineId`: vault first, `pluginsConfig` bag fallback.
 * The app-state payload strips every `apiKey`; the vault is the durable home.
 * Unknown engines keep the plain bag read.
 */
export function getEngineApiKey(pluginsConfig: unknown, engineId: string): string {
  const id = String(engineId || '').trim();
  // The exact family lookup decides the slot: an unknown engine id must not
  // be routed to the shared server or worker slot by accident.
  const family = engineFamilyForId(id);
  if (family === 'server') {
    return getVaultSecretWithLegacyFallback(
      ENGINE_SERVER_API_KEY_SLOT,
      pluginsConfig,
      ENGINE_SERVER_KEY_BAGS,
      'apiKey',
    );
  }
  if (family === 'worker') {
    return getVaultSecretWithLegacyFallback(
      ENGINE_WORKER_API_KEY_SLOT,
      pluginsConfig,
      ENGINE_WORKER_KEY_BAGS,
      'apiKey',
    );
  }
  const bag = bagOf(pluginsConfig, id) || bagOf(pluginsConfig, `engine:${id}`);
  const raw = bag?.apiKey;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Mirror an engine key into (or out of) the session vault. */
export function setEngineApiKey(engineId: string, value: string): void {
  const family = engineFamilyForId(String(engineId || '').trim());
  const slot =
    family === 'server'
      ? ENGINE_SERVER_API_KEY_SLOT
      : family === 'worker'
        ? ENGINE_WORKER_API_KEY_SLOT
        : '';
  if (!slot) return;
  const trimmed = String(value || '').trim();
  if (trimmed) putSecret(slot, trimmed);
  else forgetSecret(slot);
}

function isSecretKey(key: string): boolean {
  return /^(api[_-]?key|api[_-]?secret|secret|passphrase|password|passwd|token|access[_-]?token|refresh[_-]?token)$/i.test(
    key,
  );
}

/**
 * Strip secret-bearing keys from a `pluginsConfig` snapshot before durable
 * persistence. Non-secret keys (endpoints, exchanges, owners, repos) pass
 * through by reference-share of fresh shallow copies; the input is untouched.
 */
export function sanitizePluginsConfigForPersist(
  pluginsConfig: Record<string, Record<string, unknown>> | undefined | null,
): Record<string, Record<string, unknown>> {
  if (!pluginsConfig || typeof pluginsConfig !== 'object') return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [bagKey, bag] of Object.entries(pluginsConfig)) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
      if (isSecretKey(k)) continue;
      clean[k] = v;
    }
    out[bagKey] = clean;
  }
  return out;
}
