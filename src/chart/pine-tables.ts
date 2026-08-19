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
 * Pure helpers for Pine **`table.*`** HUD objects (extract / normalize / filter).
 *
 * Tables are screen-space (not price-scale SVG). Only tables belonging to
 * **still-applied** chart scripts are shown — deleting a script must drop
 * its tables even if `lastRun` briefly lags.
 *
 * @module chart/pine-tables
 */

export interface PineTableCell {
  row: number;
  col: number;
  text: string;
  text_color?: string;
  bgcolor?: string;
  text_halign?: string;
  text_valign?: string;
  text_size?: string | number;
}

export interface PineTable {
  type: string;
  id?: string | number;
  position?: string;
  rows?: number;
  columns?: number;
  cells?: PineTableCell[];
  frame_color?: string;
  frame_width?: number;
  border_color?: string;
  border_width?: number;
  bgcolor?: string;
  /** Owning script id when aggregated from runResults */
  ownerId?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function asFiniteInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** True when payload looks like a Pine table drawing. */
export function isPineTable(d: unknown): d is PineTable {
  if (!isRecord(d)) return false;
  const t = String(d.type ?? d.kind ?? d.object_type ?? '').toLowerCase();
  return t === 'table' || t === 'table.new';
}

/** Parse one cell from engine payload (tolerant of snake/camel keys). */
export function parsePineTableCell(raw: unknown): PineTableCell | null {
  if (!isRecord(raw)) return null;
  const row = asFiniteInt(raw.row ?? raw.r);
  const col = asFiniteInt(raw.col ?? raw.column ?? raw.c);
  if (row == null || col == null || row < 0 || col < 0) return null;
  return {
    row,
    col,
    text: asText(raw.text ?? raw.txt ?? raw.value ?? raw.content ?? ''),
    text_color:
      raw.text_color != null
        ? String(raw.text_color)
        : raw.textColor != null
          ? String(raw.textColor)
          : undefined,
    bgcolor:
      raw.bgcolor != null
        ? String(raw.bgcolor)
        : raw.bg_color != null
          ? String(raw.bg_color)
          : undefined,
    text_halign:
      raw.text_halign != null
        ? String(raw.text_halign)
        : raw.halign != null
          ? String(raw.halign)
          : undefined,
    text_valign:
      raw.text_valign != null
        ? String(raw.text_valign)
        : raw.valign != null
          ? String(raw.valign)
          : undefined,
    text_size: (raw.text_size ?? raw.textSize ?? raw.size) as string | number | undefined,
  };
}

/**
 * Normalize table dimensions from declared rows/columns **and** cell extents
 * (engine sometimes omits or understates size).
 */
export function normalizePineTable(
  raw: unknown,
  ownerId?: string,
): PineTable | null {
  if (!isPineTable(raw)) return null;
  const cells: PineTableCell[] = [];
  const rawCells = Array.isArray(raw.cells)
    ? raw.cells
    : Array.isArray((raw as { cells_data?: unknown }).cells_data)
      ? (raw as { cells_data: unknown[] }).cells_data
      : [];
  for (const c of rawCells) {
    const cell = parsePineTableCell(c);
    if (cell) cells.push(cell);
  }

  let maxR = -1;
  let maxC = -1;
  for (const c of cells) {
    maxR = Math.max(maxR, c.row);
    maxC = Math.max(maxC, c.col);
  }
  const declaredRows = asFiniteInt(raw.rows) ?? 0;
  const declaredCols = asFiniteInt(raw.columns ?? (raw as { cols?: unknown }).cols) ?? 0;
  const rows = Math.max(1, declaredRows, maxR + 1);
  const columns = Math.max(1, declaredCols, maxC + 1);

  return {
    type: 'table',
    id: raw.id as string | number | undefined,
    position: raw.position != null ? String(raw.position) : undefined,
    rows,
    columns,
    cells,
    frame_color:
      raw.frame_color != null
        ? String(raw.frame_color)
        : raw.frameColor != null
          ? String(raw.frameColor)
          : undefined,
    frame_width: asFiniteInt(raw.frame_width ?? raw.frameWidth) ?? undefined,
    border_color:
      raw.border_color != null
        ? String(raw.border_color)
        : raw.borderColor != null
          ? String(raw.borderColor)
          : undefined,
    border_width: asFiniteInt(raw.border_width ?? raw.borderWidth) ?? undefined,
    bgcolor:
      raw.bgcolor != null
        ? String(raw.bgcolor)
        : raw.bg_color != null
          ? String(raw.bg_color)
          : undefined,
    ownerId,
  };
}

/** Extract tables from a single run payload. */
export function tablesFromRunPayload(
  payload: unknown,
  ownerId?: string,
): PineTable[] {
  if (!isRecord(payload)) return [];
  const drawings = Array.isArray(payload.drawings)
    ? payload.drawings
    : isRecord(payload.meta) && Array.isArray(payload.meta.drawings)
      ? payload.meta.drawings
      : [];
  const out: PineTable[] = [];
  for (const d of drawings) {
    const tb = normalizePineTable(d, ownerId);
    if (!tb) continue;
    // Skip empty shells (no text anywhere)
    if (!(tb.cells || []).some((c) => (c.text || '').trim())) continue;
    out.push(tb);
  }
  return out;
}

export type CollectTablesOpts = {
  /** Applied chart script ids (tables for missing ids are dropped). */
  scriptIds: ReadonlyArray<string> | ReadonlySet<string>;
  /** Per-script run cache */
  runResults: Record<string, unknown> | null | undefined;
  /** Editor preview key — only used when no chart scripts are applied */
  editorKey?: string;
  /** Fallback last-run when runResults empty (legacy) */
  lastRun?: unknown;
};

/**
 * Tables visible on the chart: union of tables from **still-applied and
 * visible** scripts. Callers must pass only visible script ids. Orphan
 * runResults (deleted scripts) are ignored so tables leave with delete.
 */
export function collectVisiblePineTables(opts: CollectTablesOpts): PineTable[] {
  const ids = opts.scriptIds instanceof Set ? opts.scriptIds : new Set(opts.scriptIds);
  const results = opts.runResults || {};
  const out: PineTable[] = [];
  const seen = new Set<string>();

  const pushAll = (payload: unknown, ownerId: string) => {
    for (const tb of tablesFromRunPayload(payload, ownerId)) {
      const key = `${ownerId}:${tb.id ?? ''}:${tb.position ?? ''}:${tb.rows}x${tb.columns}:${(tb.cells || []).map((c) => `${c.row},${c.col},${c.text}`).join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tb);
    }
  };

  if (ids.size > 0) {
    for (const id of ids) {
      if (id in results) pushAll(results[id], id);
    }
  } else if (opts.editorKey && opts.editorKey in results) {
    // No applied scripts — editor preview only (never sticky lastRun orphans)
    pushAll(results[opts.editorKey], opts.editorKey);
  }

  return out;
}

/** CSS position utilities for Pine position.* tokens. */
export function pineTablePositionClass(pos: string | undefined | null): string {
  const p = String(pos || 'top_right')
    .toLowerCase()
    .replace(/^position\./, '')
    .replace(/\s+/g, '_');
  if (p.includes('top') && p.includes('left')) return 'top-2 left-12';
  if (p.includes('top') && p.includes('center')) return 'top-2 left-1/2 -translate-x-1/2';
  if (p.includes('top') && p.includes('right')) return 'top-2 right-14';
  if (p.includes('middle') && p.includes('left')) return 'top-1/2 left-12 -translate-y-1/2';
  if (p.includes('middle') && p.includes('center')) {
    return 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2';
  }
  if (p.includes('middle') && p.includes('right')) return 'top-1/2 right-14 -translate-y-1/2';
  if (p.includes('bottom') && p.includes('left')) return 'bottom-10 left-12';
  if (p.includes('bottom') && p.includes('center')) {
    return 'bottom-10 left-1/2 -translate-x-1/2';
  }
  if (p.includes('bottom') && p.includes('right')) return 'bottom-10 right-14';
  return 'top-2 right-14';
}

/** Build row×col grid; cells outside bounds are ignored. */
export function buildTableGrid(
  tb: PineTable,
): (PineTableCell | null)[][] {
  const rows = Math.max(1, tb.rows || 1);
  const cols = Math.max(1, tb.columns || 1);
  const grid: (PineTableCell | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );
  for (const c of tb.cells || []) {
    if (c.row >= 0 && c.row < rows && c.col >= 0 && c.col < cols) {
      grid[c.row]![c.col] = c;
    }
  }
  return grid;
}

export function cellTextAlign(halign?: string): string {
  const h = String(halign || '').toLowerCase().replace('text\.', '');
  if (h.includes('left')) return 'left';
  if (h.includes('right')) return 'right';
  return 'center';
}
