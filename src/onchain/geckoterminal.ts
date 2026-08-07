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
 * GeckoTerminal public API helpers (DEX pool OHLCV + pool search).
 *
 * No API key required. Browser CORS against `api.geckoterminal.com` is often
 * blocked — prefer `baseUrl` from {@link resolveGeckoTerminalBaseUrl} (Worker
 * proxy at `/api/onchain/gecko` rewriting to `/api/v2`).
 *
 * Client paths under base (proxy or public):
 * - `{base}/networks/{net}/pools/{addr}/ohlcv/{tf}?aggregate=&limit=&currency=usd&before_timestamp=`
 * - `{base}/search/pools?query=`
 *
 * ## OHLCV pagination (walk-back)
 *
 * Gecko accepts at most {@link GECKO_OHLCV_MAX_LIMIT} candles per request
 * (`limit` ≤ 1000). Older history uses `before_timestamp` (unix **seconds**):
 * returned bars are **strictly before** that time.
 *
 * AXIS SourcePlugin walk-back (Data Source Manager) pages via `endTime` only —
 * mapped here to `before_timestamp`. Multi-page accumulation in a single
 * `fetchHistorical` call is intentionally not done; DSM walks page-by-page
 * with `endTime = oldestSeen - 1` until the target past date.
 *
 * @module onchain/geckoterminal
 */

import type { Bar } from '../store/types';

export const GECKOTERMINAL_PROVIDER_ID = 'geckoterminal';
export const GECKOTERMINAL_DEFAULT_BASE =
  'https://api.geckoterminal.com/api/v2';

/** Default candles when callers omit `limit`. */
const DEFAULT_OHLCV_LIMIT = 300;

/**
 * GeckoTerminal OHLCV hard max per request (`limit` query param).
 * DSM page size for `geckoterminal-ohlcv` matches this (see sources catalog).
 */
export const GECKO_OHLCV_MAX_LIMIT = 1000;

/** GeckoTerminal OHLCV timeframe + aggregate for a single request. */
export interface GeckoIntervalMap {
  timeframe: string;
  aggregate: number;
}

/** Pool hit from GeckoTerminal search. */
export interface GeckoPoolSearchHit {
  network: string;
  address: string;
  name: string;
  symbol?: string;
  priceUsd?: number;
}

/**
 * Map AXIS / common chain aliases to GeckoTerminal network ids.
 * Unknown ids are lowercased and returned as-is.
 */
export function mapAxisNetworkToGecko(network: string): string {
  const raw = String(network || '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  // Strip optional CAIP-2 style prefix eip155:1 etc. — keep last segment if known
  const bare = raw.includes(':') ? raw.split(':').pop() || raw : raw;

  switch (bare) {
    case 'eth':
    case 'ethereum':
    case '1':
      return 'eth';
    case 'bsc':
    case 'bnb':
    case 'binance':
    case 'binance-smart-chain':
    case '56':
      return 'bsc';
    case 'arbitrum':
    case 'arb':
    case 'arbitrum-one':
    case '42161':
      return 'arbitrum';
    case 'base':
    case '8453':
      return 'base';
    case 'polygon':
    case 'matic':
    case 'polygon_pos':
    case 'polygon-pos':
    case '137':
      return 'polygon_pos';
    case 'solana':
    case 'sol':
      return 'solana';
    default:
      return bare;
  }
}

/**
 * Map AXIS chart intervals to GeckoTerminal OHLCV timeframe + aggregate.
 *
 * Supported Gecko aggregates:
 * - minute: 1, 5, 15
 * - hour: 1, 4, 12
 * - day: 1
 *
 * Unknown / unsupported intervals fall back to 1h.
 */
export function mapAxisIntervalToGecko(interval: string): GeckoIntervalMap {
  const iv = String(interval || '')
    .trim()
    .toLowerCase();

  switch (iv) {
    case '1m':
    case '1min':
    case '1':
      return { timeframe: 'minute', aggregate: 1 };
    case '5m':
    case '5min':
    case '5':
      return { timeframe: 'minute', aggregate: 5 };
    case '15m':
    case '15min':
    case '15':
      return { timeframe: 'minute', aggregate: 15 };
    case '30m':
    case '30min':
      // Not a native Gecko minute aggregate — closest is 15m
      return { timeframe: 'minute', aggregate: 15 };
    case '1h':
    case '60m':
    case '60':
    case 'h':
      return { timeframe: 'hour', aggregate: 1 };
    case '4h':
    case '240m':
    case '240':
      return { timeframe: 'hour', aggregate: 4 };
    case '12h':
      return { timeframe: 'hour', aggregate: 12 };
    case '1d':
    case 'd':
    case 'day':
    case '1day':
      return { timeframe: 'day', aggregate: 1 };
    case '1w':
    case 'w':
    case '1week':
    case 'week':
      // Gecko has no weekly aggregate; daily candles are the finest day grain
      return { timeframe: 'day', aggregate: 1 };
    default: {
      // Parse patterns like "3m", "2h"
      const m = /^(\d+)\s*m(?:in(?:ute)?s?)?$/.exec(iv);
      if (m) {
        const n = Number(m[1]);
        if (n <= 1) return { timeframe: 'minute', aggregate: 1 };
        if (n <= 5) return { timeframe: 'minute', aggregate: 5 };
        return { timeframe: 'minute', aggregate: 15 };
      }
      const h = /^(\d+)\s*h(?:our)?s?$/.exec(iv);
      if (h) {
        const n = Number(h[1]);
        if (n <= 1) return { timeframe: 'hour', aggregate: 1 };
        if (n <= 4) return { timeframe: 'hour', aggregate: 4 };
        return { timeframe: 'hour', aggregate: 12 };
      }
      return { timeframe: 'hour', aggregate: 1 };
    }
  }
}

/**
 * Normalize a timestamp to unix **seconds**.
 * GeckoTerminal OHLCV may return seconds or milliseconds.
 */
function toUnixSeconds(ts: unknown): number | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Heuristic: values > ~year 2001 in ms
  if (n > 1e12) return Math.floor(n / 1000);
  if (n > 1e11) return Math.floor(n / 1000);
  return Math.floor(n);
}

function errMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'Unknown error';
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

function resolveBaseUrl(baseUrl?: string): string {
  const b = String(baseUrl || GECKOTERMINAL_DEFAULT_BASE)
    .trim()
    .replace(/\/+$/, '');
  return b || GECKOTERMINAL_DEFAULT_BASE;
}

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_OHLCV_LIMIT;
  }
  return Math.min(Math.floor(limit), GECKO_OHLCV_MAX_LIMIT);
}

/**
 * Parse GeckoTerminal `ohlcv_list` into sorted AXIS {@link Bar}s.
 *
 * Each row: `[timestamp, open, high, low, close, volume]` (ts sec or ms).
 * Accepts the raw list, or a JSON:API envelope with
 * `data.attributes.ohlcv_list`.
 */
export function parseGeckoOhlcvList(raw: unknown): Bar[] {
  let list: unknown = raw;

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const root = raw as Record<string, unknown>;
    const data = root.data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const attrs = (data as Record<string, unknown>).attributes;
      if (attrs && typeof attrs === 'object') {
        list = (attrs as Record<string, unknown>).ohlcv_list;
      }
    } else if (Array.isArray(root.ohlcv_list)) {
      list = root.ohlcv_list;
    } else if (
      root.attributes &&
      typeof root.attributes === 'object' &&
      Array.isArray((root.attributes as Record<string, unknown>).ohlcv_list)
    ) {
      list = (root.attributes as Record<string, unknown>).ohlcv_list;
    }
  }

  if (!Array.isArray(list)) return [];

  const out: Bar[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const time = toUnixSeconds(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = row.length > 5 ? Number(row[5]) : undefined;
    if (
      time == null ||
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }
    const bar: Bar = { time, open, high, low, close };
    if (volume != null && Number.isFinite(volume)) bar.volume = volume;
    out.push(bar);
  }

  out.sort((a, b) => a.time - b.time);
  if (out.length < 2) return out;

  // Dedup by time (last wins)
  const deduped: Bar[] = [];
  for (const b of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === b.time) {
      deduped[deduped.length - 1] = b;
    } else {
      deduped.push(b);
    }
  }
  return deduped;
}

/**
 * Resolve Gecko `before_timestamp` (unix seconds) from client opts.
 * Prefers `beforeTimestamp`, then SourcePlugin `endTime`. Accepts ms or sec.
 * Returns `null` when unset / invalid.
 */
export function resolveGeckoBeforeTimestamp(opts: {
  beforeTimestamp?: number;
  endTime?: number;
}): number | null {
  const raw =
    typeof opts.beforeTimestamp === 'number' &&
    Number.isFinite(opts.beforeTimestamp) &&
    opts.beforeTimestamp > 0
      ? opts.beforeTimestamp
      : typeof opts.endTime === 'number' &&
          Number.isFinite(opts.endTime) &&
          opts.endTime > 0
        ? opts.endTime
        : null;
  if (raw == null) return null;
  return toUnixSeconds(raw);
}

/**
 * Fetch one page of OHLCV candles for a DEX pool from GeckoTerminal.
 *
 * **Pagination:** pass `endTime` or `beforeTimestamp` (unix sec) to request
 * bars **strictly before** that instant (`before_timestamp` query). Max
 * {@link GECKO_OHLCV_MAX_LIMIT} bars per call — for deep history, the Data
 * Source Manager walks older pages by lowering `endTime` each round.
 *
 * `startTime` is accepted for SourceOpts parity but is **not** sent upstream
 * (Gecko OHLCV has no after/start cursor on the public API).
 *
 * @returns Bars sorted ascending by `time` (unix seconds).
 * @throws on missing params, HTTP failure, invalid JSON, or empty OHLCV
 */
export async function fetchGeckoPoolOhlcv(opts: {
  network: string;
  poolAddress: string;
  interval: string;
  /** Request size; clamped to {@link GECKO_OHLCV_MAX_LIMIT} (1000). */
  limit?: number;
  /** Unix seconds — Gecko `before_timestamp` for pagination (older bars). */
  beforeTimestamp?: number;
  /**
   * Alias used by SourcePlugin walk-back (`endTime` in SourceOpts).
   * Same meaning as {@link beforeTimestamp}: bars strictly before this time.
   */
  endTime?: number;
  /** Ignored by Gecko OHLCV (no start cursor); kept for SourceOpts shape. */
  startTime?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}): Promise<Bar[]> {
  const network = mapAxisNetworkToGecko(opts.network);
  const poolAddress = String(opts.poolAddress || '').trim();
  if (!network) {
    throw new Error('GeckoTerminal: network is required');
  }
  if (!poolAddress) {
    throw new Error('GeckoTerminal: poolAddress is required');
  }

  const { timeframe, aggregate } = mapAxisIntervalToGecko(opts.interval);
  const limit = clampLimit(opts.limit);
  const base = resolveBaseUrl(opts.baseUrl);
  void opts.startTime; // SourceOpts parity — not supported by Gecko OHLCV

  const params = new URLSearchParams();
  params.set('aggregate', String(aggregate));
  params.set('limit', String(limit));
  params.set('currency', 'usd');
  const before = resolveGeckoBeforeTimestamp(opts);
  if (before != null) {
    params.set('before_timestamp', String(before));
  }

  const url =
    `${base}/networks/${encodeURIComponent(network)}` +
    `/pools/${encodeURIComponent(poolAddress)}` +
    `/ohlcv/${encodeURIComponent(timeframe)}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: opts.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(
      `GeckoTerminal: network error fetching OHLCV for ${network}/${poolAddress}: ${errMessage(err)}. ` +
        'Browser CORS may block api.geckoterminal.com — try a Worker proxy via baseUrl.',
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = body ? ` — ${body.slice(0, 160)}` : '';
    throw new Error(
      `GeckoTerminal: HTTP ${res.status} for OHLCV ${network}/${poolAddress}${hint}`,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(
      `GeckoTerminal: invalid JSON for OHLCV ${network}/${poolAddress}: ${errMessage(err)}`,
    );
  }

  let bars = parseGeckoOhlcvList(json);
  // Enforce exclusive upper bound (Gecko before_timestamp semantics).
  if (before != null && bars.length) {
    bars = bars.filter((b) => b.time < before);
  }
  if (!bars.length) {
    throw new Error(
      `GeckoTerminal: empty OHLCV for ${network}/${poolAddress} ` +
        `(${timeframe} aggregate=${aggregate}, currency=usd` +
        (before != null ? `, before_timestamp=${before}` : '') +
        ')',
    );
  }
  // parseGeckoOhlcvList already sorts ascending; keep stable contract for callers
  return bars;
}

export type SearchGeckoPoolsOpts = {
  query?: string;
  network?: string;
  limit?: number;
  signal?: AbortSignal;
  baseUrl?: string;
};

/**
 * Search GeckoTerminal pools by keyword (token name, symbol, or address).
 *
 * Overloads:
 * - `searchGeckoPools({ query, network?, … })`
 * - `searchGeckoPools(query, { network?, … })` — SourcePlugin-friendly
 *
 * Uses `GET /search/pools?query=…&network=…`.
 */
export async function searchGeckoPools(
  queryOrOpts: string | SearchGeckoPoolsOpts,
  maybeOpts?: Omit<SearchGeckoPoolsOpts, 'query'>,
): Promise<GeckoPoolSearchHit[]> {
  const opts: SearchGeckoPoolsOpts =
    typeof queryOrOpts === 'string'
      ? { ...(maybeOpts || {}), query: queryOrOpts }
      : queryOrOpts && typeof queryOrOpts === 'object'
        ? queryOrOpts
        : {};

  const query = String(opts.query || '').trim();
  if (!query) return [];

  const max =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
      ? Math.min(Math.floor(opts.limit), 50)
      : 20;

  const base = resolveBaseUrl(opts.baseUrl);
  const params = new URLSearchParams();
  params.set('query', query);
  const net = opts.network ? mapAxisNetworkToGecko(opts.network) : '';
  if (net) params.set('network', net);

  const url = `${base}/search/pools?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      signal: opts.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(
      `GeckoTerminal: network error searching pools: ${errMessage(err)}. ` +
        'Browser CORS may block api.geckoterminal.com — try a Worker proxy via baseUrl.',
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const hint = body ? ` — ${body.slice(0, 160)}` : '';
    throw new Error(`GeckoTerminal: HTTP ${res.status} searching pools${hint}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(
      `GeckoTerminal: invalid JSON for pool search: ${errMessage(err)}`,
    );
  }

  return parseGeckoPoolSearch(json, max);
}

function parseGeckoPoolSearch(raw: unknown, limit: number): GeckoPoolSearchHit[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, unknown>;
  const data = root.data;
  if (!Array.isArray(data)) return [];

  const out: GeckoPoolSearchHit[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const attrs =
      rec.attributes && typeof rec.attributes === 'object'
        ? (rec.attributes as Record<string, unknown>)
        : rec;

    const address = String(
      attrs.address ?? attrs.pool_address ?? rec.id ?? '',
    ).trim();
    if (!address) continue;

    // Network from relationships.network.data.id or attributes
    let network = '';
    const rel = rec.relationships;
    if (rel && typeof rel === 'object') {
      const netRel = (rel as Record<string, unknown>).network;
      if (netRel && typeof netRel === 'object') {
        const netData = (netRel as Record<string, unknown>).data;
        if (netData && typeof netData === 'object') {
          network = String((netData as Record<string, unknown>).id || '').trim();
        }
      }
    }
    if (!network) {
      network = String(
        attrs.network ?? attrs.network_id ?? attrs.chain ?? '',
      ).trim();
    }
    network = mapAxisNetworkToGecko(network) || network;

    const name = String(
      attrs.name ?? attrs.pool_name ?? attrs.address ?? address,
    ).trim();

    const symbolRaw =
      attrs.symbol ??
      attrs.base_token_symbol ??
      attrs.token_symbol ??
      attrs.name;
    const symbol =
      typeof symbolRaw === 'string' && symbolRaw.trim()
        ? symbolRaw.trim()
        : undefined;

    const priceRaw =
      attrs.base_token_price_usd ??
      attrs.price_usd ??
      attrs.token_price_usd ??
      attrs.priceUsd;
    const priceNum = Number(priceRaw);
    const priceUsd = Number.isFinite(priceNum) ? priceNum : undefined;

    // id sometimes is "network_address"
    if (!network && typeof rec.id === 'string' && rec.id.includes('_')) {
      const idx = rec.id.indexOf('_');
      if (idx > 0) network = mapAxisNetworkToGecko(rec.id.slice(0, idx));
    }

    const hit: GeckoPoolSearchHit = {
      network: network || 'unknown',
      address,
      name: name || address,
    };
    if (symbol) hit.symbol = symbol;
    if (priceUsd != null) hit.priceUsd = priceUsd;
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
