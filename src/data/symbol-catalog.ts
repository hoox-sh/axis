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
 * Exchange-aware tradeable symbol lists for the Symbol modal.
 *
 * Resolves a venue from the active **source** (preferred) or **stream**,
 * fetches the public instrument catalog (cached 1h in localStorage), and
 * ranks matches for fuzzy filter.
 *
 * @module data/symbol-catalog
 */

import { getDataManagerSelection } from './data-manager-source';
import { fetchBinanceJson } from './binance-http';
import { fetchMexcJson } from './mexc-http';
import { resolveProviderVenue, type ProviderVenue } from './provider';
import { gatewayFetch, type GatewayMode } from './gateway';
import { fetchBybitInstruments } from './venues/bybit';
import { fetchCoinbaseInstruments } from './venues/coinbase';
import { fetchKrakenInstruments } from './venues/kraken';
import { fetchOkxInstruments } from './venues/okx';
import { getJson, setJson } from '../utils/storage';

export type SymbolVenue =
  'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken' | 'mexc' | 'gecko' | 'generic';

export type SymbolEntry = {
  /** AXIS load form (e.g. BTCUSDT, ETH-USD for Coinbase product-ish). */
  symbol: string;
  base: string;
  quote: string;
  /** Human label e.g. BTC/USDT */
  display: string;
};

export type SymbolCatalogResult = {
  venue: SymbolVenue;
  label: string;
  symbols: SymbolEntry[];
  /** true when list came from localStorage cache */
  fromCache: boolean;
  /** true when using static fallback majors (fetch failed / offline venue) */
  fallback: boolean;
  error?: string;
};

const CACHE_PREFIX = 'axis.symbols.v1.';
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Popular majors used when no network catalog is available. */
export const FALLBACK_MAJORS: SymbolEntry[] = [
  { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', display: 'BTC/USDT' },
  { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', display: 'ETH/USDT' },
  { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', display: 'SOL/USDT' },
  { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT', display: 'BNB/USDT' },
  { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT', display: 'XRP/USDT' },
  { symbol: 'ADAUSDT', base: 'ADA', quote: 'USDT', display: 'ADA/USDT' },
  { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT', display: 'DOGE/USDT' },
  { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT', display: 'AVAX/USDT' },
  { symbol: 'DOTUSDT', base: 'DOT', quote: 'USDT', display: 'DOT/USDT' },
  { symbol: 'LINKUSDT', base: 'LINK', quote: 'USDT', display: 'LINK/USDT' },
];

const VENUE_LABEL: Record<SymbolVenue, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  mexc: 'MEXC',
  gecko: 'GeckoTerminal',
  generic: 'Popular majors',
};

export function venueLabel(venue: SymbolVenue): string {
  return VENUE_LABEL[venue] || venue;
}

function toSymbolVenue(v: ProviderVenue): SymbolVenue {
  if (v === 'mock' || v === 'upload' || v === 'cache') return 'generic';
  return v;
}

/**
 * Map source / stream plugin ids → venue.
 * Source wins when it is a known venue; stream is used as a hint for
 * mock / data-manager / unknown sources.
 */
export function resolveSymbolVenue(sourceId: string, streamId?: string): SymbolVenue {
  const sel = sourceId === 'data-manager' ? getDataManagerSelection() : null;
  return toSymbolVenue(
    resolveProviderVenue(sourceId, streamId, {
      underlyingSourceId: sel?.sourceId,
    }),
  );
}

function cacheKey(id: string): string {
  return `${CACHE_PREFIX}${id}`;
}

function loadCache(id: string): SymbolEntry[] | null {
  const c = getJson<{ ts?: number; symbols?: SymbolEntry[] }>(cacheKey(id));
  if (!c?.symbols?.length) return null;
  if (typeof c.ts !== 'number' || Date.now() - c.ts > CACHE_TTL_MS) return null;
  return c.symbols;
}

function saveCache(id: string, symbols: SymbolEntry[]): void {
  setJson(cacheKey(id), { ts: Date.now(), symbols });
}

/** Compact pair → BASEQUOTE (AXIS binance/okx/bybit form). */
export function compactPair(base: string, quote: string): string {
  return `${base}${quote}`.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function entry(base: string, quote: string, symbol?: string): SymbolEntry {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  return {
    symbol: (symbol || compactPair(b, q)).toUpperCase(),
    base: b,
    quote: q,
    display: `${b}/${q}`,
  };
}

async function fetchBinance(): Promise<SymbolEntry[]> {
  const data = (await fetchBinanceJson({ path: 'exchangeInfo' })) as {
    symbols?: Array<{
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      status: string;
      isSpotTradingAllowed?: boolean;
    }>;
  };
  return (data.symbols || [])
    .filter((s) => s.status === 'TRADING' && s.isSpotTradingAllowed !== false)
    .map((s) => entry(s.baseAsset, s.quoteAsset, s.symbol));
}

async function fetchOkx(): Promise<SymbolEntry[]> {
  const instruments = await fetchOkxInstruments();
  return instruments.map((s) => entry(s.base, s.quote, compactPair(s.base, s.quote)));
}

async function fetchBybit(): Promise<SymbolEntry[]> {
  const instruments = await fetchBybitInstruments();
  return instruments.map((s) => entry(s.base, s.quote, s.symbol));
}

async function fetchCoinbase(): Promise<SymbolEntry[]> {
  const instruments = await fetchCoinbaseInstruments();
  return instruments.map((s) => {
    // AXIS coinbase source rewrites USDT → USD product; keep both forms useful
    const quote = s.quote.toUpperCase();
    const base = s.base.toUpperCase();
    const axisSym = quote === 'USD' ? compactPair(base, 'USDT') : compactPair(base, quote);
    return entry(base, quote === 'USD' ? 'USD' : quote, axisSym);
  });
}

async function fetchKraken(): Promise<SymbolEntry[]> {
  const instruments = await fetchKrakenInstruments();
  return instruments.map((s) => entry(s.base, s.quote, compactPair(s.base, s.quote)));
}

async function fetchMexc(): Promise<SymbolEntry[]> {
  const data = (await fetchMexcJson({ path: 'exchangeInfo' })) as {
    symbols?: Array<{
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      status: string;
      isSpotTradingAllowed?: boolean;
    }>;
  };
  return (data.symbols || [])
    .filter((s) => s.status === 'ENABLED' || s.status === 'TRADING' || s.isSpotTradingAllowed)
    .map((s) => entry(s.baseAsset, s.quoteAsset, s.symbol));
}

async function fetchVenue(venue: SymbolVenue): Promise<SymbolEntry[]> {
  switch (venue) {
    case 'binance':
      return fetchBinance();
    case 'okx':
      return fetchOkx();
    case 'bybit':
      return fetchBybit();
    case 'coinbase':
      return fetchCoinbase();
    case 'kraken':
      return fetchKraken();
    case 'mexc':
      return fetchMexc();
    case 'gecko':
      // Full DEX catalog is huge — majors + free-type in modal
      return FALLBACK_MAJORS.map((e) => ({ ...e }));
    case 'generic':
    default:
      return FALLBACK_MAJORS.map((e) => ({ ...e }));
  }
}

async function fetchCcxtMarkets(exchange: string, gateway: GatewayMode): Promise<SymbolEntry[]> {
  const res = await gatewayFetch(gateway, '/markets', { exchange });
  if (!res.ok) throw new Error(`gateway markets ${res.status}`);
  const json: unknown = await res.json();
  const rows = Array.isArray(json) ? json : [];
  const out: SymbolEntry[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (r.active === false) continue;
    const unified = String(r.symbol || '').trim();
    const base = String(r.base || '').trim();
    const quote = String(r.quote || '').trim();
    if (unified.includes('/')) {
      const [b, q] = unified.split('/');
      out.push({
        symbol: unified.toUpperCase(),
        base: (base || b || '').toUpperCase(),
        quote: (quote || q || '').toUpperCase(),
        display: unified.toUpperCase(),
      });
      continue;
    }
    if (base && quote) {
      const display = `${base.toUpperCase()}/${quote.toUpperCase()}`;
      out.push({ symbol: display, base: base.toUpperCase(), quote: quote.toUpperCase(), display });
    }
  }
  return out;
}

/**
 * Load symbols for a venue (cache → network → fallback majors).
 * Pass `ccxtExchange` when the active source is the CCXT gateway.
 */
export async function loadSymbolCatalog(
  venue: SymbolVenue,
  opts?: {
    forceRefresh?: boolean;
    signal?: AbortSignal;
    ccxtExchange?: string;
    gateway?: GatewayMode;
  },
): Promise<SymbolCatalogResult> {
  const ccxtEx = String(opts?.ccxtExchange || '')
    .trim()
    .toLowerCase();
  if (ccxtEx) {
    const cacheId = `ccxt:${ccxtEx}`;
    const label = `${ccxtEx} (CCXT)`;
    if (!opts?.forceRefresh) {
      const cached = loadCache(cacheId);
      if (cached?.length) {
        return { venue: 'generic', label, symbols: cached, fromCache: true, fallback: false };
      }
    }
    try {
      if (opts?.signal?.aborted) throw new Error('aborted');
      const symbols = await fetchCcxtMarkets(ccxtEx, opts?.gateway || 'auto');
      if (!symbols.length) throw new Error('empty catalog');
      saveCache(cacheId, symbols);
      return { venue: 'generic', label, symbols, fromCache: false, fallback: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cached = loadCache(cacheId);
      if (cached?.length) {
        return {
          venue: 'generic',
          label,
          symbols: cached,
          fromCache: true,
          fallback: false,
          error: msg,
        };
      }
      return {
        venue: 'generic',
        label,
        symbols: FALLBACK_MAJORS.map((e) => ({
          ...e,
          symbol: e.display,
        })),
        fromCache: false,
        fallback: true,
        error: msg,
      };
    }
  }

  const label = venueLabel(venue);
  if (!opts?.forceRefresh) {
    const cached = loadCache(venue);
    if (cached?.length) {
      return { venue, label, symbols: cached, fromCache: true, fallback: false };
    }
  }

  if (venue === 'generic' || venue === 'gecko') {
    const symbols = await fetchVenue(venue);
    if (venue === 'gecko') {
      // don't spam cache for static list
      return { venue, label, symbols, fromCache: false, fallback: true };
    }
    saveCache(venue, symbols);
    return { venue, label, symbols, fromCache: false, fallback: true };
  }

  try {
    if (opts?.signal?.aborted) throw new Error('aborted');
    const symbols = await fetchVenue(venue);
    if (!symbols.length) throw new Error('empty catalog');
    saveCache(venue, symbols);
    return { venue, label, symbols, fromCache: false, fallback: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cached = loadCache(venue);
    if (cached?.length) {
      return {
        venue,
        label,
        symbols: cached,
        fromCache: true,
        fallback: false,
        error: msg,
      };
    }
    return {
      venue,
      label,
      symbols: FALLBACK_MAJORS.map((e) => ({ ...e })),
      fromCache: false,
      fallback: true,
      error: msg,
    };
  }
}

/**
 * Rank / filter symbols for the modal search box.
 * Exact → base exact → prefix → includes. Caps results.
 */
export function filterSymbols(
  list: SymbolEntry[],
  query: string,
  opts?: { quote?: string; limit?: number },
): SymbolEntry[] {
  const limit = opts?.limit ?? 80;
  let pool = list;
  const quote = (opts?.quote || '').toUpperCase().trim();
  if (quote && quote !== 'ALL') {
    pool = pool.filter((s) => s.quote === quote);
  }
  const q = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!q) {
    // Prefer USDT / USD majors first when unfiltered
    const prefer = new Set(FALLBACK_MAJORS.map((m) => m.symbol));
    return [...pool]
      .sort((a, b) => {
        const pa = prefer.has(a.symbol) ? 0 : 1;
        const pb = prefer.has(b.symbol) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return a.symbol.localeCompare(b.symbol);
      })
      .slice(0, limit);
  }

  const quoteBoost = (quote: string): number => {
    const u = quote.toUpperCase();
    if (u === 'USDT' || u === 'USD' || u === 'USDC') return 0;
    if (u === 'BTC' || u === 'ETH') return 1;
    return 2;
  };

  const scored: { s: SymbolEntry; score: number; boost: number }[] = [];
  for (const s of pool) {
    const sym = s.symbol.toUpperCase();
    const base = s.base.toUpperCase();
    const compact = `${base}${s.quote}`.toUpperCase();
    let score = -1;
    if (sym === q || compact === q) score = 0;
    else if (base === q) score = 1;
    else if (sym.startsWith(q) || compact.startsWith(q)) score = 2;
    else if (base.startsWith(q)) score = 3;
    else if (sym.includes(q) || base.includes(q) || s.display.toUpperCase().includes(q)) {
      score = 4;
    }
    if (score >= 0) {
      scored.push({ s, score, boost: quoteBoost(s.quote) });
    }
  }
  scored.sort(
    (a, b) => a.score - b.score || a.boost - b.boost || a.s.symbol.localeCompare(b.s.symbol),
  );
  return scored.slice(0, limit).map((o) => o.s);
}

/** Distinct quote assets present in a catalog (sorted, USDT/USD first). */
export function listQuotes(list: SymbolEntry[]): string[] {
  const set = new Set<string>();
  for (const s of list) {
    if (s.quote) set.add(s.quote);
  }
  const all = [...set];
  const priority = ['USDT', 'USD', 'USDC', 'BTC', 'ETH', 'EUR'];
  all.sort((a, b) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    if (ia >= 0 || ib >= 0) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    return a.localeCompare(b);
  });
  return all;
}
