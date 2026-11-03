// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure Watchlist studio snapshot + webview message parse.
 * No `vscode` import — host panel applies mutators from `watchlist.ts`.
 * Mock close matches `MOCK_PLACEHOLDER_CLOSE` in watchlist.ts (100).
 */

import { formatQuotePrice, resolveDisplayedQuotePrice, type QuoteSnapshot } from '../host/quote';

/** Same placeholder close as `createMockQuoteFeed` until a live feed exists. */
export const WATCHLIST_MOCK_CLOSE = 100;

export type WatchlistStudioState = {
  symbols: string[];
  selected: string | null;
};

export type WatchlistStudioRow = {
  symbol: string;
  priceText: string;
  selected: boolean;
  /** True when this row's price is the mock placeholder, not a live tick. */
  placeholder: boolean;
};

export type WatchlistStudioSnapshot = {
  count: number;
  /** Explicit selection only (null when the user has not selected). */
  selected: string | null;
  /** Selected symbol, else the first symbol — what the status bar follows. */
  focusSymbol: string | null;
  focusPriceText: string;
  /** True when the quote feed is the mock placeholder. */
  placeholder: boolean;
  rows: WatchlistStudioRow[];
};

export type WatchlistQuoteSource = {
  /**
   * `false` uses `getQuote`. Omitted or any other value keeps the mock
   * placeholder (formatted close, badge "placeholder") and ignores ticks.
   */
  mock?: boolean;
  getQuote?: (symbol: string) => unknown;
};

export type ParsedWatchlistStudioMessage =
  | { ok: true; type: 'ready' }
  | { ok: true; type: 'add'; symbol: string }
  | { ok: true; type: 'remove'; symbol: string }
  | { ok: true; type: 'select'; symbol: string }
  | { ok: false; reason: string };

/** Upper-case ticker; empty when unusable. Never throws. */
export function normalizeWatchlistSymbol(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  return true;
}

/** Parse a watchlist state bag (never throws). */
export function parseWatchlistStudioState(raw: unknown): WatchlistStudioState {
  if (!isPlainObject(raw)) return { symbols: [], selected: null };
  let list: unknown;
  try {
    list = raw.symbols;
  } catch {
    return { symbols: [], selected: null };
  }
  const symbols: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(list)) {
    try {
      for (const row of list) {
        const sym = normalizeWatchlistSymbol(row);
        if (!sym) continue;
        if (seen.has(sym)) continue;
        seen.add(sym);
        symbols.push(sym);
      }
    } catch {
      /* keep symbols collected before the iterator failed */
    }
  }
  let selectedRaw: unknown;
  try {
    selectedRaw = raw.selected;
  } catch {
    return { symbols, selected: null };
  }
  const selectedNorm = normalizeWatchlistSymbol(selectedRaw);
  if (!selectedNorm) return { symbols, selected: null };
  if (!seen.has(selectedNorm)) return { symbols, selected: null };
  return { symbols, selected: selectedNorm };
}

function coerceQuote(raw: unknown): QuoteSnapshot | null {
  try {
    if (raw == null) return null;
    if (typeof raw !== 'object') return null;
    if (Array.isArray(raw)) return null;
    const bag = raw as Record<string, unknown>;
    const tickPrice = bag.tickPrice;
    const barClose = bag.barClose;
    if (typeof tickPrice !== 'number') return null;
    if (typeof barClose !== 'number') return null;
    const streamRaw = bag.streamState;
    const streamState = typeof streamRaw === 'string' ? streamRaw : null;
    return { tickPrice, barClose, streamState };
  } catch {
    return null;
  }
}

function readLiveQuote(quotes: WatchlistQuoteSource, symbol: string): QuoteSnapshot | null {
  try {
    if (typeof quotes.getQuote !== 'function') return null;
    return coerceQuote(quotes.getQuote(symbol));
  } catch {
    return null;
  }
}

function mockPriceText(): string {
  return formatQuotePrice(
    resolveDisplayedQuotePrice({
      tickPrice: Number.NaN,
      barClose: WATCHLIST_MOCK_CLOSE,
      streamState: 'closed',
    }),
  );
}

function priceTextFor(mock: boolean, quote: QuoteSnapshot | null): string {
  if (mock) return mockPriceText();
  if (quote == null) return '—';
  return formatQuotePrice(resolveDisplayedQuotePrice(quote));
}

function resolveMock(quotes: WatchlistQuoteSource | null | undefined): boolean {
  if (quotes == null) return true;
  if (quotes.mock !== false) return true;
  return false;
}

function emptySnapshot(): WatchlistStudioSnapshot {
  return {
    count: 0,
    selected: null,
    focusSymbol: null,
    focusPriceText: '—',
    placeholder: true,
    rows: [],
  };
}

/**
 * Build the studio view model. `quotes.mock !== false` (including omitted
 * quotes) forces the placeholder close and never reads a tick.
 * Never throws.
 */
export function buildWatchlistSnapshot(
  state: unknown,
  quotes?: WatchlistQuoteSource | null,
): WatchlistStudioSnapshot {
  try {
    const parsed = parseWatchlistStudioState(state);
    const mock = resolveMock(quotes);
    const rows: WatchlistStudioRow[] = [];
    for (const symbol of parsed.symbols) {
      let quote: QuoteSnapshot | null = null;
      if (!mock) {
        quote = readLiveQuote(quotes as WatchlistQuoteSource, symbol);
      }
      const selected = symbol === parsed.selected;
      rows.push({
        symbol,
        priceText: priceTextFor(mock, quote),
        selected,
        placeholder: mock,
      });
    }
    let focusSymbol: string | null = null;
    if (parsed.selected !== null) {
      focusSymbol = parsed.selected;
    } else {
      const first = parsed.symbols[0];
      if (typeof first === 'string') focusSymbol = first;
    }
    let focusPriceText = '—';
    if (focusSymbol !== null) {
      for (const row of rows) {
        if (row.symbol === focusSymbol) {
          focusPriceText = row.priceText;
          break;
        }
      }
    }
    return {
      count: rows.length,
      selected: parsed.selected,
      focusSymbol,
      focusPriceText,
      placeholder: mock,
      rows,
    };
  } catch {
    return emptySnapshot();
  }
}

function messageName(type: string): string {
  if (type.startsWith('watchlist.')) return type.slice('watchlist.'.length);
  return type;
}

/**
 * Parse a webview → host message. Accepts `watchlist.add` or `add`
 * (same for ready / remove / select). Never throws.
 */
export function parseWatchlistStudioMessage(raw: unknown): ParsedWatchlistStudioMessage {
  try {
    if (!isPlainObject(raw)) return { ok: false, reason: 'not-object' };
    const type = raw.type;
    if (typeof type !== 'string') return { ok: false, reason: 'bad-type' };
    if (type.length === 0) return { ok: false, reason: 'bad-type' };
    const name = messageName(type);
    if (name === 'ready') return { ok: true, type: 'ready' };
    if (name !== 'add' && name !== 'remove' && name !== 'select') {
      return { ok: false, reason: 'unknown-type' };
    }
    const symbol = normalizeWatchlistSymbol(raw.symbol);
    if (!symbol) return { ok: false, reason: 'empty-symbol' };
    if (name === 'add') return { ok: true, type: 'add', symbol };
    if (name === 'remove') return { ok: true, type: 'remove', symbol };
    return { ok: true, type: 'select', symbol };
  } catch {
    return { ok: false, reason: 'throw' };
  }
}

export function encodeWatchlistStudioSnapshot(snapshot: WatchlistStudioSnapshot): {
  type: 'watchlist.snapshot';
  snapshot: WatchlistStudioSnapshot;
} {
  return { type: 'watchlist.snapshot', snapshot };
}
