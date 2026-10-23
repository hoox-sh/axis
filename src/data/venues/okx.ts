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
 * OKX v5 REST HMAC signer.
 *
 * Public candles (`/api/v5/market/candles`) do not require a signature.
 * {@link okxHeaders} still builds private GET headers for `/api/v5/account/…`.
 *
 * @module data/venues/okx
 */

import {
  absoluteUrl,
  buildQueryString,
  bytesToBase64,
  encodeUtf8,
  hmacDigest,
  pathWithQuery,
  resolveTimestampMs,
  type SignInput,
  type SignedRequest,
  type VenueInstrument,
  type VenueTicker,
} from './types';
import { okxInst, venueFetch } from './spot';

export const OKX_BASE = 'https://www.okx.com';

/** Public spot candles path (unsigned). */
export const OKX_CANDLES_PATH = '/api/v5/market/candles';

export interface OkxCreds {
  apiKey: string;
  secret: string;
  passphrase?: string;
  timestampMs?: number;
}

/**
 * OKX private REST headers.
 *
 * `path` is the official requestPath and must include the query string when
 * present (`/api/v5/account/balance?ccy=BTC`). `body` is `''` for GET.
 */
export async function okxHeaders(
  method: string,
  path: string,
  body: string,
  creds: OkxCreds,
): Promise<Record<string, string>> {
  const timestamp = new Date(resolveTimestampMs(creds)).toISOString();
  const prehash = `${timestamp}${method.toUpperCase()}${path}${body}`;
  const raw = await hmacDigest('SHA-256', encodeUtf8(creds.secret), encodeUtf8(prehash));
  return {
    'OK-ACCESS-KEY': creds.apiKey,
    'OK-ACCESS-SIGN': bytesToBase64(raw),
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': creds.passphrase ?? '',
  };
}

export async function signOkx(input: SignInput): Promise<SignedRequest> {
  const queryString = buildQueryString(input.query);
  const requestPath = pathWithQuery(input.path, queryString);
  const headers = await okxHeaders(input.method, requestPath, '', input);
  return {
    url: absoluteUrl(OKX_BASE, input.path, queryString),
    headers,
  };
}

/** Live SPOT instruments (`state === 'live'` only). */
export async function fetchOkxInstruments(): Promise<VenueInstrument[]> {
  const json = (await venueFetch(
    'https://www.okx.com/api/v5/public/instruments?instType=SPOT',
    'OKX',
  )) as {
    code?: string;
    data?: Array<{ baseCcy: string; quoteCcy: string; state: string }>;
  };
  if (json.code !== '0' || !Array.isArray(json.data)) {
    throw new Error('OKX instruments empty');
  }
  return json.data
    .filter((s) => s.state === 'live')
    .map((s) => ({ base: s.baseCcy, quote: s.quoteCcy }));
}

/**
 * Full SPOT ticker list mapped to the requested symbols.
 * Change = (last − open) / open × 100 using open24h or sodUtc0.
 */
export async function fetchOkxTickers(symbols: string[]): Promise<Record<string, VenueTicker>> {
  const body = (await venueFetch(
    'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    'okx',
  )) as {
    data?: Array<{ instId: string; last: string; sodUtc0?: string; open24h?: string }>;
  };
  const byId = new Map((body.data || []).map((t) => [t.instId, t]));
  const next: Record<string, VenueTicker> = {};
  for (const sym of symbols) {
    const t = byId.get(okxInst(sym));
    if (!t) continue;
    const last = parseFloat(t.last);
    const open = parseFloat(t.open24h || t.sodUtc0 || String(last));
    next[sym] = {
      price: last,
      change: open ? ((last - open) / open) * 100 : 0,
      open24h: Number.isFinite(open) ? open : undefined,
    };
  }
  return next;
}
