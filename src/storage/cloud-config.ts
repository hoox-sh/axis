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
 * Cloud (Worker) storage config — resolve, persist, and sanitize.
 *
 * The Pine **engine** URL (`store.endpoint`, typically `:5002`) is never used
 * as the scripts Worker base. That mix-up made cloud storage appear "broken"
 * whenever an engine host was configured.
 *
 * @module storage/cloud-config
 */

import { pluginKey } from '../plugins/types';
import { persist, setStore, store } from '../store';
import {
  DEFAULT_AXIS_WORKER_BASE,
  normalizeEndpointBase,
} from '../data/worker-origin';
import { getCloudApiKey, putSecret, forgetSecret, CLOUD_API_KEY_SLOT } from './vault';

/** Resolved Worker base URL + Bearer API key. */
export type CloudConfig = {
  endpoint: string;
  apiKey: string;
};

/** Pine engine ports / run path — never a scripts Worker. */
const ENGINE_URL_RE = /:(5002|5000)\b|\/api\/run/i;

/**
 * Default Worker URL for cloud script storage.
 * Localhost → wrangler `:8787`; otherwise the production workers.dev host.
 */
export function defaultCloudEndpoint(): string {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const host = String(window.location.hostname || '');
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return 'http://127.0.0.1:8787';
      }
    }
  } catch {
    /* SSR / tests without location */
  }
  return DEFAULT_AXIS_WORKER_BASE;
}

/**
 * Normalize a user-supplied Worker URL. Empty or engine-looking URLs
 * (`:5002`, `/api/run`) fall back to {@link defaultCloudEndpoint}.
 */
export function coerceWorkerEndpoint(raw: string | undefined | null): string {
  const n = normalizeEndpointBase(raw);
  if (!n) return defaultCloudEndpoint();
  if (ENGINE_URL_RE.test(n) || ENGINE_URL_RE.test(String(raw || ''))) {
    return defaultCloudEndpoint();
  }
  return n;
}

function storedCloudBag(): Record<string, unknown> {
  const pc = store.pluginsConfig || {};
  const bag =
    pc[pluginKey('storage', 'cloud')] || pc.cloud || pc['storage:cloud'] || {};
  return bag && typeof bag === 'object' ? (bag as Record<string, unknown>) : {};
}

/**
 * Resolve endpoint + API key from call-site config, then `pluginsConfig`.
 * Does **not** fall back to `store.endpoint` (that is the Pine engine).
 * The key is read from the session vault first ({@link getCloudApiKey});
 * legacy plaintext bags still resolve (and migrate into the vault).
 *
 * Keeps the original falsy-fallback chain (call-site → saved), with the
 * session vault consulted before the legacy persisted bag.
 */
export function resolveCloudConfig(config?: Record<string, unknown>): CloudConfig {
  const saved = storedCloudBag();
  const endpoint = coerceWorkerEndpoint(
    String(config?.endpoint || saved.endpoint || ''),
  );
  const fromCallSite = String(config?.apiKey || '').trim();
  const apiKey = fromCallSite || getCloudApiKey(store.pluginsConfig);
  return { endpoint, apiKey };
}

/**
 * Persist the Worker URL under `pluginsConfig['storage:cloud']` and keep the
 * Bearer key in the session vault only (never in the durable payload —
 * `buildPersistPayload` strips secret keys). The in-memory bag keeps a copy
 * for the running session so legacy `src/ui` forms keep working.
 */
export function writeStoredCloudConfig(endpoint: string, apiKey: string): void {
  const key = pluginKey('storage', 'cloud');
  const prev = storedCloudBag();
  const next: Record<string, unknown> = {
    ...prev,
    endpoint: coerceWorkerEndpoint(endpoint),
  };
  const trimmed = String(apiKey || '').trim();
  if (trimmed) {
    putSecret(CLOUD_API_KEY_SLOT, trimmed);
    // Session-compat copy for legacy readers; stripped on persist.
    next.apiKey = trimmed;
  } else {
    // Clearing the key must also drop the session vault copy — otherwise
    // resolveCloudConfig keeps returning the stale vault secret and live
    // surfaces (MCP bridge) stay attached with a user-deleted key.
    // NOTE: setStore *merges* bag objects, so `delete` cannot remove the
    // legacy apiKey copy — assign `undefined` (Solid drops such keys).
    forgetSecret(CLOUD_API_KEY_SLOT);
    next.apiKey = undefined;
  }
  setStore('pluginsConfig', key, next);
  persist();
}

/**
 * True for loopback hosts where cleartext http is acceptable (local dev).
 * Everything else must be https before a Bearer key is sent (D14).
 */
export function isLocalhostEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(String(endpoint || ''));
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    );
  } catch {
    return false;
  }
}

/** True when `endpoint` may carry a Bearer key (https, or http loopback). */
export function isSecureCloudEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(String(endpoint || ''));
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && isLocalhostEndpoint(endpoint);
  } catch {
    return false;
  }
}

/**
 * Throw when `endpoint` would send a Bearer key over cleartext http to a
 * non-loopback host. Call before any authenticated cloud fetch.
 */
export function requireSecureCloudEndpoint(endpoint: string): void {
  if (!isSecureCloudEndpoint(endpoint)) {
    throw new Error(
      'Cloud storage requires https (http is allowed only for localhost)',
    );
  }
}

/** Cryptographically random `pn_` + 48 hex key (Worker shape). */
export function generateDemoApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return (
    'pn_' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}
