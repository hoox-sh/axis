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
 * ## When to use the Worker proxy
 *
 * Only when `store.endpoint` is an **AXIS Worker** (wrangler / workers.dev) that
 * actually serves `/api/onchain/*`. The default Pro API host (`axis.hoox.sh`,
 * `:5002`) is a Flask/nginx stack that returns **SPA HTML** for unknown paths —
 * using it as an on-chain base yields `invalid JSON` (`<!DOCTYPE html>`).
 *
 * DefiLlama and GeckoTerminal public APIs currently send
 * `Access-Control-Allow-Origin: *`, so **direct browser fetch is preferred**
 * unless a real Worker endpoint is configured.
 *
 * Worker path map (when applicable):
 *
 *   `{endpoint}/api/onchain/llama`  →  `https://api.llama.fi`
 *   `{endpoint}/api/onchain/gecko`  →  `https://api.geckoterminal.com/api/v2`
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
 * True when `endpoint` is likely an AXIS Cloudflare Worker that serves
 * `/api/onchain/*` — not a VPS Flask/nginx SPA host.
 *
 * Matches:
 * - `*.workers.dev`
 * - host containing `pynescript-axis`
 * - local wrangler (`localhost` / `127.0.0.1` on port **8787**)
 * - path already includes `/api/onchain`
 */
export function looksLikeOnchainWorkerEndpoint(
  endpoint: string | undefined | null,
): boolean {
  const raw = String(endpoint || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.includes('/api/onchain')) return true;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.workers.dev')) return true;
    if (host.includes('pynescript-axis')) return true;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (
      (host === 'localhost' || host === '127.0.0.1') &&
      port === '8787'
    ) {
      return true;
    }
  } catch {
    if (/\.workers\.dev/i.test(raw)) return true;
    if (/pynescript-axis/i.test(raw)) return true;
    if (/:8787\b/.test(raw) && /localhost|127\.0\.0\.1/i.test(raw)) return true;
  }
  return false;
}

function resolveWorkerProxyBase(
  path: string,
  publicFallback: string,
  config?: Record<string, unknown> | null,
): string {
  const cfgBase =
    config && typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (cfgBase) {
    return cfgBase.replace(/\/+$/, '') || publicFallback;
  }

  let endpoint = '';
  try {
    endpoint = normalizeEndpointBase(store.endpoint);
  } catch {
    endpoint = '';
  }

  // Only route through endpoint when it is a real AXIS Worker.
  // VPS / Pro API hosts (axis.hoox.sh, :5002) return SPA HTML for /api/onchain/*.
  if (endpoint && looksLikeOnchainWorkerEndpoint(endpoint)) {
    return `${endpoint}${path}`;
  }

  return publicFallback;
}

/**
 * Build DefiLlama fetch root.
 *
 * Priority:
 * 1. Explicit `config.baseUrl`
 * 2. `{store.endpoint}/api/onchain/llama` **only if** endpoint is a Worker
 * 3. Direct `https://api.llama.fi` (CORS `*` — works in browser)
 */
export function resolveDefiLlamaBaseUrl(
  config?: Record<string, unknown> | null,
): string {
  return resolveWorkerProxyBase(
    ONCHAIN_LLAMA_PROXY_PATH,
    DEFILLAMA_DEFAULT_BASE,
    config,
  );
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
 * 1. Explicit `config.baseUrl`
 * 2. Worker proxy only when endpoint looks like wrangler / workers.dev
 * 3. Direct public API
 */
export function resolveGeckoTerminalBaseUrl(
  config?: Record<string, unknown> | null,
): string {
  return resolveWorkerProxyBase(
    ONCHAIN_GECKO_PROXY_PATH,
    GECKOTERMINAL_DEFAULT_BASE,
    config,
  );
}

/**
 * True when the resolved base points at the AXIS Worker gecko proxy
 * (not the public geckoterminal host).
 */
export function isWorkerGeckoProxy(baseUrl: string): boolean {
  const b = String(baseUrl || '').toLowerCase();
  return b.includes('/api/onchain/gecko');
}
