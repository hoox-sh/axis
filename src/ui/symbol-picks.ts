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
 * Per-venue symbol recents and favorites for the symbol picker.
 *
 * Stored at {@link SYMBOL_PICKS_KEY}. Each scope (venue, or `ccxt:<exchange>`)
 * keeps a short recent list and a favorite list. Corrupt entries are dropped.
 *
 * @module ui/symbol-picks
 */

import { getJson, setJson } from '../utils/storage';

/** `localStorage` key holding every scope's recents and favorites. */
export const SYMBOL_PICKS_KEY = 'pynescript.axis.symbol-picks.v1';

/** How many recent symbols a scope keeps. */
export const SYMBOL_RECENT_LIMIT = 8;
/** How many favorites a scope keeps. */
export const SYMBOL_FAVORITE_LIMIT = 24;

const SYMBOL_RE = /^[A-Z0-9:._/-]{1,64}$/;

/** One scope's picker lists: recent symbols (newest first) and starred favorites. */
export type SymbolPicks = {
  recent: string[];
  favorites: string[];
};

type PicksBlob = Record<string, { recent?: unknown; favorites?: unknown }>;

/** Venue id, or `ccxt:<exchange>` when a CCXT session is active. */
export function symbolPicksScope(venue: string, ccxtExchange?: string): string {
  const ex = (ccxtExchange || '').toLowerCase().trim();
  if (ex) return `ccxt:${ex.slice(0, 40)}`;
  const v = (venue || '').toLowerCase().trim();
  return v || 'generic';
}

/** Uppercase AXIS symbol, or `''` when the text is not a symbol. */
export function normalizePickSymbol(raw: string): string {
  const sym = String(raw || '')
    .toUpperCase()
    .trim();
  return SYMBOL_RE.test(sym) ? sym : '';
}

function sanitizeList(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const sym = normalizePickSymbol(item);
    if (!sym || out.includes(sym)) continue;
    out.push(sym);
    if (out.length >= limit) break;
  }
  return out;
}

/** Empty picker state, used when a scope has nothing stored yet. */
export function emptySymbolPicks(): SymbolPicks {
  return { recent: [], favorites: [] };
}

/**
 * Read one scope's picks, dropping invalid or duplicate symbols.
 *
 * @param scope - Value from {@link symbolPicksScope}.
 * @returns Sanitized lists; empty lists when the scope was never saved.
 */
export function loadSymbolPicks(scope: string): SymbolPicks {
  const all = getJson<PicksBlob>(SYMBOL_PICKS_KEY);
  const slot = all?.[scope];
  if (!slot || typeof slot !== 'object') return emptySymbolPicks();
  return {
    favorites: sanitizeList(slot.favorites, SYMBOL_FAVORITE_LIMIT),
    recent: sanitizeList(slot.recent, SYMBOL_RECENT_LIMIT),
  };
}

/**
 * Persist one scope's picks alongside every other scope.
 *
 * @param scope - Value from {@link symbolPicksScope}.
 * @param picks - Lists to store; sanitized and capped before writing.
 * @returns `true` when storage accepted the write.
 */
export function saveSymbolPicks(scope: string, picks: SymbolPicks): boolean {
  const all = getJson<PicksBlob>(SYMBOL_PICKS_KEY) ?? {};
  all[scope] = {
    favorites: sanitizeList(picks.favorites, SYMBOL_FAVORITE_LIMIT),
    recent: sanitizeList(picks.recent, SYMBOL_RECENT_LIMIT),
  };
  return setJson(SYMBOL_PICKS_KEY, all);
}

/** Most-recent first. Dedupes and caps. Invalid symbols leave the list unchanged. */
export function rememberSymbol(picks: SymbolPicks, symbol: string): SymbolPicks {
  const sym = normalizePickSymbol(symbol);
  if (!sym) return picks;
  return {
    favorites: picks.favorites,
    recent: [sym, ...picks.recent.filter((s) => s !== sym)].slice(0, SYMBOL_RECENT_LIMIT),
  };
}

/** Add to the front, or remove. Caps the favorite list. */
export function toggleFavorite(picks: SymbolPicks, symbol: string): SymbolPicks {
  const sym = normalizePickSymbol(symbol);
  if (!sym) return picks;
  const has = picks.favorites.includes(sym);
  const favorites = has
    ? picks.favorites.filter((s) => s !== sym)
    : [sym, ...picks.favorites].slice(0, SYMBOL_FAVORITE_LIMIT);
  return { recent: picks.recent, favorites };
}

/** Favorites first. Recents omit anything already starred. */
export function visibleSymbolPicks(picks: SymbolPicks): SymbolPicks {
  const fav = new Set(picks.favorites);
  return {
    favorites: picks.favorites,
    recent: picks.recent.filter((s) => !fav.has(s)),
  };
}
