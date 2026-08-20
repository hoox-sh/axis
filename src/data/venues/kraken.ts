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
} from './types';

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
