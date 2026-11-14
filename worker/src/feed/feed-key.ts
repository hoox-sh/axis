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
 * Feed-key parsing for the shared market feed (`/api/feed`).
 *
 * Venues: `mexc`, `bybit`; market `spot`; adjustment `none`;
 * `public` scope (plus `user:<hash>` on the user-fed plane via
 * {@link parseFeedKeyAllowUserScope}). The interval set is the Binance kline
 * grid; bybit mappings live in `venue-klines.ts`. The key grammar intentionally
 * matches the PWA side
 * (`src/engine/feed-client.ts`): `venue|market|SYMBOL|interval|adjustment|scope`.
 *
 * Symbols may be written pair-form (`BTC/USDT`, as the PWA does) or compact
 * (`BTCUSDT`). Both normalise to pair form; {@link feedKeyToBinanceSymbol}
 * strips the slash again for Binance REST/WS calls. Feeds are keyed by the
 * *canonical* key everywhere (DO name, `feed` field on frames) so both
 * spellings resolve to the same Durable Object.
 *
 * No I/O in this module — pure string work, unit-tested in
 * `worker/tests/feed.test.ts`.
 *
 * @module worker/feed/feed-key
 */

/** A parsed, canonical feed key. `symbol` is always pair form (`BTC/USDT`). */
export interface FeedKey {
  /** Venue id — one of `FEED_VENUES`. */
  venue: string;
  /** Market segment — always `spot` in this phase. */
  market: string;
  /** Pair-form symbol, uppercase (e.g. `BTC/USDT`). */
  symbol: string;
  /** Binance kline interval (whitelisted). */
  interval: string;
  /** Price adjustment — always `none` in this phase. */
  adjustment: string;
  /** Auth scope — `public`, or `user:<partition id>` for user-fed feeds. */
  authScope: string;
}

/**
 * Venues this feed polls. Binance is deliberately absent: api.binance.com and
 * data-api.binance.vision both return 403 from Cloudflare egress (they block
 * datacenter ASNs), verified against the deployed worker. MEXC and Bybit both
 * serve public klines to CF egress.
 */
export const FEED_VENUES = ['mexc', 'bybit'] as const;
export type FeedVenue = (typeof FEED_VENUES)[number];
const FEED_VENUE_SET: ReadonlySet<string> = new Set(FEED_VENUES);

/** Binance kline intervals supported by this phase. */
export const FEED_INTERVALS = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
] as const;

export type FeedInterval = (typeof FEED_INTERVALS)[number];

const INTERVAL_SET: ReadonlySet<string> = new Set(FEED_INTERVALS);

/** Interval length in milliseconds, keyed by interval string. */
export const INTERVAL_TO_MS: Readonly<Record<string, number>> = {
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '8h': 8 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

/** Interval string is passed through; venue-specific mapping lives in venue-klines. */

const MARKET = 'spot';
const ADJUSTMENT = 'none';
const SCOPE = 'public';

/** Interval string is venue-agnostic for the supported venues; kept for tests/callers. */
export function binanceInterval(interval: string): string {
  return interval;
}

const SLASH_SYMBOL_RE = /^[A-Z0-9]{2,20}\/[A-Z0-9]{2,20}$/;
const COMPACT_SYMBOL_RE = /^[A-Z0-9]{4,40}$/;

/**
 * Quote assets we can split a compact symbol on, longest first so `FDUSD`
 * wins over `USD`. Spot only — this is a display/quote heuristic for the
 * phase-1 Binance-spot-only feed, not a general symbol parser.
 */
const KNOWN_QUOTES = [
  'FDUSD',
  'USDT',
  'USDC',
  'TUSD',
  'BUSD',
  'USDP',
  'DAI',
  'USD',
  'EUR',
  'TRY',
  'BRL',
  'BTC',
  'ETH',
  'BNB',
] as const;

const FEED_KEY_SEPARATOR = '|';
const FEED_KEY_PARTS = 6;

/** `user:<32 lowercase hex>` — matches {@link partitionIdFromKey} output. */
export const USER_SCOPE_RE = /^user:[0-9a-f]{32}$/;

/** Split a compact symbol (`BTCUSDT`) into pair form (`BTC/USDT`). */
function splitCompactSymbol(compact: string): string | null {
  for (const quote of KNOWN_QUOTES) {
    if (compact.length > quote.length && compact.endsWith(quote)) {
      const base = compact.slice(0, compact.length - quote.length);
      if (/^[A-Z0-9]{2,20}$/.test(base)) return `${base}/${quote}`;
    }
  }
  return null;
}

/**
 * Parse and validate a feed key. Returns `null` for anything outside the
 * phase-1 contract: non-Binance venues, non-spot markets, non-`none`
 * adjustment, non-`public` scope, non-whitelisted intervals, or malformed
 * symbols. Rejects leading/trailing whitespace, `..`, and any casing drift
 * (venue/market/scope/adjustment must be exact lowercase).
 *
 * Both `BTC/USDT` and `BTCUSDT` are accepted; the returned key always uses
 * pair form.
 */
export function parseFeedKey(raw: string): FeedKey | null {
  return parseFeedKeyInternal(raw, false);
}

/**
 * Like {@link parseFeedKey} but additionally accepts a `user:<32-hex>` auth
 * scope (the partition id of the API key that owns the feed). Used by the
 * user-fed plane (`POST /api/feed/bars` and the delta read path); the public
 * Binance-polled plane keeps {@link parseFeedKey} unchanged.
 */
export function parseFeedKeyAllowUserScope(raw: string): FeedKey | null {
  return parseFeedKeyInternal(raw, true);
}

function parseFeedKeyInternal(raw: string, allowUserScope: boolean): FeedKey | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw !== raw.trim()) return null;
  if (raw.includes('..')) return null;

  const segments = raw.split(FEED_KEY_SEPARATOR);
  if (segments.length !== FEED_KEY_PARTS) return null;
  const [venue, market, symbolRaw, interval, adjustment, authScope] = segments as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  if (!FEED_VENUE_SET.has(venue)) return null;
  if (market !== MARKET) return null;
  if (adjustment !== ADJUSTMENT) return null;
  if (authScope !== SCOPE && !(allowUserScope && USER_SCOPE_RE.test(authScope))) return null;
  if (!INTERVAL_SET.has(interval)) return null;

  let symbol: string | null = null;
  if (SLASH_SYMBOL_RE.test(symbolRaw)) {
    symbol = symbolRaw;
  } else if (COMPACT_SYMBOL_RE.test(symbolRaw)) {
    symbol = splitCompactSymbol(symbolRaw);
  }
  if (symbol === null) return null;

  return { venue, market, symbol, interval, adjustment, authScope };
}

/** Serialise a parsed key back to its canonical string form. */
export function feedKeyToString(key: FeedKey): string {
  return [key.venue, key.market, key.symbol, key.interval, key.adjustment, key.authScope].join(
    FEED_KEY_SEPARATOR,
  );
}

/** `BTC/USDT` → `BTCUSDT` (Binance wire form). */
export function feedKeyToBinanceSymbol(key: FeedKey): string {
  return key.symbol.replace('/', '');
}
