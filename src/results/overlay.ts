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
 * Pure helpers for the Results overlay: event-stream filtering, saved-run
 * sorting / search, sparkline geometry, and numeric summaries.
 *
 * No Solid imports — safe for unit tests.
 *
 * @module results/overlay
 */

import type { ResultMeta } from '../plugins/types';
import type { StreamEventView } from './strategy';

// ── Events ─────────────────────────────────────────────────────────────────

/** Event direction bucket used by the stream filters. */
export type EventDirFilter = 'all' | 'long' | 'short';

/** Kinds that close or exit a position. Mirrors the row renderer. */
export function isCloseEvent(ev: StreamEventView): boolean {
  const kind = String(ev.type || ev.event || ev.kind || '').toLowerCase();
  return kind.includes('close') || kind.includes('exit');
}

/** Direction of an event, lowercased; `''` when the payload omits it. */
export function eventDir(ev: StreamEventView): string {
  return String(ev.dir || ev.direction || '')
    .trim()
    .toLowerCase();
}

/** Free-text haystack for one event row (kind, dir, id, from_entry). */
export function eventSearchText(ev: StreamEventView): string {
  return [
    String(ev.type || ev.event || ev.kind || ''),
    eventDir(ev),
    String(ev.id ?? ''),
    typeof ev.from_entry === 'string' ? ev.from_entry : '',
  ]
    .join(' ')
    .toLowerCase();
}

/** Filter state applied by {@link filterEvents} (direction, search text, close-only). */
export interface EventFilterOptions {
  /** Free-text query, matched case-insensitively against kind/dir/id. */
  query?: string;
  /** `all` keeps every direction. */
  dir?: EventDirFilter;
  /** Keep only entries (`false`), only exits (`true`), or both (`null`). */
  closesOnly?: boolean | null;
}

/**
 * Filter the enriched event stream. Order is preserved so the chronological
 * reading survives; an empty query with `dir: 'all'` returns the input.
 */
export function filterEvents(
  events: readonly StreamEventView[],
  opts: EventFilterOptions = {},
): StreamEventView[] {
  const q = String(opts.query ?? '')
    .trim()
    .toLowerCase();
  const dir = opts.dir ?? 'all';
  const closesOnly = opts.closesOnly ?? null;
  if (!q && dir === 'all' && closesOnly == null) return [...events];
  return events.filter((ev) => {
    if (closesOnly != null && isCloseEvent(ev) !== closesOnly) return false;
    if (dir !== 'all' && eventDir(ev) !== dir) return false;
    if (q && !eventSearchText(ev).includes(q)) return false;
    return true;
  });
}

/** Count entries, exits, and long/short events for the filter chips. */
export function countEvents(events: readonly StreamEventView[]): {
  all: number;
  entries: number;
  exits: number;
  long: number;
  short: number;
} {
  let entries = 0;
  let exits = 0;
  let long = 0;
  let short = 0;
  for (const ev of events) {
    if (isCloseEvent(ev)) exits += 1;
    else entries += 1;
    const d = eventDir(ev);
    if (d === 'long') long += 1;
    else if (d === 'short') short += 1;
  }
  return { all: events.length, entries, exits, long, short };
}

// ── Saved runs ─────────────────────────────────────────────────────────────

/** Sort orders for the saved-runs list. */
export type SavedSort = 'newest' | 'oldest' | 'pnl' | 'winrate' | 'trades';

/** Sort options for the saved-runs list, in the order the picker shows them. */
export const SAVED_SORTS: readonly { id: SavedSort; label: string }[] = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'pnl', label: 'Net P&L' },
  { id: 'winrate', label: 'Win %' },
  { id: 'trades', label: 'Trades' },
] as const;

function savedNumber(stats: unknown, key: string): number | null {
  if (!stats || typeof stats !== 'object') return null;
  const v = (stats as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Search haystack for a saved run: label, kind, symbol, timeframe. */
export function savedRunSearchText(run: ResultMeta): string {
  const inputs = (run.inputs ?? {}) as Record<string, unknown>;
  const symbol = String(inputs['symbol'] ?? inputs['ticker'] ?? '');
  const timeframe = String(inputs['timeframe'] ?? inputs['interval'] ?? '');
  return [run.label ?? '', run.scriptKind ?? '', symbol, timeframe].join(' ').toLowerCase();
}

/**
 * Sort + filter saved runs. `newest` (the storage default) is stable and
 * keeps the backend's order; numeric sorts put runs without the metric last.
 */
export function sortSavedRuns(
  runs: readonly ResultMeta[],
  sort: SavedSort = 'newest',
  query = '',
): ResultMeta[] {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  const out = q ? runs.filter((r) => savedRunSearchText(r).includes(q)) : [...runs];
  if (sort === 'newest') return out;
  if (sort === 'oldest') {
    return out.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  }
  const key = sort === 'pnl' ? 'totalPnl' : sort === 'winrate' ? 'winRate' : 'trades';
  return out.sort((a, b) => {
    const av = savedNumber(a.stats, key);
    const bv = savedNumber(b.stats, key);
    if (av == null && bv == null) return (b.startedAt || 0) - (a.startedAt || 0);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return (b.startedAt || 0) - (a.startedAt || 0);
    return bv - av;
  });
}

// ── Series geometry ────────────────────────────────────────────────────────

/** Aggregate of one plotted series: min/max/last plus finite-sample count. */
export interface SeriesSummary {
  /** Non-null sample count. */
  count: number;
  first: number | null;
  last: number | null;
  min: number | null;
  max: number | null;
  /** last − first; null when either end is missing. */
  change: number | null;
  /** `change / |first|`; null when first is 0 or missing. */
  changePct: number | null;
}

/**
 * Min/max/first/last for a plot series. Loops instead of spreading into
 * `Math.min(...)`: series reach bar-count length and the spread overflows
 * the argument limit.
 */
export function summarizeSeries(data: readonly (number | null)[]): SeriesSummary {
  let count = 0;
  let min: number | null = null;
  let max: number | null = null;
  let first: number | null = null;
  let last: number | null = null;
  for (const v of data) {
    if (v == null || !Number.isFinite(v)) continue;
    count += 1;
    if (first == null) first = v;
    last = v;
    if (min == null || v < min) min = v;
    if (max == null || v > max) max = v;
  }
  const change = first != null && last != null ? last - first : null;
  const changePct =
    change != null && first != null && first !== 0 ? (change / Math.abs(first)) * 100 : null;
  return { count, first, last, min, max, change, changePct };
}

/**
 * SVG path for a sparkline over `data` in a `w × h` box. Null samples are
 * skipped, which breaks the line rather than drawing through them.
 */
export function sparklinePath(
  data: readonly (number | null)[],
  opts: { w?: number; h?: number; pad?: number } = {},
): string {
  const w = opts.w ?? 100;
  const h = opts.h ?? 34;
  const pad = opts.pad ?? 3;
  const pts: { i: number; v: number }[] = [];
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i];
    if (v == null || !Number.isFinite(v)) continue;
    pts.push({ i, v });
  }
  if (pts.length < 2) return '';
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const lastIndex = Math.max(1, data.length - 1);
  let d = '';
  for (let n = 0; n < pts.length; n += 1) {
    const p = pts[n] as { i: number; v: number };
    const x = pad + (p.i / lastIndex) * (w - pad * 2);
    const y = pad + (h - pad * 2) - ((p.v - min) / span) * (h - pad * 2);
    d += `${n === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}
