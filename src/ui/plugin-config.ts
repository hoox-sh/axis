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
 * Plugin `configSchema` helpers — pure logic behind the Topbar config row.
 *
 * - {@link hasConfigFields} / {@link effectiveConfig} — schema-driven defaults
 * - {@link fetchGatewayExchanges} — supported exchange ids from the datafeed
 *   gateway `/health` (`{ exchanges: [...] }`), cached 60s, `[]` on failure
 *
 * @module ui/plugin-config
 */

import type { ConfigSchema } from '../plugins/types';

/** True when the plugin declares at least one config field. */
export function hasConfigFields(schema?: ConfigSchema): boolean {
  return !!schema && Object.keys(schema).length > 0;
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

// ---------------------------------------------------------------------------
// Gateway exchange list
// ---------------------------------------------------------------------------

let _cache: { ts: number; list: string[] } | null = null;
const EXCHANGES_TTL_MS = 60_000;

/** Test hook — clear the exchanges cache. */
export function _resetGatewayExchangeCache(): void {
  _cache = null;
}

/**
 * Exchange ids for the gateway dropdown. Prefers the **full ccxt exchange
 * list** (`GET /health` → `ccxt_exchanges`, mirrors `ccxt.exchanges` — ccxt
 * unifies every supported venue) and falls back to the shorter native
 * `exchanges` list. Cached 60s; returns stale cache on network failure.
 */
export async function fetchGatewayExchanges(
  mode: 'auto' | 'pyne' | 'sidecar' = 'auto',
  force = false,
): Promise<string[]> {
  if (!force && _cache && Date.now() - _cache.ts < EXCHANGES_TTL_MS) return _cache.list;
  try {
    const { gatewayFetch } = await import('../data/gateway');
    const res = await gatewayFetch(mode, '/health');
    if (!res.ok) throw new Error(`gateway health ${res.status}`);
    const json = (await res.json()) as { exchanges?: unknown; ccxt_exchanges?: unknown };
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((e) => String(e).trim()).filter(Boolean) : [];
    // Full unified ccxt list wins; native adapters are a subset fallback.
    const list = pick(json?.ccxt_exchanges).length
      ? pick(json?.ccxt_exchanges)
      : pick(json?.exchanges);
    _cache = { ts: Date.now(), list };
    return list;
  } catch {
    return _cache?.list ?? [];
  }
}
