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
 * CCXT Pro datafeed gateway — thin wrapper around ccxt.pro for the
 * Bun sidecar. Provides REST (`fetchOHLCV`, `fetchMarkets`) and WS
 * (`watchOHLCV`) through a unified gateway interface.
 *
 * Credentials are stored in RAM only (never persisted to disk).
 *
 * @module datafeed/gateway
 */

import type { Bar, GatewaySession } from './types';

// ── ccxt surface ──────────────────────────────────────────────────
// `ccxt` is imported dynamically and is untyped at this call site, so only the
// members this gateway touches are declared here — nothing else escapes.

/** One OHLCV row: `[timestamp(ms), open, high, low, close, volume]`. */
type OhlcvRow = readonly [number, number, number, number, number, number];

/** Constructor options handed to a ccxt exchange. */
interface CcxtExchangeOptions {
  enableRateLimit: boolean;
  apiKey?: string;
  secret?: string;
  password?: string;
  uid?: string;
}

/** Exchange members this gateway calls (REST, WS, cleanup). */
interface CcxtExchange {
  fetchOHLCV(
    symbol: string,
    timeframe?: string,
    since?: number,
    limit?: number,
  ): Promise<OhlcvRow[]>;
  watchOHLCV(symbol: string, timeframe?: string): Promise<OhlcvRow>;
  fetchMarkets(): Promise<unknown>;
  close?(): unknown;
}

/** Exchange class exported by `ccxt` (`ccxt.binance`, `ccxt.mexc`, …). */
type CcxtExchangeClass = new (opts: CcxtExchangeOptions) => CcxtExchange;

/** The `ccxt` namespace narrowed to its exchange constructors. */
type CcxtModule = Record<string, CcxtExchangeClass>;

/** Module namespaces are objects — narrows `import('ccxt')` without a cast. */
function isCcxtModule(mod: unknown): mod is CcxtModule {
  return typeof mod === 'object' && mod !== null;
}

const sessions = new Map<string, GatewaySession>();
const exchanges = new Map<string, CcxtExchange>();
const watchers = new Map<string, AbortController>();

// ── Credential management ─────────────────────────────────────────

/**
 * Stores an exchange session under `credId` in process RAM only.
 *
 * Also drops the credential-less cached ccxt client for that exchange, so a call
 * without `credId` rebuilds it. Clients cached under an explicit `credId` keep the
 * keys they were constructed with until {@link closeAll}. Nothing is written to
 * disk, so sessions are lost on restart.
 *
 * @param credId - Caller-chosen credential handle, later passed as the `cred`
 *   query param.
 * @param session - Exchange id plus keys; `password` and `uid` are only used by
 *   exchanges that require them (e.g. OKX).
 */
export function putCredential(credId: string, session: GatewaySession): void {
  sessions.set(credId, session);
  exchanges.delete(session.exchange);
}

/**
 * Reads back a session previously stored by {@link putCredential}.
 *
 * @param credId - Credential handle supplied at registration.
 * @returns The stored session, or `undefined` when the id is unknown (e.g. after
 *   a restart, since the store is RAM only).
 */
export function getCredential(credId: string): GatewaySession | undefined {
  return sessions.get(credId);
}

/**
 * Forgets a session. Cached exchange clients are left in place — they keep the
 * keys they were constructed with until {@link closeAll} or a new
 * {@link putCredential} for the same exchange.
 *
 * @param credId - Credential handle to remove.
 * @returns `true` if a session was removed, `false` if the id was unknown.
 */
export function deleteCredential(credId: string): boolean {
  return sessions.delete(credId);
}

// ── Exchange instances ─────────────────────────────────────────────

let _ccxt: CcxtModule | null = null;
async function loadCcxt(): Promise<CcxtModule> {
  if (_ccxt) return _ccxt;
  let mod: unknown;
  try {
    mod = await import('ccxt');
  } catch {
    throw new Error('ccxt not installed — run: bun add ccxt');
  }
  if (!isCcxtModule(mod)) throw new Error('ccxt not installed — run: bun add ccxt');
  _ccxt = mod;
  return mod;
}

async function getExchange(exchangeId: string, credId?: string): Promise<CcxtExchange> {
  const cacheKey = credId ? `${exchangeId}:${credId}` : exchangeId;
  const cached = exchanges.get(cacheKey);
  if (cached) return cached;

  const ccxt = await loadCcxt();
  const ExClass = ccxt[exchangeId];
  if (!ExClass) throw new Error(`unknown exchange: ${exchangeId}`);

  const opts: CcxtExchangeOptions = { enableRateLimit: true };
  if (credId) {
    const sess = sessions.get(credId);
    if (sess) {
      opts.apiKey = sess.apiKey;
      opts.secret = sess.secret;
      if (sess.password) opts.password = sess.password;
      if (sess.uid) opts.uid = sess.uid;
    }
  }

  const ex = new ExClass(opts);
  exchanges.set(cacheKey, ex);
  return ex;
}

function closeExchange(ex: CcxtExchange): void {
  try {
    ex.close?.();
  } catch {
    /* ignore */
  }
}

function toBar(candle: OhlcvRow): Bar {
  return {
    time: Math.floor(candle[0] / 1000),
    open: candle[1],
    high: candle[2],
    low: candle[3],
    close: candle[4],
    volume: candle[5],
  };
}

// ── REST: fetchOHLCV ──────────────────────────────────────────────

/**
 * REST OHLCV through ccxt, normalized to the shared {@link Bar} shape.
 *
 * Returns whatever the exchange gives back — no gap fill, dedupe, or sort is
 * applied here, so callers must treat the array as exchange-ordered.
 *
 * @param exchangeId - ccxt namespace member, e.g. `binance` or `mexc`; must be
 *   an exported exchange constructor.
 * @param symbol - Exchange-native symbol, e.g. `BTC/USDT`.
 * @param timeframe - ccxt timeframe string; defaults to `1d`.
 * @param since - Start of the window in **milliseconds** epoch (ccxt convention),
 *   or omitted for the exchange default.
 * @param limit - Maximum number of candles; omitted means exchange default.
 * @param credId - Optional credential handle; omit for public endpoints.
 * @returns Bars with `time` in **seconds** epoch, in exchange order (this gateway
 *   neither sorts nor de-duplicates).
 * @throws {Error} `ccxt not installed — run: bun add ccxt` when the dynamic
 *   import fails, `unknown exchange: <id>` for an unrecognised exchange, and
 *   any error the exchange client raises (auth, rate limit, network).
 */
export async function fetchOHLCV(
  exchangeId: string,
  symbol: string,
  timeframe = '1d',
  since?: number,
  limit?: number,
  credId?: string,
): Promise<Bar[]> {
  const ex = await getExchange(exchangeId, credId);
  const raw: OhlcvRow[] = await ex.fetchOHLCV(symbol, timeframe, since, limit);
  return raw.map(toBar);
}

// ── REST: fetchMarkets ─────────────────────────────────────────────

/**
 * Raw ccxt markets payload for one exchange.
 *
 * Deliberately untyped and unwrapped: the gateway passes ccxt's object through
 * so consumers see the full market map without a contract to keep in sync.
 *
 * @param exchangeId - ccxt exchange constructor name, e.g. `binance`.
 * @param credId - Optional credential handle for exchanges that require auth to
 *   list markets.
 * @returns The ccxt markets result, unchanged.
 * @throws {Error} `ccxt not installed — run: bun add ccxt` when the import
 *   fails, `unknown exchange: <id>` for an unrecognised exchange, or any error
 *   raised by the exchange client.
 */
export async function fetchMarkets(exchangeId: string, credId?: string): Promise<unknown> {
  const ex = await getExchange(exchangeId, credId);
  return ex.fetchMarkets();
}

// ── WS: watchOHLCV ────────────────────────────────────────────────

/**
 * Pull-style handle over a live candle feed.
 *
 * Declared here as well as in `./types` so the gateway can be imported without
 * the contract module; both shapes are identical.
 */
export interface WatchStream {
  next(): Promise<Bar>;
  close(): void;
}

/**
 * Opens a ccxt Pro WS watch loop and exposes it as a buffered {@link WatchStream}.
 *
 * Bars produced while no `next()` is pending are queued, so a slow consumer
 * drops nothing. If the upstream loop fails while a `next()` is pending it
 * resolves a zeroed bar (`time: 0`) rather than rejecting, which the socket
 * handler treats as end-of-stream.
 *
 * @param exchangeId - ccxt exchange constructor name, e.g. `binance`.
 * @param symbol - Exchange-native symbol, e.g. `BTC/USDT`.
 * @param timeframe - ccxt timeframe string; defaults to `1m`.
 * @param credId - Optional credential handle; omit for public streams.
 * @returns A stream whose `next()` resolves with each new bar and whose
 *   `close()` aborts the loop, unregisters it, and closes the exchange client.
 * @example
 * const stream = watchOHLCV('binance', 'BTC/USDT', '1m');
 * try {
 *   for (;;) ws.send(JSON.stringify(await stream.next()));
 * } finally {
 *   stream.close();
 * }
 */
export function watchOHLCV(
  exchangeId: string,
  symbol: string,
  timeframe = '1m',
  credId?: string,
): WatchStream {
  const key = `${exchangeId}:${symbol}:${timeframe}`;
  const ac = new AbortController();
  watchers.set(key, ac);

  const buffer: Bar[] = [];
  let resolve: ((bar: Bar) => void) | null = null;
  let ex: CcxtExchange | null = null;

  (async () => {
    try {
      ex = await getExchange(exchangeId, credId);
      while (!ac.signal.aborted) {
        const raw: OhlcvRow = await ex.watchOHLCV(symbol, timeframe);
        const bar = toBar(raw);
        if (resolve) {
          const r = resolve;
          resolve = null;
          r(bar);
        } else {
          buffer.push(bar);
        }
      }
    } catch {
      if (!ac.signal.aborted && resolve) {
        resolve({ time: 0, open: 0, high: 0, low: 0, close: 0, volume: 0 });
      }
    }
  })();

  return {
    next(): Promise<Bar> {
      if (buffer.length > 0) return Promise.resolve(buffer.shift()!);
      return new Promise<Bar>((res) => {
        resolve = res;
      });
    },
    close() {
      ac.abort();
      watchers.delete(key);
      if (ex) closeExchange(ex);
    },
  };
}

// ── Lifecycle ──────────────────────────────────────────────────────

/**
 * Shuts the gateway down: aborts every watcher, closes every cached exchange
 * client, and clears the credential store.
 *
 * Called from the sidecar's `SIGINT` / `SIGTERM` handlers so sockets and ccxt
 * timers do not keep the process alive.
 */
export function closeAll(): void {
  for (const [, ac] of watchers) ac.abort();
  watchers.clear();
  for (const [, ex] of exchanges) closeExchange(ex);
  exchanges.clear();
  sessions.clear();
}
