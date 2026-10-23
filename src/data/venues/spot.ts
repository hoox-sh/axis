// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared public-REST helpers for CEX spot venues.
 *
 * `symbol-catalog` (instruments) and `watchlist-tickers` (24h tickers) used to
 * implement OKX / Bybit / Coinbase / Kraken twice each — same hosts, same
 * `{ cache: 'no-store' }` posture, same `XBT → BTC` normalization, same
 * `HttpError` contract. The per-venue modules own the endpoints; this module
 * owns the fetch posture and the symbol spelling both sides must agree on.
 *
 * @module data/venues/spot
 */

import { HttpError } from '../../api/client';

/**
 * GET JSON from a public venue endpoint.
 * Always `no-store` (catalog and tickers both need fresh lists), throws
 * {@link HttpError} on non-2xx so callers share one error contract.
 */
export async function venueFetch(url: string, label: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new HttpError(res.status, `${label} HTTP ${res.status}`);
  return res.json() as Promise<unknown>;
}

/**
 * Normalize to a USDT/USD/USDC pair symbol (e.g. `BTC` → `BTCUSDT`).
 * Strips non-alphanumerics; leaves pairs that already end in quote assets alone.
 */
export function toUsdt(sym: string): string {
  const s = sym.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT') || s.endsWith('USD') || s.endsWith('USDC')) return s;
  return `${s}USDT`;
}

/** OKX spot `instId` from a watchlist symbol (`BTCUSDT` → `BTC-USDT`). */
export function okxInst(sym: string): string {
  const s = toUsdt(sym);
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
  if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
  return `${s}-USDT`;
}

/** Coinbase product id (`BTCUSDT` / `BTC` → `BTC-USD`). */
export function coinbaseProduct(sym: string): string {
  const s = toUsdt(sym);
  const base = s.replace(/USDT$/, '').replace(/USDC$/, '').replace(/USD$/, '');
  return `${base}-USD`;
}

/** Kraken request pair (`BTCUSDT` → `XBTUSDT`; BTC → XBT). */
export function krakenTickerPair(sym: string): string {
  const s = toUsdt(sym);
  if (s.endsWith('USDT')) {
    const base = s.slice(0, -4);
    return `${base === 'BTC' ? 'XBT' : base}USDT`;
  }
  if (s.endsWith('USDC')) {
    const base = s.slice(0, -4);
    return `${base === 'BTC' ? 'XBT' : base}USDC`;
  }
  if (s.endsWith('USD')) {
    const base = s.slice(0, -3);
    return `${base === 'BTC' ? 'XBT' : base}USD`;
  }
  return s;
}

/**
 * Canonicalize a Kraken `result` key for watchlist lookup.
 *
 * Kraken uses legacy `X`/`Z` asset prefixes (`XXBTZUSD` = XBT/USD,
 * `XETHZUSD` = ETH/USD) while newer pairs are plain (`SOLUSD`). Both the
 * raw and prefix-stripped forms are indexed so `XAUT`-style symbols (leading
 * X, no legacy prefix) still match while `XETH…` resolves to ETH.
 */
export function krakenKeyVariants(key: string): string[] {
  let s = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  s = s.replace(/XBT/g, 'BTC');
  s = s.replace(/Z(USD|EUR|JPY|GBP|CAD|AUD|USDT|USDC)$/, '$1');
  const out = [s];
  if (s.length > 6 && s.startsWith('X')) out.push(s.slice(1));
  return [...new Set(out)];
}
