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
 * Resolve Worker on-chain proxy base URLs for dataset plugins.
 *
 * Default chart engine endpoint (`store.endpoint`) hosts AXIS Worker routes.
 * DefiLlama / GeckoTerminal browser CORS is unreliable — prefer:
 *
 *   `{endpoint}/api/onchain/llama`  →  Worker → `https://api.llama.fi`
 *   `{endpoint}/api/onchain/gecko`  →  Worker → `https://api.geckoterminal.com/api/v2`
 *
 * which preserves client paths (`/protocols`, `/networks/.../ohlcv/...`, etc.).
 *
 * @module onchain/proxy
 */

import { store } from '../store';
import { DEFILLAMA_DEFAULT_BASE } from './defillama';
import { GECKOTERMINAL_DEFAULT_BASE } from './geckoterminal';

/** Path prefix on the AXIS Worker for DefiLlama allowlisted proxy. */
export const ONCHAIN_LLAMA_PROXY_PATH = '/api/onchain/llama';

/** Path prefix on the AXIS Worker for GeckoTerminal allowlisted proxy. */
export const ONCHAIN_GECKO_PROXY_PATH = '/api/onchain/gecko';

/**
 * Normalize an origin/base URL (no trailing slash).
 * Returns empty string if unusable.
 */
export function normalizeEndpointBase(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Strip trailing slashes; also strip accidental /api/run suffix if pasted
  let base = s.replace(/\/+$/, '');
  base = base.replace(/\/api\/run\/?$/i, '');
  base = base.replace(/\/api\/?$/i, '');
  if (!/^https?:\/\//i.test(base)) return '';
  return base;
}

/**
 * Build DefiLlama fetch root.
 *
 * Priority:
 * 1. Explicit `config.baseUrl` (plugin settings or call-site)
 * 2. `{store.endpoint}/api/onchain/llama` when endpoint is http(s)
 * 3. Direct `https://api.llama.fi` (may fail CORS in browsers)
 */
export function resolveDefiLlamaBaseUrl(
  config?: Record<string, unknown> | null,
): string {
  const cfgBase =
    config && typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (cfgBase) {
    return cfgBase.replace(/\/+$/, '') || DEFILLAMA_DEFAULT_BASE;
  }

  let endpoint = '';
  try {
    endpoint = normalizeEndpointBase(store.endpoint);
  } catch {
    endpoint = '';
  }

  if (endpoint) {
    return `${endpoint}${ONCHAIN_LLAMA_PROXY_PATH}`;
  }

  return DEFILLAMA_DEFAULT_BASE;
}

/**
 * True when the resolved base points at the AXIS Worker llama proxy
 * (not the public llama.fi host).
 */
export function isWorkerLlamaProxy(baseUrl: string): boolean {
  const b = String(baseUrl || '').toLowerCase();
  return b.includes('/api/onchain/llama');
}

/**
 * Build GeckoTerminal fetch root (replaces `https://api.geckoterminal.com/api/v2`).
 *
 * Priority:
 * 1. Explicit `config.baseUrl` (plugin settings or call-site)
 * 2. `{store.endpoint}/api/onchain/gecko` when endpoint is http(s)
 * 3. Direct public API (may fail CORS in browsers)
 *
 * Client paths under the base:
 * - `/networks/{net}/pools/{addr}/ohlcv/{tf}?aggregate=&limit=`
 * - `/search/pools?query=`
 */
export function resolveGeckoTerminalBaseUrl(
  config?: Record<string, unknown> | null,
): string {
  const cfgBase =
    config && typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (cfgBase) {
    return cfgBase.replace(/\/+$/, '') || GECKOTERMINAL_DEFAULT_BASE;
  }

  let endpoint = '';
  try {
    endpoint = normalizeEndpointBase(store.endpoint);
  } catch {
    endpoint = '';
  }

  if (endpoint) {
    return `${endpoint}${ONCHAIN_GECKO_PROXY_PATH}`;
  }

  return GECKOTERMINAL_DEFAULT_BASE;
}

/**
 * True when the resolved base points at the AXIS Worker gecko proxy
 * (not the public geckoterminal host).
 */
export function isWorkerGeckoProxy(baseUrl: string): boolean {
  const b = String(baseUrl || '').toLowerCase();
  return b.includes('/api/onchain/gecko');
}
