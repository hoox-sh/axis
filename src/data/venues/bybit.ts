// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bybit v5 REST HMAC signer.
 *
 * `X-BAPI-SIGN` = HMAC-SHA256 hex of `timestamp + apiKey + recvWindow + queryString`.
 * `/v5/market/kline` is public; the signer is still implemented for private GET.
 *
 * @module data/venues/bybit
 */

import {
  DEFAULT_RECV_WINDOW,
  absoluteUrl,
  buildQueryString,
  bytesToHex,
  encodeUtf8,
  hmacDigest,
  resolveTimestampMs,
  type SignInput,
  type SignedRequest,
  type VenueInstrument,
  type VenueTicker,
} from './types';
import { toUsdt, venueFetch } from './spot';

/** Bybit v5 REST origin (`/v5/…`). */
export const BYBIT_BASE = 'https://api.bybit.com';

/** Public spot kline path. */
export const BYBIT_KLINE_PATH = '/v5/market/kline';

/**
 * Build a Bybit v5 signed GET: `X-BAPI-SIGN` is hex HMAC-SHA256 over
 * `timestamp + apiKey + recvWindow + queryString`, with `recvWindow` removed
 * from the query itself and sent as its own header.
 *
 * @param input - Path, query, and vault secrets; `timestampMs` overrides `Date.now()`.
 * @throws DOMException when Web Crypto cannot import the secret.
 */
export async function signBybit(input: SignInput): Promise<SignedRequest> {
  const timestamp = String(resolveTimestampMs(input));
  const recvWindow = String(input.query?.['recvWindow'] ?? DEFAULT_RECV_WINDOW);
  const query: Record<string, string | number | undefined> = { ...input.query };
  delete query['recvWindow'];
  const queryString = buildQueryString(query);
  const payload = `${timestamp}${input.apiKey}${recvWindow}${queryString}`;
  const raw = await hmacDigest('SHA-256', encodeUtf8(input.secret), encodeUtf8(payload));

  return {
    url: absoluteUrl(BYBIT_BASE, input.path, queryString),
    headers: {
      'X-BAPI-API-KEY': input.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': bytesToHex(raw),
      'X-BAPI-RECV-WINDOW': recvWindow,
    },
  };
}

/** Spot instruments with `status === 'Trading'` only. */
export async function fetchBybitInstruments(): Promise<VenueInstrument[]> {
  const json = (await venueFetch(
    'https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1000',
    'Bybit',
  )) as {
    retCode?: number;
    result?: {
      list?: Array<{ symbol: string; baseCoin: string; quoteCoin: string; status: string }>;
    };
  };
  if (json.retCode !== 0 || !Array.isArray(json.result?.list)) {
    throw new Error('Bybit instruments empty');
  }
  return json
    .result!.list!.filter((s) => s.status === 'Trading')
    .map((s) => ({
      base: s.baseCoin,
      quote: s.quoteCoin,
      symbol: s.symbol,
    }));
}

/**
 * Spot tickers mapped to the requested symbols.
 * `price24hPcnt` is a fraction (0.01 = 1%).
 */
export async function fetchBybitTickers(symbols: string[]): Promise<Record<string, VenueTicker>> {
  const body = (await venueFetch(
    'https://api.bybit.com/v5/market/tickers?category=spot',
    'bybit',
  )) as {
    result?: {
      list?: Array<{
        symbol: string;
        lastPrice: string;
        price24hPcnt: string;
        highPrice24h?: string;
        lowPrice24h?: string;
        volume24h?: string;
        turnover24h?: string;
      }>;
    };
  };
  const bySym = new Map((body.result?.list || []).map((t) => [t.symbol, t]));
  const next: Record<string, VenueTicker> = {};
  for (const sym of symbols) {
    const t = bySym.get(toUsdt(sym));
    if (!t) continue;
    const high = t.highPrice24h != null ? parseFloat(t.highPrice24h) : NaN;
    const low = t.lowPrice24h != null ? parseFloat(t.lowPrice24h) : NaN;
    const vol = t.volume24h != null ? parseFloat(t.volume24h) : NaN;
    const turnover = t.turnover24h != null ? parseFloat(t.turnover24h) : NaN;
    next[sym] = {
      price: parseFloat(t.lastPrice),
      change: parseFloat(t.price24hPcnt) * 100, // fraction → %
      high24h: Number.isFinite(high) ? high : undefined,
      low24h: Number.isFinite(low) ? low : undefined,
      volume24h: Number.isFinite(vol) ? vol : undefined,
      quoteVolume24h: Number.isFinite(turnover) ? turnover : undefined,
    };
  }
  return next;
}
