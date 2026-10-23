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
 * Coinbase Exchange REST HMAC signer.
 *
 * HMAC-SHA256 of `timestamp + method + requestPath + body`, then base64.
 * Secret is base64-decoded before use (official Exchange auth).
 *
 * @module data/venues/coinbase
 */

import {
  absoluteUrl,
  base64ToBytes,
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
import { toUsdt, venueFetch } from './spot';

export const COINBASE_BASE = 'https://api.exchange.coinbase.com';

export async function signCoinbase(input: SignInput): Promise<SignedRequest> {
  const timestamp = String(Math.floor(resolveTimestampMs(input) / 1000));
  const queryString = buildQueryString(input.query);
  const requestPath = pathWithQuery(input.path, queryString);
  const prehash = `${timestamp}${input.method}${requestPath}`;
  const raw = await hmacDigest('SHA-256', base64ToBytes(input.secret), encodeUtf8(prehash));

  return {
    url: absoluteUrl(COINBASE_BASE, input.path, queryString),
    headers: {
      'CB-ACCESS-KEY': input.apiKey,
      'CB-ACCESS-SIGN': bytesToBase64(raw),
      'CB-ACCESS-TIMESTAMP': timestamp,
      'CB-ACCESS-PASSPHRASE': input.passphrase ?? '',
    },
  };
}

/** Online, trading-enabled products. */
export async function fetchCoinbaseInstruments(): Promise<VenueInstrument[]> {
  const data = (await venueFetch(
    'https://api.exchange.coinbase.com/products',
    'Coinbase',
  )) as Array<{
    base_currency: string;
    quote_currency: string;
    status: string;
    trading_disabled?: boolean;
  }>;
  if (!Array.isArray(data)) throw new Error('Coinbase products empty');
  return data
    .filter((s) => s.status === 'online' && !s.trading_disabled)
    .map((s) => ({ base: s.base_currency, quote: s.quote_currency }));
}

const COINBASE_TICKER_CAP = 12;

/**
 * Per-product ticker + 24h stats, mapped to the requested symbols.
 * Capped at 12 symbols to avoid request storms (caller slices).
 */
export async function fetchCoinbaseTickers(
  symbols: string[],
): Promise<Record<string, VenueTicker>> {
  const next: Record<string, VenueTicker> = {};
  await Promise.all(
    symbols.slice(0, COINBASE_TICKER_CAP).map(async (sym) => {
      const base = toUsdt(sym).replace(/USDT$/, '').replace(/USDC$/, '').replace(/USD$/, '');
      const product = `${base}-USD`;
      try {
        const t = (await venueFetch(
          `https://api.exchange.coinbase.com/products/${product}/ticker`,
          'coinbase',
        )) as { price?: string };
        const price = parseFloat(t.price || '0');
        if (!price) return;
        // 24h stats
        let change = 0;
        try {
          const st = (await venueFetch(
            `https://api.exchange.coinbase.com/products/${product}/stats`,
            'coinbase',
          )) as { open?: string; last?: string };
          const open = parseFloat(st.open || '0');
          const last = parseFloat(st.last || String(price));
          if (open) change = ((last - open) / open) * 100;
        } catch {
          /* stats optional — keep ticker */
        }
        next[sym] = { price, change };
      } catch {
        /* skip missing / invalid product */
      }
    }),
  );
  return next;
}
