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
 * Kraken REST HMAC signer.
 *
 * `API-Sign` = base64(HMAC-SHA512(urlpath + SHA256(nonce + postdata),
 * secret_decoded_from_base64)). GET OHLC is public; signer is still implemented.
 *
 * @module data/venues/kraken
 */

import {
  absoluteUrl,
  base64ToBytes,
  buildQueryString,
  bytesToBase64,
  concatBytes,
  encodeUtf8,
  hmacDigest,
  resolveTimestampMs,
  sha256,
  type SignInput,
  type SignedRequest,
  type VenueInstrument,
  type VenueTicker,
} from './types';
import { krakenKeyVariants, krakenTickerPair, toUsdt, venueFetch } from './spot';

export const KRAKEN_BASE = 'https://api.kraken.com';

/** Public OHLC path. */
export const KRAKEN_OHLC_PATH = '/0/public/OHLC';

export async function signKraken(input: SignInput): Promise<SignedRequest> {
  const nonce = String(resolveTimestampMs(input));
  const params: Record<string, string | number | undefined> = {
    ...input.query,
    nonce,
  };
  const postdata = buildQueryString(params);
  const digest = await sha256(encodeUtf8(nonce + postdata));
  const message = concatBytes(encodeUtf8(input.path), new Uint8Array(digest));
  const raw = await hmacDigest('SHA-512', base64ToBytes(input.secret), message);

  return {
    url: absoluteUrl(KRAKEN_BASE, input.path, postdata),
    headers: {
      'API-Key': input.apiKey,
      'API-Sign': bytesToBase64(raw),
    },
  };
}

/**
 * Asset pairs, normalized for AXIS symbols (`XBT → BTC`, legacy `X`/`Z`
 * prefixes stripped, `wsname` preferred when present).
 */
export async function fetchKrakenInstruments(): Promise<VenueInstrument[]> {
  const json = (await venueFetch('https://api.kraken.com/0/public/AssetPairs', 'Kraken')) as {
    error?: string[];
    result?: Record<string, { base?: string; quote?: string; status?: string; wsname?: string }>;
  };
  if (json.error?.length) throw new Error(json.error.join(', '));
  const out: VenueInstrument[] = [];
  for (const p of Object.values(json.result || {})) {
    if (p.status && p.status !== 'online') continue;
    // wsname like "XBT/USD"
    const ws = String(p.wsname || '');
    let base = String(p.base || '')
      .replace(/^X/, '')
      .replace(/^Z/, '');
    let quote = String(p.quote || '')
      .replace(/^X/, '')
      .replace(/^Z/, '');
    if (ws.includes('/')) {
      const [b, q] = ws.split('/');
      base = b || base;
      quote = q || quote;
    }
    if (!base || !quote) continue;
    // Normalize XBT → BTC for AXIS-style symbols
    if (base === 'XBT') base = 'BTC';
    if (quote === 'XBT') quote = 'BTC';
    out.push({ base, quote });
  }
  return out;
}

/**
 * Public `Ticker` for the requested symbols (one request for all pairs).
 * Unknown pairs surface as `error: ["EQuery:…"]` with a partial/empty result —
 * missing rows are skipped, never mixed onto another venue.
 */
export async function fetchKrakenTickers(symbols: string[]): Promise<Record<string, VenueTicker>> {
  const pairs = [...new Set(symbols.map(krakenTickerPair))];
  const body = (await venueFetch(
    `https://api.kraken.com/0/public/Ticker?pair=${pairs.join(',')}`,
    'kraken',
  )) as {
    error?: string[];
    result?: Record<string, { c?: [string, string]; o?: string }>;
  };
  const result = body.result && typeof body.result === 'object' ? body.result : {};
  const entries = Object.entries(result);
  if (!entries.length) throw new Error(`Kraken: ${(body.error || []).join(', ') || 'no tickers'}`);
  const byKey = new Map<string, { c?: [string, string]; o?: string }>();
  for (const [k, v] of entries) {
    for (const variant of krakenKeyVariants(k)) {
      if (!byKey.has(variant)) byKey.set(variant, v);
    }
  }
  const next: Record<string, VenueTicker> = {};
  for (const sym of symbols) {
    const t = byKey.get(toUsdt(sym));
    if (!t) continue;
    const price = parseFloat(t.c?.[0] || '');
    if (!Number.isFinite(price) || price <= 0) continue;
    const open = parseFloat(t.o || '');
    const open24h = Number.isFinite(open) && open > 0 ? open : undefined;
    next[sym] = {
      price,
      change: open24h ? ((price - open24h) / open24h) * 100 : 0,
      open24h,
    };
  }
  return next;
}
