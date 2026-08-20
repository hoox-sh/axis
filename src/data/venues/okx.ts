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
} from './types';

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
