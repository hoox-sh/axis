// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Library panel preferences — pinned scripts and recently applied built-ins.
 *
 * Both are small string arrays in `localStorage`; the panel is the only
 * writer. Read helpers never throw (unavailable storage → empty list), so
 * SSR / private-mode boots stay quiet.
 *
 * @module ui/library/prefs
 */

import { getJson, setJson } from '../../utils/storage';

/** Pinned script ids (built-in ids such as `rsi`, personal ids such as `s_…`). */
export const LIBRARY_FAVORITES_KEY = 'axis.library.favorites';

/** Recently applied built-in ids, newest first. */
export const LIBRARY_RECENT_KEY = 'axis.library.recent';

/** How many recent built-ins the quick strip keeps. */
export const LIBRARY_RECENT_MAX = 6;

function readIdList(key: string): string[] {
  const raw = getJson<unknown>(key);
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value === 'string' && value && !out.includes(value)) out.push(value);
  }
  return out;
}

function writeIdList(key: string, ids: readonly string[]): string[] {
  const next: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && id && !next.includes(id)) next.push(id);
  }
  setJson(key, next);
  return next;
}

export function readFavoriteIds(): string[] {
  return readIdList(LIBRARY_FAVORITES_KEY);
}

export function writeFavoriteIds(ids: readonly string[]): string[] {
  return writeIdList(LIBRARY_FAVORITES_KEY, ids);
}

/** Add or remove one pinned id. `current` avoids a storage read when the caller already has it. */
export function toggleFavoriteId(id: string, current?: readonly string[]): string[] {
  const base = current ? [...current] : readFavoriteIds();
  const at = base.indexOf(id);
  if (at >= 0) base.splice(at, 1);
  else base.unshift(id);
  return writeFavoriteIds(base);
}

export function readRecentBuiltinIds(): string[] {
  return readIdList(LIBRARY_RECENT_KEY);
}

/** Move one built-in to the front of the recent strip (deduped, capped). */
export function noteRecentBuiltinId(id: string): string[] {
  const next = [id, ...readRecentBuiltinIds().filter((x) => x !== id)].slice(0, LIBRARY_RECENT_MAX);
  return writeIdList(LIBRARY_RECENT_KEY, next);
}

export function clearRecentBuiltinIds(): string[] {
  return writeIdList(LIBRARY_RECENT_KEY, []);
}
