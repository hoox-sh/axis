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
 * Resilient MEXC public REST helpers for the AXIS PWA.
 *
 * Browser → venue is flaky (geo blocks, corporate firewalls, extensions).
 * Fetch order:
 * 1. Explicit `baseUrl` override (source config)
 * 2. Direct public host (`https://api.mexc.com`)
 * 3. AXIS Worker allowlisted proxy (`/api/market/mexc/…`)
 *
 * MEXC does not currently support a signed HMAC path here (no
 * `X-MEXC-APIKEY` user-data endpoints consumed by AXIS today). When that
 * need arises, mirror `src/data/signed-fetch.ts`.
 *
 * @module data/mexc-http
 */

import { store } from '../store';
import {
  DEFAULT_ONCHAIN_WORKER_BASE,
  looksLikeOnchainWorkerEndpoint,
  normalizeEndpointBase,
} from '../onchain/proxy';

/** Public MEXC REST hosts (CORS `*`). Single canonical host. */
export const MEXC_REST_HOSTS = ['https://api.mexc.com'] as const;

/** Default production AXIS Worker (market + on-chain proxy). */
export const DEFAULT_MARKET_WORKER_BASE = DEFAULT_ONCHAIN_WORKER_BASE;

/**
 * Resolve Worker origin for market proxy (no trailing slash).
 * Same rules as on-chain: prefer configured Worker, else production default.
 */
export function resolveMarketWorkerBase(
  configWorkerBase?: string | null,
): string {
  const fromCfg = normalizeEndpointBase(configWorkerBase);
  if (fromCfg && looksLikeOnchainWorkerEndpoint(fromCfg)) return fromCfg;

  const fromStore = normalizeEndpointBase(store.endpoint);
  if (fromStore && looksLikeOnchainWorkerEndpoint(fromStore)) return fromStore;

  return DEFAULT_MARKET_WORKER_BASE;
}

export type MexcRestPath = 'klines' | 'ticker/24hr' | 'exchangeInfo';

export interface MexcFetchOpts {
  /** Path under `/api/v3/` (or proxy equivalent). */
  path: MexcRestPath;
  /** Query string without leading `?`. */
  query?: string;
  /** Prefer this host first (source config `baseUrl`). */
  baseUrl?: string;
  /** Optional worker base override. */
  workerBase?: string;
  signal?: AbortSignal;
  /** Skip Worker proxy (tests / offline lab). Default false. */
  skipWorkerProxy?: boolean;
}

function joinUrl(base: string, path: MexcRestPath, query?: string): string {
  const b = base.replace(/\/+$/, '');
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${b}/api/v3/${path}${q}`;
}

function workerProxyUrl(
  workerBase: string,
  path: MexcRestPath,
  query?: string,
): string {
  const b = workerBase.replace(/\/+$/, '');
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${b}/api/market/mexc/${path}${q}`;
}

/**
 * Fetch MEXC JSON: direct public host(s) then Worker proxy fallback.
 * Throws the last error when every candidate fails.
 */
export async function fetchMexcJson(opts: MexcFetchOpts): Promise<unknown> {
  const bases: string[] = [];
  const preferred = normalizeEndpointBase(opts.baseUrl);
  if (preferred) bases.push(preferred);
  for (const h of MEXC_REST_HOSTS) {
    if (!bases.includes(h)) bases.push(h);
  }

  const errors: string[] = [];
  for (const base of bases) {
    const url = joinUrl(base, opts.path, opts.query);
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: opts.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${base}: ${msg}`);
    }
  }

  if (!opts.skipWorkerProxy) {
    const worker = resolveMarketWorkerBase(opts.workerBase);
    const url = workerProxyUrl(worker, opts.path, opts.query);
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: opts.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        errors.push(`worker: HTTP ${res.status}`);
      } else {
        return await res.json();
      }
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`worker: ${msg}`);
    }
  }

  throw new Error(
    `MEXC network error (${errors.slice(0, 4).join(' · ') || 'unknown'})`,
  );
}
