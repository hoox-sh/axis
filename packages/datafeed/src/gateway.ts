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

const sessions = new Map<string, GatewaySession>();
const exchanges = new Map<string, any>();
const watchers = new Map<string, AbortController>();

// ── Credential management ─────────────────────────────────────────

export function putCredential(credId: string, session: GatewaySession): void {
  sessions.set(credId, session);
  exchanges.delete(session.exchange);
}

export function getCredential(credId: string): GatewaySession | undefined {
  return sessions.get(credId);
}

export function deleteCredential(credId: string): boolean {
  return sessions.delete(credId);
}

// ── Exchange instances ─────────────────────────────────────────────

let _ccxt: any = null;
async function loadCcxt(): Promise<any> {
  if (_ccxt) return _ccxt;
  try {
    _ccxt = await import('ccxt');
    return _ccxt;
  } catch {
    throw new Error('ccxt not installed — run: bun add ccxt');
  }
}

async function getExchange(exchangeId: string, credId?: string): Promise<any> {
  const cacheKey = credId ? `${exchangeId}:${credId}` : exchangeId;
  const cached = exchanges.get(cacheKey);
  if (cached) return cached;

  const ccxt = await loadCcxt();
  const ExClass = ccxt[exchangeId];
  if (!ExClass) throw new Error(`unknown exchange: ${exchangeId}`);

  const opts: Record<string, any> = { enableRateLimit: true };
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

function closeExchange(ex: any): void {
  try { ex.close?.(); } catch { /* ignore */ }
}

function toBar(candle: any): Bar {
  const c = candle as unknown as number[];
  return {
    time: Math.floor(c[0] / 1000),
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  };
}

// ── REST: fetchOHLCV ──────────────────────────────────────────────

export async function fetchOHLCV(
  exchangeId: string,
  symbol: string,
  timeframe = '1d',
  since?: number,
  limit?: number,
  credId?: string,
): Promise<Bar[]> {
  const ex = await getExchange(exchangeId, credId);
  const raw: any[] = await ex.fetchOHLCV(symbol, timeframe, since, limit);
  return raw.map(toBar);
}

// ── REST: fetchMarkets ─────────────────────────────────────────────

export async function fetchMarkets(exchangeId: string, credId?: string) {
  const ex = await getExchange(exchangeId, credId);
  return ex.fetchMarkets();
}

// ── WS: watchOHLCV ────────────────────────────────────────────────

export interface WatchStream {
  next(): Promise<Bar>;
  close(): void;
}

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
  let ex: any = null;

  (async () => {
    try {
      ex = await getExchange(exchangeId, credId);
      while (!ac.signal.aborted) {
        const raw: any[] = await ex.watchOHLCV(symbol, timeframe);
        const bar = toBar(raw as unknown as number[]);
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
      return new Promise<Bar>((res) => { resolve = res; });
    },
    close() {
      ac.abort();
      watchers.delete(key);
      if (ex) closeExchange(ex);
    },
  };
}

// ── Lifecycle ──────────────────────────────────────────────────────

export function closeAll(): void {
  for (const [, ac] of watchers) ac.abort();
  watchers.clear();
  for (const [, ex] of exchanges) closeExchange(ex);
  exchanges.clear();
  sessions.clear();
}
