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
  /** Proportional width hint from `table.cell(width=…)` (bottom-panel layout). */
  width?: number;
  /** Proportional height hint from `table.cell(height=…)` (bottom-panel layout). */
  height?: number;
  /** Hover tooltip (`tooltip=` / `table.cell_set_tooltip`). */
  tooltip?: string;
  border_color?: string;
  border_width?: number;
}

export type PineTableLocation = 'chart' | 'bottom';
export type PineTablesLocationMap = Record<string, PineTableLocation>;

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
  /** `force_overlay=true` — chart pane hint (ignored in the bottom panel). */
  force_overlay?: boolean;
  /** Merged ranges as [start_row, start_col, end_row, end_col]. */
  merged_cells?: Array<[number, number, number, number]>;
  /** Creation order within one run (bottom panel stacks first → last). */
  seq?: number;
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

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
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
  const widthRaw = raw.width ?? raw.cell_width ?? raw.w;
  const heightRaw = raw.height ?? raw.cell_height ?? raw.h;
  const width = asFiniteNumber(widthRaw);
  const height = asFiniteNumber(heightRaw);
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
    width: width != null && width > 0 ? width : undefined,
    height: height != null && height > 0 ? height : undefined,
    tooltip:
      raw.tooltip != null && String(raw.tooltip).trim() !== ''
        ? String(raw.tooltip)
        : undefined,
    border_color:
      raw.border_color != null
        ? String(raw.border_color)
        : raw.borderColor != null
          ? String(raw.borderColor)
          : undefined,
    border_width: asFiniteInt(raw.border_width ?? raw.borderWidth) ?? undefined,
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
  const r = raw as unknown as Record<string, unknown>;
  const cells: PineTableCell[] = [];
  const rawCells = Array.isArray(raw.cells)
    ? raw.cells
    : Array.isArray(r.cells_data)
      ? (r.cells_data as unknown[])
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
  let declaredRows = asFiniteInt(raw.rows) ?? 0;
  let declaredCols = asFiniteInt(raw.columns ?? (raw as { cols?: unknown }).cols) ?? 0;
  const cellRows = maxR + 1;
  const cellCols = maxC + 1;
  // Older engines stored Pine's (columns, rows) under the opposite names.
  // That union with the real cell span painted a square of empty cells.
  if (
    declaredRows > 0 &&
    declaredCols > 0 &&
    declaredRows !== declaredCols &&
    declaredRows === cellCols &&
    declaredCols === cellRows
  ) {
    const swap = declaredRows;
    declaredRows = declaredCols;
    declaredCols = swap;
  }
  const rows = Math.max(1, declaredRows, cellRows);
  const columns = Math.max(1, declaredCols, cellCols);

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
        : r.frameColor != null
          ? String(r.frameColor)
          : undefined,
    frame_width: asFiniteInt(raw.frame_width ?? r.frameWidth) ?? undefined,
    border_color:
      raw.border_color != null
        ? String(raw.border_color)
        : r.borderColor != null
          ? String(r.borderColor)
          : undefined,
    border_width: asFiniteInt(raw.border_width ?? r.borderWidth) ?? undefined,
    bgcolor:
      raw.bgcolor != null
        ? String(raw.bgcolor)
        : r.bg_color != null
          ? String(r.bg_color)
          : undefined,
    force_overlay: Boolean(
      (raw as { force_overlay?: unknown }).force_overlay ??
        (r.forceOverlay as unknown) ??
        false,
    ),
    merged_cells: normalizeMergedCells(
      (raw as { merged_cells?: unknown }).merged_cells ??
        (raw as { mergedCells?: unknown }).mergedCells ??
        r.merged_cells,
      rows,
      columns,
    ),
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
  /**
   * Focused run. Used when that script is visible but its cache entry has
   * no table (a later failed tick replaced the cache).
   */
  lastRun?: unknown;
  /** Script id that owns {@link lastRun}. Ignored when it is not visible. */
  lastRunOwnerId?: string | null;
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
    const focus = opts.lastRunOwnerId?.trim();
    if (focus && ids.has(focus) && !out.some((tb) => tb.ownerId === focus)) {
      pushAll(opts.lastRun, focus);
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

export function cellTextAlign(halign?: string): 'left' | 'right' | 'center' {
  const h = String(halign || '').toLowerCase().replace('text.', '');
  if (h.includes('left')) return 'left';
  if (h.includes('right')) return 'right';
  return 'center';
}

/** Map Pine `text_valign` tokens (`text.*`-prefixed or bare) → CSS vertical-align. */
export function cellTextVerticalAlign(valign?: string): 'top' | 'middle' | 'bottom' {
  const v = String(valign || '').toLowerCase().replace('text.', '');
  if (v.includes('top')) return 'top';
  if (v.includes('bottom')) return 'bottom';
  return 'middle';
}

/** Normalize `merged_cells` ranges to [r0, c0, r1, c1] inside the table bounds. */
export function normalizeMergedCells(
  raw: unknown,
  rows: number,
  columns: number,
): Array<[number, number, number, number]> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: Array<[number, number, number, number]> = [];
  for (const m of raw) {
    if (!Array.isArray(m) || m.length < 4) continue;
    const nums = m.slice(0, 4).map((n) => (typeof n === 'number' ? Math.trunc(n) : Number(n)));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const [a, b, c, d] = nums as [number, number, number, number];
    const r0 = Math.min(a, c);
    const r1 = Math.max(a, c);
    const c0 = Math.min(b, d);
    const c1 = Math.max(b, d);
    if (r0 < 0 || c0 < 0 || r1 >= Math.max(1, rows) || c1 >= Math.max(1, columns)) continue;
    if (r0 === r1 && c0 === c1) continue;
    out.push([r0, c0, r1, c1]);
  }
  return out.length ? out : undefined;
}

/** True when a script's tables live in the bottom panel (not on the chart). */
export function isTablesInBottom(
  locationMap: PineTablesLocationMap | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  if (!ownerId) return false;
  return (locationMap || {})[ownerId] === 'bottom';
}

/** Split visible tables into chart-overlay vs bottom-panel buckets. */
export function splitTablesByLocation(
  tables: readonly PineTable[],
  locationMap: PineTablesLocationMap | null | undefined,
): { chart: PineTable[]; bottom: PineTable[] } {
  const chart: PineTable[] = [];
  const bottom: PineTable[] = [];
  for (const tb of tables) {
    if (isTablesInBottom(locationMap, tb.ownerId)) bottom.push(tb);
    else chart.push(tb);
  }
  return { chart, bottom };
}

/** Group bottom tables by owning script (one tab per script, creation order kept). */
export function groupBottomTablesByOwner(
  tables: readonly PineTable[],
): Array<{ ownerId: string; tables: PineTable[] }> {
  const order: string[] = [];
  const groups = new Map<string, PineTable[]>();
  for (const tb of tables) {
    const owner = tb.ownerId || '';
    if (!groups.has(owner)) {
      groups.set(owner, []);
      order.push(owner);
    }
    groups.get(owner)!.push(tb);
  }
  // Stable creation order inside each group (engine export ≈ creation order).
  return order.map((ownerId) => ({
    ownerId,
    tables: (groups.get(ownerId) || []).map((tb, i) => ({ ...tb, seq: tb.seq ?? i })),
  }));
}

/**
 * Proportional column widths for the bottom panel.
 *
 * TradingView: a positive `width` in `table.cell()` is a relative proportion
 * of the table's total width (not a % of the panel). Cells stretch to fit the
 * allocated width without truncating text.
 */
export function bottomPanelColumnFractions(tb: PineTable): number[] {
  const cols = Math.max(1, tb.columns || 1);
  const weights = new Array<number>(cols).fill(1);
  for (const c of tb.cells || []) {
    if (c.col < 0 || c.col >= cols) continue;
    const w = c.width != null && Number.isFinite(c.width) && c.width > 0 ? c.width : 1;
    weights[c.col] = Math.max(weights[c.col]!, w);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return weights.map(() => 1 / Math.max(1, cols));
  return weights.map((w) => w / total);
}

/**
 * Whether any bottom-panel row declares a positive height hint.
 * When true the table stretches rows to fill the allocated pane height;
 * otherwise it uses the minimum height that fits the text.
 */
export function bottomPanelHasHeightHints(tb: PineTable): boolean {
  return (tb.cells || []).some((c) => c.height != null && c.height > 0);
}
