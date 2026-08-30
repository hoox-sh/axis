// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MEXC spot REST HMAC signer (signed GET).
 *
 * Query is existing params + `timestamp` + optional `recvWindow` + `signature`
 * (HMAC-SHA256 hex of that query string). Header: `X-MEXC-APIKEY`.
 *
 * @module data/venues/mexc
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

export const MEXC_BASE = 'https://api.mexc.com';

/** Spot klines path (Binance-shaped arrays). */
export const MEXC_KLINES_PATH = '/api/v3/klines';

/** Compact AXIS symbol → MEXC spot id (`BTC-USDT` → `BTCUSDT`). */
export function mexcSpotSymbol(symbol: string): string {
  return String(symbol || '')
    .toUpperCase()
    .replace(/[-_/]/g, '');
}

/**
 * Chart TF → MEXC REST `interval`. Hourly is `60m` (not `1h`); weekly is `1W`.
 * Venue also documents `1M` (mapped through if the UI ever grows a month TF).
 */
export function mexcKlineInterval(interval: string): string {
  const m: Record<string, string> = {
    '1m': '1m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '60m',
    '4h': '4h',
    '1d': '1d',
    '1w': '1W',
    '1M': '1M',
  };
  return m[interval] || '1d';
}

/** Chart TF → MEXC JSON kline WS suffix (`david.c@example.com@Min1`). */
export function mexcWsKlineInterval(interval: string): string {
  const m: Record<string, string> = {
    '1m': 'Min1',
    '5m': 'Min5',
    '15m': 'Min15',
    '30m': 'Min30',
    '1h': 'Min60',
    '4h': 'Hour4',
    '1d': 'Day1',
    '1w': 'Week1',
  };
  return m[interval] || 'Day1';
}

export async function signMexc(input: SignInput): Promise<SignedRequest> {
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
    url: absoluteUrl(MEXC_BASE, input.path, signedQuery),
    headers: { 'X-MEXC-APIKEY': input.apiKey },
  };
}
