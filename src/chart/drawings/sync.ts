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
 * Drawing copy / merge helpers for multi-chart layouts.
 *
 * ## Architecture (current)
 * User drawings live in a **single global** `store.drawings` list. Multi-chart
 * uses {@link chart-registry} for per-slot managers/bars, but only the **active**
 * slot mounts a `DrawingLayer` and paints user drawings (see `manager-access`,
 * `ChartHost`). Inactive slots are view-only.
 *
 * So drawings are already “shared” across layout slots — there is no per-slot
 * drawing store yet. These pure helpers:
 * - **clone** drawings with fresh ids (template / duplicate)
 * - **filter** by optional `meta.symbol` (future per-slot / multi-symbol)
 * - **merge** lists (`replace` | `append`) when syncing templates
 * - **offset** geometry for future per-slot clones on different series
 *
 * Does **not** touch the DOM, store, or chart registry.
 *
 * @module chart/drawings/sync
 */

/**
 * Minimal shape for id remapping / symbol filter (legacy dual-shape + unified).
 * No index signature — store `Drawing` unions remain assignable structurally.
 */
export interface DrawingSyncLike {
  id: string;
  meta?: { symbol?: string; [key: string]: unknown } | null;
  /** Unified points array (optional on legacy shapes). */
  points?: Array<{ time: number; price: number }>;
  /** Legacy two-point anchors. */
  p1?: { time: number; price: number };
  p2?: { time: number; price: number };
  /** Legacy hline price / vline time. */
  price?: number;
  time?: number;
}

export type MergeDrawingsMode = 'replace' | 'append';

export interface CloneDrawingsOptions {
  /** Stamp or overwrite `meta.symbol` on each clone (uppercased). */
  symbol?: string;
  /** Optional id factory (defaults to {@link newDrawingId}). */
  idFactory?: () => string;
}

export interface DrawingsForSymbolOptions {
  /**
   * When true, drawings with no `meta.symbol` are included (global / untagged).
   * Default false — only exact symbol match.
   */
  includeUntagged?: boolean;
}

export interface OffsetDrawingOptions {
  dTime?: number;
  dPrice?: number;
}

let idSeq = 0;

/**
 * Fresh drawing id (same prefix style as `DrawingLayer` placement).
 * Includes a monotonic sequence so batch clones stay unique within one ms.
 */
export function newDrawingId(): string {
  idSeq = (idSeq + 1) % 1_000_000;
  return `dw_${Date.now().toString(36)}_${idSeq.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Deep clone via structuredClone with JSON fallback (plain data only). */
export function deepCloneDrawing<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* non-cloneable → JSON */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '')
    .trim()
    .toUpperCase();
}

function readingSymbol(d: DrawingSyncLike): string | null {
  const s = d.meta?.symbol;
  if (s == null || s === '') return null;
  return normalizeSymbol(String(s));
}

/**
 * Deep-clone one drawing with a new id. Optionally stamp `meta.symbol`.
 */
export function cloneDrawing<T extends DrawingSyncLike>(
  drawing: T,
  opts?: CloneDrawingsOptions,
): T {
  const copy = deepCloneDrawing(drawing);
  const idFactory = opts?.idFactory ?? newDrawingId;
  copy.id = idFactory();
  if (opts?.symbol != null && opts.symbol !== '') {
    const sym = normalizeSymbol(opts.symbol);
    copy.meta = { ...(copy.meta || {}), symbol: sym };
  }
  return copy;
}

/**
 * Deep-clone a list of drawings, each with a **new id**.
 * Pure: does not mutate inputs. Use for template-style duplication.
 */
export function cloneDrawings<T extends DrawingSyncLike>(
  drawings: readonly T[],
  opts?: CloneDrawingsOptions,
): T[] {
  if (!drawings?.length) return [];
  return drawings.map((d) => cloneDrawing(d, opts));
}

/**
 * Filter drawings tagged for `symbol` via `meta.symbol` (case-insensitive).
 * Untagged drawings are excluded unless `includeUntagged` is true.
 */
export function drawingsForSymbol<T extends DrawingSyncLike>(
  drawings: readonly T[],
  symbol: string,
  opts?: DrawingsForSymbolOptions,
): T[] {
  if (!drawings?.length) return [];
  const want = normalizeSymbol(symbol);
  if (!want) return [];
  const includeUntagged = !!opts?.includeUntagged;
  return drawings.filter((d) => {
    const s = readingSymbol(d);
    if (s == null) return includeUntagged;
    return s === want;
  });
}

/**
 * Stamp `meta.symbol` on every drawing (deep clones; inputs unchanged).
 * Useful when preparing a global list for future per-symbol filtering.
 */
export function tagDrawingsSymbol<T extends DrawingSyncLike>(
  drawings: readonly T[],
  symbol: string,
): T[] {
  const sym = normalizeSymbol(symbol);
  if (!sym) return drawings.map((d) => deepCloneDrawing(d));
  return drawings.map((d) => {
    const copy = deepCloneDrawing(d);
    copy.meta = { ...(copy.meta || {}), symbol: sym };
    return copy;
  });
}

/**
 * Merge two drawing lists.
 *
 * - **replace** — result is a deep clone of `incoming` only
 * - **append** — `base` + `incoming`; colliding ids on incoming are re-assigned
 *
 * Never mutates the input arrays or their elements.
 */
export function mergeDrawings<T extends DrawingSyncLike>(
  base: readonly T[],
  incoming: readonly T[],
  mode: MergeDrawingsMode,
): T[] {
  if (mode === 'replace') {
    return (incoming ?? []).map((d) => deepCloneDrawing(d));
  }
  // append
  const out: T[] = (base ?? []).map((d) => deepCloneDrawing(d));
  const seen = new Set(out.map((d) => d.id));
  for (const d of incoming ?? []) {
    const copy = deepCloneDrawing(d);
    if (seen.has(copy.id)) {
      copy.id = newDrawingId();
    }
    seen.add(copy.id);
    out.push(copy);
  }
  return out;
}

function shiftPoint(
  p: { time: number; price: number },
  dTime: number,
  dPrice: number,
): { time: number; price: number } {
  return { time: p.time + dTime, price: p.price + dPrice };
}

/**
 * Deep-clone a drawing and shift chart-space geometry by `dTime` / `dPrice`.
 * Handles dual-shape fields: `points[]`, `p1`/`p2`, top-level `price` / `time`.
 * Future use: clone templates onto a slot with a different series origin.
 */
export function offsetDrawingGeometry<T extends DrawingSyncLike>(
  drawing: T,
  opts?: OffsetDrawingOptions,
): T {
  const dTime = opts?.dTime ?? 0;
  const dPrice = opts?.dPrice ?? 0;
  const copy = deepCloneDrawing(drawing);
  if (!dTime && !dPrice) return copy;

  if (Array.isArray(copy.points)) {
    copy.points = copy.points.map((p) => shiftPoint(p, dTime, dPrice));
  }
  if (copy.p1 && typeof copy.p1 === 'object') {
    copy.p1 = shiftPoint(copy.p1 as { time: number; price: number }, dTime, dPrice);
  }
  if (copy.p2 && typeof copy.p2 === 'object') {
    copy.p2 = shiftPoint(copy.p2 as { time: number; price: number }, dTime, dPrice);
  }
  if (typeof copy.price === 'number' && Number.isFinite(copy.price)) {
    copy.price = copy.price + dPrice;
  }
  if (typeof copy.time === 'number' && Number.isFinite(copy.time)) {
    copy.time = copy.time + dTime;
  }
  return copy;
}

/**
 * Clone all drawings with new ids, then optionally offset geometry.
 * Convenience for “copy template to another chart space”.
 */
export function cloneDrawingsOffset<T extends DrawingSyncLike>(
  drawings: readonly T[],
  opts?: CloneDrawingsOptions & OffsetDrawingOptions,
): T[] {
  const clones = cloneDrawings(drawings, opts);
  const dTime = opts?.dTime ?? 0;
  const dPrice = opts?.dPrice ?? 0;
  if (!dTime && !dPrice) return clones;
  return clones.map((d) => offsetDrawingGeometry(d, { dTime, dPrice }));
}
