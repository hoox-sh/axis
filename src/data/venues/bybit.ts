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
} from './types';

export const BYBIT_BASE = 'https://api.bybit.com';

/** Public spot kline path. */
export const BYBIT_KLINE_PATH = '/v5/market/kline';

export async function signBybit(input: SignInput): Promise<SignedRequest> {
  const timestamp = String(resolveTimestampMs(input));
  const recvWindow = String(input.query?.recvWindow ?? DEFAULT_RECV_WINDOW);
  const query: Record<string, string | number | undefined> = { ...input.query };
  delete query.recvWindow;
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
