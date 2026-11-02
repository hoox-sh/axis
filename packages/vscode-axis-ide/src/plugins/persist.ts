// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persist installed plugin metadata under `globalState` key `axis.plugins.v1`.
 * Secrets are stripped — never written. Wiring binds {@link GlobalStateHelpers}
 * to `context.globalState`.
 */

import {
  EMPTY_PLUGINS_V1,
  PLUGINS_GLOBAL_STATE_KEY,
  PLUGIN_KINDS,
  type GlobalStateHelpers,
  type InstalledPluginMeta,
  type PluginKind,
} from './types';

/** Field names never allowed in persisted plugin JSON. */
const SECRET_FIELD_RE =
  /^(api[_-]?key|password|passwd|secret|token|bearer|authorization|auth|credential|private[_-]?key)$/i;

function isPluginKind(raw: unknown): raw is PluginKind {
  return typeof raw === 'string' && (PLUGIN_KINDS as readonly string[]).includes(raw);
}

function stripSecretsFromRecord(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_FIELD_RE.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripSecretsFromRecord(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Sanitize one unknown entry into metadata or null. */
export function sanitizeInstalledPluginMeta(
  raw: unknown,
): InstalledPluginMeta | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const cleaned = stripSecretsFromRecord(raw as Record<string, unknown>);
    const url = typeof cleaned.url === 'string' ? cleaned.url.trim() : '';
    const id = typeof cleaned.id === 'string' ? cleaned.id.trim() : '';
    const kindRaw =
      typeof cleaned.kind === 'string' ? cleaned.kind.trim() : '';
    if (!url || !id || !kindRaw) return null;
    const name =
      typeof cleaned.name === 'string' && cleaned.name.trim()
        ? cleaned.name.trim()
        : id;
    const description =
      cleaned.description != null ? String(cleaned.description) : undefined;
    const kind = isPluginKind(kindRaw) ? kindRaw : kindRaw;
    return { url, id, name, kind, description };
  } catch {
    return null;
  }
}

/** Parse unknown globalState value into a clean metadata array (never throws). */
export function parsePluginsV1(raw: unknown): InstalledPluginMeta[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: InstalledPluginMeta[] = [];
    for (const row of raw) {
      const meta = sanitizeInstalledPluginMeta(row);
      if (meta) out.push(meta);
    }
    return out;
  } catch {
    return [];
  }
}

/** Read `axis.plugins.v1` via helpers (never throws; empty on failure). */
export function readPluginsV1(
  helpers: GlobalStateHelpers,
): InstalledPluginMeta[] {
  try {
    const raw = helpers.get<unknown>(PLUGINS_GLOBAL_STATE_KEY);
    return parsePluginsV1(raw);
  } catch {
    return [...EMPTY_PLUGINS_V1];
  }
}

/**
 * Write metadata-only list to `axis.plugins.v1` (secrets stripped).
 * Never throws — returns false on store failure.
 */
export async function writePluginsV1(
  helpers: GlobalStateHelpers,
  list: readonly InstalledPluginMeta[],
): Promise<boolean> {
  try {
    const clean = parsePluginsV1(list);
    await Promise.resolve(helpers.update(PLUGINS_GLOBAL_STATE_KEY, clean));
    return true;
  } catch {
    return false;
  }
}

/** In-memory GlobalStateHelpers for unit tests. */
export function createMemoryGlobalState(
  initial?: Iterable<[string, unknown]>,
): GlobalStateHelpers & { readonly map: Map<string, unknown> } {
  const map = new Map<string, unknown>(initial);
  return {
    map,
    get<T>(key: string): T | undefined {
      return map.get(key) as T | undefined;
    },
    update(key: string, value: unknown): void {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
    },
  };
}
