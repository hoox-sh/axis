// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Venue kline fetchers for the shared feed.
 *
 * Binance geo-blocks its public kline hosts for Cloudflare egress, so the
 * feed supports alternates. All return the same shape: ascending bars with
 * unix-second `time`, `volume` as float, `closed` derived from the bar's
 * close time vs now.
 *
 * @module worker/feed/venue-klines
 */

import { INTERVAL_TO_MS } from './feed-key';
import type { FeedBar } from './frames';

/** fetch with a hard timeout; non-2xx throws with the body's first bytes. */
async function fetchJson(url: string, timeoutMs = 8_000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`klines HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('klines: response is not JSON');
  }
}

const num = (v: unknown): number => (typeof v === 'string' ? Number.parseFloat(v) : Number(v));

/** Binance and MEXC share the same kline JSON shape. */
export function parseBinanceStyleKlines(
  raw: unknown,
  intervalMs: number,
  nowMs: number,
): FeedBar[] {
  if (!Array.isArray(raw)) return [];
  const bars: FeedBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const t = num(row[0]);
    const open = num(row[1]);
    const high = num(row[2]);
    const low = num(row[3]);
    const close = num(row[4]);
    const volume = num(row[5]);
    const closeTime = num(row[6]);
    if (![t, open, high, low, close, volume, closeTime].every(Number.isFinite)) continue;
    bars.push({
      time: Math.floor(t / 1000),
      open,
      high,
      low,
      close,
      volume,
      closed: closeTime <= nowMs,
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

const BYBIT_INTERVAL: Readonly<Record<string, string>> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '6h': '360',
  '12h': '720',
  '1d': 'D',
  '3d': '3D',
  '1w': 'W',
};

/** Bybit v5 spot klines: `{ result: { list: [[start,o,h,l,c,vol,turnover], …] } }`, newest first. */
export function parseBybitKlines(
  raw: unknown,
  interval: string,
  nowMs: number,
): FeedBar[] {
  const result = (raw as { result?: { list?: unknown } } | null)?.result;
  const list = result?.list;
  if (!Array.isArray(list)) return [];
  const intervalMs = INTERVAL_TO_MS[interval];
  if (intervalMs === undefined) return [];
  const bars: FeedBar[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = num(row[0]);
    const open = num(row[1]);
    const high = num(row[2]);
    const low = num(row[3]);
    const close = num(row[4]);
    const volume = num(row[5]);
    if (![t, open, high, low, close, volume].every(Number.isFinite)) continue;
    bars.push({
      time: Math.floor(t / 1000),
      open,
      high,
      low,
      close,
      volume,
      closed: t + intervalMs <= nowMs,
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

/** Cap on bars per request, matching each venue's own limit. */
const MAX_LIMIT = 1000;

/** Fetch up to `limit` klines, oldest→newest. `startMs`/`endMs` are inclusive ms. */
export async function fetchKlines(
  venue: string,
  symbol: string,
  interval: string,
  opts: { limit?: number; startMs?: number; endMs?: number } = {},
): Promise<FeedBar[]> {
  const limit = Math.min(Math.max(opts.limit ?? MAX_LIMIT, 1), MAX_LIMIT);
  const now = Date.now();
  const compact = symbol.replace('/', '');
  switch (venue) {
    case 'binance':
    case 'mexc': {
      const base =
        venue === 'binance'
          ? 'https://api.binance.com/api/v3/klines'
          : 'https://api.mexc.com/api/v3/klines';
      const qs = new URLSearchParams({ symbol: compact, interval, limit: String(limit) });
      if (opts.startMs !== undefined) qs.set('startTime', String(Math.floor(opts.startMs)));
      if (opts.endMs !== undefined) qs.set('endTime', String(Math.floor(opts.endMs)));
      const raw = await fetchJson(`${base}?${qs.toString()}`);
      const intervalMs = INTERVAL_TO_MS[interval] ?? 60_000;
      return parseBinanceStyleKlines(raw, intervalMs, now).slice(-limit);
    }
    case 'bybit': {
      const bybitInterval = BYBIT_INTERVAL[interval];
      if (!bybitInterval) {
        throw new Error(`bybit: unsupported interval ${interval}`);
      }
      const qs = new URLSearchParams({
        category: 'spot',
        symbol: compact,
        interval: bybitInterval,
        limit: String(limit),
      });
      if (opts.startMs !== undefined) qs.set('start', String(Math.floor(opts.startMs)));
      if (opts.endMs !== undefined) qs.set('end', String(Math.floor(opts.endMs)));
      const raw = await fetchJson(`https://api.bybit.com/v5/market/kline?${qs.toString()}`);
      const bars = parseBybitKlines(raw, interval, now);
      return bars.slice(-limit);
    }
    default:
      throw new Error(`unsupported venue: ${venue}`);
  }
}

/** Venues this module can fetch from. Keep in sync with the feed-key allowlist. */
export const SUPPORTED_VENUES = ['binance', 'mexc', 'bybit'] as const;
