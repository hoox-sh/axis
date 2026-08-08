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
 * ## Prefer the AXIS Worker
 *
 * On-chain traffic should go through the Cloudflare Worker allowlisted proxy
 * (rate-limit friendly, single origin, works if public CORS ever tightens):
 *
 *   `{worker}/api/onchain/llama`  →  `https://api.llama.fi`
 *   `{worker}/api/onchain/gecko`  →  `https://api.geckoterminal.com/api/v2`
 *
 * **Do not** use the Pro API / SPA host (`axis.hoox.sh`, `:5002`) as the
 * on-chain base — those return HTML for `/api/onchain/*`.
 *
 * Resolution order:
 * 1. Plugin `config.baseUrl`
 * 2. `store.endpoint` when it is a Worker (workers.dev / :8787)
 * 3. Built-in default Worker {@link DEFAULT_ONCHAIN_WORKER_BASE}
 * 4. Direct public API (last resort)
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
 * Default production AXIS Worker (on-chain proxy + scripts/run when bound).
 * Keep in sync with `worker/wrangler.toml` name / workers.dev URL.
 */
export const DEFAULT_ONCHAIN_WORKER_BASE =
  'https://pynescript-axis.cryptolinx.workers.dev';

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

/**
 * Resolve the Worker origin used for on-chain proxy paths (no trailing slash).
 *
 * Priority:
 * 1. `config.workerBase` if set
 * 2. `store.endpoint` when it is a Worker
 * 3. {@link DEFAULT_ONCHAIN_WORKER_BASE}
 */
export function resolveOnchainWorkerBase(
  config?: Record<string, unknown> | null,
): string {
  const cfgWorker =
    config && typeof config.workerBase === 'string'
      ? config.workerBase.trim()
      : '';
  if (cfgWorker) {
    return normalizeEndpointBase(cfgWorker) || DEFAULT_ONCHAIN_WORKER_BASE;
  }

  let endpoint = '';
  try {
    endpoint = normalizeEndpointBase(store.endpoint);
  } catch {
    endpoint = '';
  }

  if (endpoint && looksLikeOnchainWorkerEndpoint(endpoint)) {
    return endpoint;
  }

  return DEFAULT_ONCHAIN_WORKER_BASE;
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

  // Prefer dedicated AXIS Worker for on-chain (not Pro API / SPA host).
  const worker = resolveOnchainWorkerBase(config);
  if (worker) {
    return `${worker}${path}`;
  }

  return publicFallback;
}

/**
 * Build DefiLlama fetch root.
 *
 * Priority:
 * 1. Explicit `config.baseUrl`
 * 2. AXIS Worker `/api/onchain/llama` (default production Worker)
 * 3. Direct `https://api.llama.fi` (only if Worker base empty)
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
 * 2. AXIS Worker `/api/onchain/gecko`
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
