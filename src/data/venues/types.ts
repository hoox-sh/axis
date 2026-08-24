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
 * Shared types and Web Crypto HMAC helpers for CEX REST signers.
 *
 * @module data/venues/types
 */

export type VenueId = 'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken' | 'mexc';

export interface SignInput {
  method: 'GET';
  path: string;
  query?: Record<string, string | number | undefined>;
  apiKey: string;
  secret: string;
  passphrase?: string;
  timestampMs?: number;
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Default recvWindow (ms) for Binance / Bybit signed GET. */
export const DEFAULT_RECV_WINDOW = 5000;

const textEncoder = new TextEncoder();

export function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function resolveTimestampMs(input: Pick<SignInput, 'timestampMs'>): number {
  return input.timestampMs ?? Date.now();
}

/** Insertion-order `k=v` join. Undefined values are dropped. */
export function buildQueryString(
  query?: Record<string, string | number | undefined>,
): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join('&');
}

export function pathWithQuery(path: string, queryString: string): string {
  return queryString ? `${path}?${queryString}` : path;
}

export function absoluteUrl(base: string, path: string, queryString: string): string {
  return `${base}${pathWithQuery(path, queryString)}`;
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = '';
  for (let i = 0; i < u8.length; i++) {
    hex += u8[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

export function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) {
    bin += String.fromCharCode(u8[i]!);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = padLen ? `${b64}${'='.repeat(padLen)}` : b64;
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

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

export async function sha256(data: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
}
