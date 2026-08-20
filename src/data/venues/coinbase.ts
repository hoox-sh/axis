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
} from './types';

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
