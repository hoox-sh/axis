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
 * Binance spot REST HMAC signer (signed GET).
 *
 * Query is existing params + `timestamp` + optional `recvWindow` + `signature`
 * (HMAC-SHA256 hex of that query string). Header: `X-MBX-APIKEY`.
 *
 * @module data/venues/binance
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

export const BINANCE_BASE = 'https://api.binance.com';

/** Spot klines path. */
export const BINANCE_KLINES_PATH = '/api/v3/klines';

export async function signBinance(input: SignInput): Promise<SignedRequest> {
  const timestamp = resolveTimestampMs(input);
  const params: Record<string, string | number | undefined> = {
    ...input.query,
    timestamp,
  };
  if (params.recvWindow === undefined) params.recvWindow = DEFAULT_RECV_WINDOW;

  const queryString = buildQueryString(params);
  const raw = await hmacDigest('SHA-256', encodeUtf8(input.secret), encodeUtf8(queryString));
  const signature = bytesToHex(raw);
  const signedQuery = `${queryString}&signature=${signature}`;

  return {
    url: absoluteUrl(BINANCE_BASE, input.path, signedQuery),
    headers: { 'X-MBX-APIKEY': input.apiKey },
  };
}
