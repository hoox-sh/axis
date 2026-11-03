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

/** Custom editor viewType — keep in sync with package.json contributes.customEditors. */
export const CHART_VIEW_TYPE = 'axis.chart';

/** Chart workspace document schema id (design §5). */
export const CHART_SCHEMA = 'axis.chart.v1';

/**
 * Minimum historyBars after coerce. Values ≤0 normalize to the schema default
 * (not 0) so empty/negative windows fall through to setting resolution cleanly.
 */
export const HISTORY_BARS_MIN = 1;

export interface AxisChartPaneV1 {
  id: string;
  kind: string;
}

/** Persisted `*.axis.json` shape (bars stay ephemeral). */
export interface AxisChartDocV1 {
  schema: string;
  symbol: string;
  exchange: string;
  market: string;
  interval: string;
  historyBars: number;
  chartType: string;
  theme: string;
  panes: AxisChartPaneV1[];
  scripts: unknown[];
  drawings: unknown[];
  engine: string;
  source: string;
}

export type ParseChartOk = { ok: true; doc: AxisChartDocV1 };
export type ParseChartErr = { ok: false; error: string };
export type ParseChartResult = ParseChartOk | ParseChartErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Empty chart workspace used for blank / minimal JSON objects. */
export function defaultChartDocument(): AxisChartDocV1 {
  return {
    schema: CHART_SCHEMA,
    symbol: '',
    exchange: '',
    market: 'spot',
    interval: '1m',
    historyBars: 1500,
    chartType: 'candles',
    theme: 'void',
    panes: [{ id: 'price', kind: 'price' }],
    scripts: [],
    drawings: [],
    engine: 'server',
    source: '',
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asHistoryBars(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  // ≤0 / sub-min → schema default (fallback), never persist an empty/negative window.
  const n = Math.floor(value);
  return n < HISTORY_BARS_MIN ? fallback : n;
}

function asArray(value: unknown, fallback: unknown[]): unknown[] {
  return Array.isArray(value) ? value : fallback;
}

function normalizePanes(value: unknown, fallback: AxisChartPaneV1[]): AxisChartPaneV1[] {
  if (!Array.isArray(value)) return fallback.map((p) => ({ ...p }));
  const out: AxisChartPaneV1[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const id = typeof entry.id === 'string' ? entry.id : '';
    const kind = typeof entry.kind === 'string' ? entry.kind : '';
    if (!id || !kind) continue;
    out.push({ id, kind });
  }
  return out.length > 0 ? out : fallback.map((p) => ({ ...p }));
}

function normalizeSchema(value: unknown): string {
  const schema = asString(value, CHART_SCHEMA).trim();
  // Unknown / empty schema → canonical v1 (loose reader; bump later with compat table).
  if (!schema || schema !== CHART_SCHEMA) return CHART_SCHEMA;
  return schema;
}

/**
 * Merge a plain JSON object into a full chart doc (loose `axis.chart.v1`).
 * Missing fields take defaults; unknown keys are dropped.
 */
export function normalizeChartDocument(raw: Record<string, unknown>): AxisChartDocV1 {
  const base = defaultChartDocument();
  return {
    schema: normalizeSchema(raw.schema),
    symbol: asString(raw.symbol, base.symbol),
    exchange: asString(raw.exchange, base.exchange),
    market: asString(raw.market, base.market),
    interval: asString(raw.interval, base.interval),
    historyBars: asHistoryBars(raw.historyBars, base.historyBars),
    chartType: asString(raw.chartType, base.chartType),
    theme: asString(raw.theme, base.theme),
    panes: normalizePanes(raw.panes, base.panes),
    scripts: asArray(raw.scripts, base.scripts),
    drawings: asArray(raw.drawings, base.drawings),
    engine: asString(raw.engine, base.engine),
    source: asString(raw.source, base.source),
  };
}

/**
 * Parse file text (or a plain object) into a chart document. Never throws.
 * Empty / whitespace string → default doc.
 * Non-string / non-plain-object roots (arrays, null, numbers, …) → error.
 * Invalid JSON text → error (callers must not Save over a broken file silently).
 */
export function parseChartDocument(raw: unknown): ParseChartResult {
  try {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      return { ok: true, doc: normalizeChartDocument(raw as Record<string, unknown>) };
    }
    if (typeof raw !== 'string') {
      return {
        ok: false,
        error: 'chart document source must be a string or plain object',
      };
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: true, doc: defaultChartDocument() };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `invalid JSON: ${message}` };
    }
    if (!isPlainObject(parsed)) {
      return { ok: false, error: 'chart document must be a JSON object' };
    }
    return { ok: true, doc: normalizeChartDocument(parsed) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `parse failed: ${message}` };
  }
}

/** Serialize a chart document (stable key order, trailing newline). */
export function serializeChartDocument(doc: AxisChartDocV1): string {
  const payload: AxisChartDocV1 = {
    schema: doc.schema,
    symbol: doc.symbol,
    exchange: doc.exchange,
    market: doc.market,
    interval: doc.interval,
    historyBars: doc.historyBars,
    chartType: doc.chartType,
    theme: doc.theme,
    panes: doc.panes,
    scripts: doc.scripts,
    drawings: doc.drawings,
    engine: doc.engine,
    source: doc.source,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
