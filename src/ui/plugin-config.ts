// Copyright (c) 2024-2026 jango_blockchained
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
 * Plugin `configSchema` helpers — defaults, bag writes, field resolve, gateway list.
 *
 * - {@link hasConfigFields} / {@link effectiveConfig} — schema-driven defaults
 * - {@link resolvePluginFieldValue} — stored override across source+stream, then default
 * - {@link fetchGatewayExchanges} — exchange ids from the datafeed gateway
 *   `/health` (`ccxt_exchanges` preferred, else `exchanges`), cached 60s per mode
 *
 * @module ui/plugin-config
 */

import type { ConfigSchema } from '../plugins/types';
import { pluginKey } from '../plugins/types';
import { setStore, store } from '../store';

export type GatewayMode = 'auto' | 'pyne' | 'sidecar';

/** A plugin that contributes config fields (source or stream). */
export interface ConfigTarget {
  kind: 'source' | 'stream';
  id: string;
  schema: ConfigSchema;
}

/** True when the plugin declares at least one config field. */
export function hasConfigFields(schema?: ConfigSchema): boolean {
  return !!schema && Object.keys(schema).length > 0;
}

/**
 * Write a single field into a plugin's `pluginsConfig` bag.
 *
 * `solid-js/store` does not auto-create intermediate nodes on deep paths, so
 * `setStore('pluginsConfig', key, field, v)` throws a TypeError when the
 * plugin's bag does not exist yet (first-ever config write). Create the bag
 * shallowly in that case.
 */
export function writePluginField(configKey: string, key: string, value: unknown): void {
  const bags = store.pluginsConfig || {};
  const bag = bags[configKey];
  if (!bag || typeof bag !== 'object') {
    setStore('pluginsConfig', configKey, { [key]: value });
  } else {
    setStore('pluginsConfig', configKey, key, value);
  }
}

/**
 * Merge schema defaults under stored user overrides.
 * Stored keys without a schema entry pass through (forward-compat).
 */
export function effectiveConfig(
  schema: ConfigSchema | undefined,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(schema || {})) {
    out[k] = f && 'default' in f ? f.default : undefined;
  }
  return { ...out, ...stored };
}

function bagOf(
  bags: Record<string, unknown> | undefined | null,
  target: ConfigTarget,
): Record<string, unknown> | undefined {
  const raw = bags?.[pluginKey(target.kind, target.id)];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as Record<string, unknown>;
}

/**
 * Effective value for a config field shared across source + stream.
 *
 * Walks every target bag for a **stored** key first (so a stream `exchange`
 * is not hidden by a source schema default of `''`), then the first schema
 * default, then `''`.
 */
export function resolvePluginFieldValue(
  bags: Record<string, unknown> | undefined | null,
  targets: readonly ConfigTarget[],
  key: string,
): unknown {
  for (const t of targets) {
    const bag = bagOf(bags, t);
    if (bag && Object.prototype.hasOwnProperty.call(bag, key)) return bag[key];
  }
  for (const t of targets) {
    const f = t.schema[key];
    if (f && 'default' in f && f.default !== undefined) return f.default;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Gateway exchange list
// ---------------------------------------------------------------------------

type CacheEntry = { ts: number; list: string[] };
const _cache = new Map<GatewayMode, CacheEntry>();
const EXCHANGES_TTL_MS = 60_000;

/** Test hook — clear the exchanges cache. */
export function _resetGatewayExchangeCache(): void {
  _cache.clear();
}

function pickStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((e) => String(e).trim()).filter(Boolean) : [];
}

/**
 * Exchange ids for the venue dropdown. Prefers the full ccxt list
 * (`GET /health` → `ccxt_exchanges`) and falls back to native `exchanges`.
 * Cached 60s **per gateway mode**. Throws on network/HTTP failure when that
 * mode has no stale list (callers render a free-text field).
 */
export async function fetchGatewayExchanges(
  mode: GatewayMode = 'auto',
  force = false,
): Promise<string[]> {
  const hit = _cache.get(mode);
  if (!force && hit && Date.now() - hit.ts < EXCHANGES_TTL_MS) return hit.list;
  try {
    const { gatewayFetch } = await import('../data/gateway');
    const res = await gatewayFetch(mode, '/health');
    if (!res.ok) throw new Error(`gateway health ${res.status}`);
    const json = (await res.json()) as { exchanges?: unknown; ccxt_exchanges?: unknown };
    const ccxt = pickStringList(json?.ccxt_exchanges);
    const list = ccxt.length ? ccxt : pickStringList(json?.exchanges);
    _cache.set(mode, { ts: Date.now(), list });
    return list;
  } catch (err) {
    if (hit?.list.length) return hit.list;
    throw err;
  }
}
