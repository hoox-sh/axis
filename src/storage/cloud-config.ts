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
 */
export function resolveCloudConfig(config?: Record<string, unknown>): CloudConfig {
  const saved = storedCloudBag();
  const endpoint = coerceWorkerEndpoint(
    String(config?.endpoint || saved.endpoint || ''),
  );
  const apiKey = String(config?.apiKey || saved.apiKey || '').trim();
  return { endpoint, apiKey };
}

/** Persist Worker URL + API key under `pluginsConfig['storage:cloud']`. */
export function writeStoredCloudConfig(endpoint: string, apiKey: string): void {
  const key = pluginKey('storage', 'cloud');
  const prev = storedCloudBag();
  setStore('pluginsConfig', key, {
    ...prev,
    endpoint: coerceWorkerEndpoint(endpoint),
    apiKey: String(apiKey || '').trim(),
  });
  persist();
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
