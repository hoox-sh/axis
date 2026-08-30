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
 * Resilient Binance public REST helpers for the AXIS PWA.
 *
 * Browser → venue is flaky (geo blocks, corporate firewalls, extensions).
 * Fetch order:
 * 0. Session vault key → signed REST (direct HMAC, then Worker `/signed/klines`)
 * 1. Explicit `baseUrl` override (source config)
 * 2. Direct public hosts (`api.binance.com`, then `data-api.binance.vision`)
 * 3. AXIS Worker allowlisted proxy (`/api/market/binance/…`)
 *
 * @module data/binance-http
 */

import { normalizeEndpointBase } from '../onchain/proxy';
import {
  DEFAULT_MARKET_WORKER_BASE,
  resolveMarketWorkerBase,
} from './market-worker';
import { fetchSignedJson, hasSignedCreds } from './signed-fetch';

export { DEFAULT_MARKET_WORKER_BASE, resolveMarketWorkerBase };

/** Public Binance REST hosts (CORS `*`). Vision first for some restricted networks. */
export const BINANCE_REST_HOSTS = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
] as const;

/** Live kline stream URL candidates (port 9443 is often firewalled). */
export function binanceKlineWsUrls(symbol: string, interval: string): string[] {
  const s = String(symbol || '').toLowerCase();
  const iv = String(interval || '1d');
  const path = `/ws/${s}@kline_${iv}`;
  return [
    `wss://stream.binance.com:9443${path}`,
    `wss://stream.binance.com:443${path}`,
    `wss://stream.binance.com${path}`,
    `wss://data-stream.binance.vision${path}`,
  ];
}

/** Combined ticker multiplex URL candidates. */
export function binanceTickerWsUrls(symbols: string[]): string[] {
  const streams = symbols
    .map((s) => `${String(s || '').toLowerCase()}@ticker`)
    .filter(Boolean)
    .join('/');
  if (!streams) return [];
  const path = `/stream?streams=${streams}`;
  return [
    `wss://stream.binance.com:9443${path}`,
    `wss://stream.binance.com:443${path}`,
    `wss://stream.binance.com${path}`,
    `wss://data-stream.binance.vision${path}`,
  ];
}

export type BinanceRestPath =
  | 'klines'
  | 'ticker/24hr'
  | 'exchangeInfo';

export interface BinanceFetchOpts {
  /** Path under `/api/v3/` (or proxy equivalent). */
  path: BinanceRestPath;
  /** Query string without leading `?`. */
  query?: string;
  /** Prefer this host first (source config `baseUrl`). */
  baseUrl?: string;
  /** Optional worker base override. */
  workerBase?: string;
  signal?: AbortSignal;
  /** Skip Worker proxy (tests / offline lab). Default false. */
  skipWorkerProxy?: boolean;
  /** Skip vault HMAC (tests). Default false. */
  skipSigned?: boolean;
}

function joinUrl(base: string, path: BinanceRestPath, query?: string): string {
  const b = base.replace(/\/+$/, '');
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${b}/api/v3/${path}${q}`;
}

function workerProxyUrl(
  workerBase: string,
  path: BinanceRestPath,
  query?: string,
): string {
  const b = workerBase.replace(/\/+$/, '');
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${b}/api/market/binance/${path}${q}`;
}

function queryToRecord(query?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  const q = query.startsWith('?') ? query.slice(1) : query;
  const params = new URLSearchParams(q);
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Fetch Binance JSON: signed (vault key) then public host + Worker proxy.
 * Throws the last error when every candidate fails.
 */
export async function fetchBinanceJson(
  opts: BinanceFetchOpts,
): Promise<unknown> {
  if (!opts.skipSigned && opts.path === 'klines' && hasSignedCreds('binance')) {
    try {
      return await fetchSignedJson({
        venue: 'binance',
        path: '/api/v3/klines',
        query: queryToRecord(opts.query),
        signal: opts.signal,
        skipWorkerProxy: opts.skipWorkerProxy,
        workerBase: opts.workerBase,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      // 401/403 stay thrown — bad keys must not silently mix public klines
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP 401|HTTP 403/.test(msg)) throw err;
    }
  }

  const bases: string[] = [];
  const preferred = normalizeEndpointBase(opts.baseUrl);
  if (preferred) bases.push(preferred);
  for (const h of BINANCE_REST_HOSTS) {
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
    `Binance network error (${errors.slice(0, 4).join(' · ') || 'unknown'})`,
  );
}
