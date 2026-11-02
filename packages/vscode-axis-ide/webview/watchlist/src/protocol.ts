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
 * Watchlist studio webview protocol.
 * Host posts `{ type: 'watchlist.snapshot', snapshot }`.
 * Webview posts `watchlist.ready` / `watchlist.add` / `watchlist.remove` / `watchlist.select`.
 */

export type WatchlistRowView = {
  symbol: string;
  priceText: string;
  selected: boolean;
  placeholder: boolean;
};

export type WatchlistViewSnapshot = {
  count: number;
  selected: string | null;
  focusSymbol: string | null;
  focusPriceText: string;
  placeholder: boolean;
  rows: WatchlistRowView[];
};

export type WebviewDecodeOk = { ok: true; snapshot: WatchlistViewSnapshot };
export type WebviewDecodeErr = { ok: false };
export type WebviewDecodeResult = WebviewDecodeOk | WebviewDecodeErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Same rule as the host normalizer: upper-case, strip whitespace, else empty. */
export function normalizeWatchlistSymbol(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function rowFrom(raw: unknown): WatchlistRowView | null {
  if (!isPlainObject(raw)) return null;
  const symbol = normalizeWatchlistSymbol(raw.symbol);
  if (!symbol) return null;
  return {
    symbol,
    priceText: textOf(raw.priceText, '—'),
    selected: raw.selected === true,
    placeholder: raw.placeholder === true,
  };
}

/** Defensive snapshot. Bad rows are dropped. Never throws. */
export function snapshotFromPayload(raw: unknown): WatchlistViewSnapshot {
  try {
    if (!isPlainObject(raw)) {
      return {
        count: 0,
        selected: null,
        focusSymbol: null,
        focusPriceText: '—',
        placeholder: true,
        rows: [],
      };
    }
    const rows: WatchlistRowView[] = [];
    if (Array.isArray(raw.rows)) {
      for (const row of raw.rows) {
        const parsed = rowFrom(row);
        if (parsed) rows.push(parsed);
      }
    }
    const selectedNorm = normalizeWatchlistSymbol(raw.selected);
    const selected = selectedNorm && rows.some((row) => row.symbol === selectedNorm) ? selectedNorm : null;
    const focusNorm = normalizeWatchlistSymbol(raw.focusSymbol);
    let focusSymbol: string | null = null;
    if (focusNorm && rows.some((row) => row.symbol === focusNorm)) {
      focusSymbol = focusNorm;
    } else if (selected) {
      focusSymbol = selected;
    } else if (rows.length > 0) {
      focusSymbol = rows[0]!.symbol;
    }
    let focusPriceText = '—';
    if (focusSymbol) {
      for (const row of rows) {
        if (row.symbol === focusSymbol) {
          focusPriceText = row.priceText;
          break;
        }
      }
    }
    return {
      count: rows.length,
      selected,
      focusSymbol,
      focusPriceText,
      placeholder: raw.placeholder === true,
      rows,
    };
  } catch {
    return {
      count: 0,
      selected: null,
      focusSymbol: null,
      focusPriceText: '—',
      placeholder: true,
      rows: [],
    };
  }
}

export function decodeHostMessage(raw: unknown): WebviewDecodeResult {
  try {
    if (!isPlainObject(raw)) return { ok: false };
    if (raw.type !== 'watchlist.snapshot') return { ok: false };
    return { ok: true, snapshot: snapshotFromPayload(raw.snapshot) };
  } catch {
    return { ok: false };
  }
}

export function encodeWatchlistReady(): { type: 'watchlist.ready' } {
  return { type: 'watchlist.ready' };
}

export function encodeWatchlistAdd(symbol: string): { type: 'watchlist.add'; symbol: string } {
  return { type: 'watchlist.add', symbol };
}

export function encodeWatchlistRemove(symbol: string): { type: 'watchlist.remove'; symbol: string } {
  return { type: 'watchlist.remove', symbol };
}

export function encodeWatchlistSelect(symbol: string): { type: 'watchlist.select'; symbol: string } {
  return { type: 'watchlist.select', symbol };
}
