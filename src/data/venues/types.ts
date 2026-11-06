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
 * Shared types and Web Crypto HMAC helpers for CEX REST signers.
 *
 * @module data/venues/types
 */

/** CEX venues that ship a native REST signer in `src/data/venues/`. */
export type VenueId = 'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken' | 'mexc';

/**
 * Everything a venue signer needs for one GET: method, path, query, and the
 * decrypted secrets. Lives only in memory — never serialize this.
 */
export interface SignInput {
  method: 'GET';
  path: string;
  query?: Record<string, string | number | undefined>;
  apiKey: string;
  secret: string;
  passphrase?: string;
  timestampMs?: number;
}

/** Signed request ready to hand to `fetch`: absolute URL plus auth headers. */
export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Default recvWindow (ms) for Binance / Bybit signed GET. */
export const DEFAULT_RECV_WINDOW = 5000;

/**
 * Neutral spot instrument — one tradable pair before AXIS display mapping.
 * `symbol-catalog` maps these to {@link SymbolEntry} via `entry()`.
 */
export interface VenueInstrument {
  base: string;
  quote: string;
  /** Raw exchange symbol when it carries meaning (e.g. Bybit `BTCUSDT`). */
  symbol?: string;
}

/**
 * Neutral 24h ticker row before Watchlist mapping.
 * `watchlist-tickers` tags these with `source` to build {@link WatchTicker}.
 */
export interface VenueTicker {
  price: number;
  change: number;
  open24h?: number;
  /** 24h high / low (optional — venues that ship them). */
  high24h?: number;
  low24h?: number;
  /** 24h base / quote volume (optional). */
  volume24h?: number;
  quoteVolume24h?: number;
}

const textEncoder = new TextEncoder();

/**
 * UTF-8 encode a string for HMAC input. Uses a module-level `TextEncoder` so
 * repeated signing does not allocate a new encoder per request.
 *
 * @param value - Text to encode (signature payloads, query strings).
 */
export function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/**
 * Signing timestamp in unix **milliseconds**: the caller's override when given,
 * otherwise the current clock. Venues reject stale values outside recvWindow.
 *
 * @param input - Object carrying an optional `timestampMs`.
 */
export function resolveTimestampMs(input: Pick<SignInput, 'timestampMs'>): number {
  return input.timestampMs ?? Date.now();
}

/** Insertion-order `k=v` join. Undefined values are dropped. */
export function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join('&');
}

/**
 * Append a query string to a path, leaving the path untouched when the query is
 * empty. No encoding or sorting is applied — the signer decides the exact form.
 *
 * @param path - Path beginning with `/`.
 * @param queryString - Pre-built `k=v&…` string (may be empty).
 */
export function pathWithQuery(path: string, queryString: string): string {
  return queryString ? `${path}?${queryString}` : path;
}

/**
 * Join a venue base origin, path, and query into the final request URL.
 *
 * @param base - Origin such as `https://api.binance.com` (no trailing slash).
 * @param path - Path beginning with `/`.
 * @param queryString - Pre-built query string (may be empty).
 */
export function absoluteUrl(base: string, path: string, queryString: string): string {
  return `${base}${pathWithQuery(path, queryString)}`;
}

/**
 * Lowercase hex encoding of a digest — Binance and Bybit HMAC signatures are
 * hex strings.
 *
 * @param bytes - Raw digest from `hmacDigest` / `sha256`.
 */
export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = '';
  for (let i = 0; i < u8.length; i++) {
    hex += u8[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Standard (padded) base64 of a digest — Coinbase and Kraken signatures are
 * base64 strings.
 *
 * @param bytes - Raw digest from `hmacDigest` / `sha256`.
 */
export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) {
    bin += String.fromCharCode(u8[i]!);
  }
  return btoa(bin);
}

/**
 * Decode base64 into raw bytes, re-adding any missing `=` padding so unpadded
 * venue payloads (webhook secrets, OKX passphrases) decode without error.
 *
 * @param b64 - Base64 text, padded or not.
 * @throws DOMException when the input is not valid base64.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = padLen ? `${b64}${'='.repeat(padLen)}` : b64;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Concatenate two byte arrays into a new buffer (OKX prehash is
 * `timestamp + method + path`).
 *
 * @param a - Leading bytes.
 * @param b - Trailing bytes.
 */
export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * HMAC-sign `message` with `secret` via Web Crypto, returning the raw digest.
 * Callers encode the result with {@link bytesToHex} or {@link bytesToBase64}.
 *
 * @param hash - Digest algorithm the venue specifies.
 * @param secret - Raw secret bytes (UTF-8 of the vault secret).
 * @param message - Bytes to sign (usually the prehashed request string).
 * @throws DOMException when the key cannot be imported.
 */
export async function hmacDigest(
  hash: 'SHA-256' | 'SHA-512',
  secret: Uint8Array,
  message: Uint8Array,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret.buffer as ArrayBuffer,
    { name: 'HMAC', hash },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, message.buffer as ArrayBuffer);
}

/**
 * SHA-256 digest of `data`, raw. Used as the prehash step in OKX and Coinbase
 * signatures before the HMAC.
 *
 * @param data - Bytes to hash.
 */
export async function sha256(data: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
}
