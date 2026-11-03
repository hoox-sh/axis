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
 * Pure chart webview reducer — apply chart.init / chart.full / chart.delta.
 * Bar wire shape matches host mock: `{ time, open, high, low, close, volume? }`
 * (also accepts short keys t/o/h/l/c/v).
 *
 * Seq gap on `chart.delta` → `requestReload: true` (post `chart.requestReload`).
 */

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** MVP user trendline (mirrors host CommittedTrendlineDrawing). */
export interface UserDrawing {
  id: string;
  tool: 'trendline';
  points: [{ time: number; price: number }, { time: number; price: number }];
}

export interface ChartPlugins {
  source?: string;
  stream?: string;
  engine?: string;
  storage?: string;
}

/** One overlay line aligned to candle times (Pine `plot` / named `series`). */
export type ChartPlotLine = {
  id: string;
  values: (number | null)[];
};

export interface ChartViewState {
  seriesKey: string;
  theme: string;
  panes: unknown;
  bars: ChartBar[];
  /** User drawings from chart.init / user-shaped chart.full batches. */
  drawings: UserDrawing[];
  /** Script plots from `chart.full` (painted as LWC line overlays). */
  plots: ChartPlotLine[];
  seq: number;
  ready: boolean;
  /** Active plugin ids (HUD chips); omitted until chart.init / host.run.status. */
  plugins?: ChartPlugins;
}

/** Outcome of one host message — gap sets `requestReload`. */
export type ChartReduceOutcome = {
  state: ChartViewState;
  /** Webview should post `chart.requestReload` (seq gap / unsafe delta). */
  requestReload: boolean;
};

export function initialChartState(): ChartViewState {
  return {
    seriesKey: '',
    theme: '',
    panes: null,
    bars: [],
    drawings: [],
    plots: [],
    seq: 0,
    ready: false,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sampleToNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (isPlainObject(raw)) {
    return num(raw.value) ?? num(raw.v) ?? num(raw.close);
  }
  return null;
}

function numericColumn(raw: unknown): (number | null)[] | null {
  if (!Array.isArray(raw)) return null;
  const values = raw.map(sampleToNumber);
  if (!values.some((v) => v !== null)) return null;
  return values;
}

/**
 * Flatten engine `plots` / `series` into overlay lines (never throws).
 * Accepts a number[], list of columns, or `{ name: number[] }` maps.
 */
export function normalizePlotLines(plots: unknown, series?: unknown): ChartPlotLine[] {
  try {
    const out: ChartPlotLine[] = [];
    const seen = new Set<string>();
    const push = (id: string, values: (number | null)[]): void => {
      const key = id.trim() || `plot${out.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: key, values });
    };
    if (Array.isArray(plots)) {
      const asColumn = numericColumn(plots);
      const looksNested = plots.some((p) => Array.isArray(p) || isPlainObject(p));
      if (asColumn && !looksNested) {
        push('plot', asColumn);
      } else {
        plots.forEach((entry, i) => {
          if (Array.isArray(entry)) {
            const col = numericColumn(entry);
            if (col) push(`plot${i}`, col);
            return;
          }
          if (isPlainObject(entry)) {
            const id =
              typeof entry.id === 'string'
                ? entry.id
                : typeof entry.title === 'string'
                  ? entry.title
                  : `plot${i}`;
            const col = numericColumn(entry.values ?? entry.data ?? entry.y);
            if (col) push(id, col);
          }
        });
      }
    } else if (isPlainObject(plots)) {
      for (const [key, value] of Object.entries(plots)) {
        const col = numericColumn(value);
        if (col) push(key, col);
      }
    }
    if (isPlainObject(series)) {
      for (const [key, value] of Object.entries(series)) {
        const col = numericColumn(value);
        if (col) push(key, col);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function normalizeDrawingPoint(raw: unknown): { time: number; price: number } | null {
  if (!isPlainObject(raw)) return null;
  const time = num(raw.time) ?? num(raw.t);
  const price = num(raw.price) ?? num(raw.p);
  if (time === null || price === null) return null;
  return { time, price };
}

/**
 * True when a drawings batch is user-tool shaped (empty or every entry has `tool`).
 * Script/engine batches omit `tool` and must not wipe user drawings.
 */
export function isUserDrawingBatch(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  if (raw.length === 0) return true;
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.tool !== 'string') return false;
  }
  return true;
}

/** Keep only valid MVP trendlines. */
export function normalizeUserDrawings(raw: unknown): UserDrawing[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: UserDrawing[] = [];
    for (const entry of raw) {
      if (!isPlainObject(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const tool = typeof entry.tool === 'string' ? entry.tool.trim() : '';
      if (!id || tool !== 'trendline' || !Array.isArray(entry.points) || entry.points.length < 2) {
        continue;
      }
      const a = normalizeDrawingPoint(entry.points[0]);
      const b = normalizeDrawingPoint(entry.points[1]);
      if (!a || !b) continue;
      out.push({ id, tool: 'trendline', points: [a, b] });
    }
    return out;
  } catch {
    return [];
  }
}

/** Normalize one bar; returns null when OHLC/time are unusable. */
export function normalizeBar(raw: unknown): ChartBar | null {
  try {
    if (!isPlainObject(raw)) return null;
    const time = num(raw.time) ?? num(raw.t);
    const open = num(raw.open) ?? num(raw.o);
    const high = num(raw.high) ?? num(raw.h);
    const low = num(raw.low) ?? num(raw.l);
    const close = num(raw.close) ?? num(raw.c);
    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null
    ) {
      return null;
    }
    const volume = num(raw.volume) ?? num(raw.v) ?? undefined;
    const bar: ChartBar = { time, open, high, low, close };
    if (volume !== undefined) bar.volume = volume;
    return bar;
  } catch {
    return null;
  }
}

/** Replace-series normalize for chart.full.bars (skips invalid entries). */
export function normalizeBars(raw: unknown): ChartBar[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: ChartBar[] = [];
    for (const entry of raw) {
      const bar = normalizeBar(entry);
      if (bar) out.push(bar);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge `tail` onto `bars` at `baseIndex` (slice head + concat tail).
 * Returns null when baseIndex is out of range.
 */
export function mergeBarTail(
  bars: ChartBar[],
  baseIndex: number,
  tail: ChartBar[],
): ChartBar[] | null {
  if (!Number.isFinite(baseIndex) || baseIndex < 0 || baseIndex > bars.length) {
    return null;
  }
  if (baseIndex === 0) return tail.slice();
  return bars.slice(0, baseIndex).concat(tail);
}

/**
 * Classify delta seq vs last applied seq.
 * - continuous: seq === lastSeq + 1
 * - duplicate: seq === lastSeq
 * - gap: anything else (including delta before first full)
 */
export function classifyDeltaSeq(
  lastSeq: number,
  seq: number,
): 'continuous' | 'duplicate' | 'gap' {
  if (!(typeof lastSeq === 'number' && Number.isFinite(lastSeq))) return 'gap';
  if (!(typeof seq === 'number' && Number.isFinite(seq))) return 'gap';
  if (lastSeq <= 0) return 'gap';
  if (seq === lastSeq + 1) return 'continuous';
  if (seq === lastSeq) return 'duplicate';
  return 'gap';
}

const PLUGIN_CHIP_ORDER = [
  ['source', 'src'],
  ['stream', 'stm'],
  ['engine', 'eng'],
  ['storage', 'sto'],
] as const;

/** Normalize plugin ids; unknown keys ignored. Arrays / non-objects → undefined. */
export function pickChartPlugins(raw: unknown): ChartPlugins | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: ChartPlugins = {};
  for (const [key] of PLUGIN_CHIP_ORDER) {
    const v = raw[key];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

/** Chip specs for the toolbar strip; empty ids omitted. */
export function pluginChipSpecs(
  plugins: ChartPlugins | undefined,
): Array<{
  kind: (typeof PLUGIN_CHIP_ORDER)[number][0];
  prefix: (typeof PLUGIN_CHIP_ORDER)[number][1];
  id: string;
}> {
  if (!plugins) return [];
  const out: Array<{
    kind: (typeof PLUGIN_CHIP_ORDER)[number][0];
    prefix: (typeof PLUGIN_CHIP_ORDER)[number][1];
    id: string;
  }> = [];
  for (const [kind, prefix] of PLUGIN_CHIP_ORDER) {
    const id = plugins[kind];
    if (typeof id === 'string' && id.trim()) {
      out.push({ kind, prefix, id: id.trim() });
    }
  }
  return out;
}

function applyDelta(
  state: ChartViewState,
  payload: Record<string, unknown>,
): ChartReduceOutcome {
  const seq = num(payload.seq);
  const baseIndex = num(payload.baseIndex) ?? num(payload.base_index);
  if (seq === null || baseIndex === null || !('tail' in payload)) {
    // Malformed — ignore without thrashing reload.
    return { state, requestReload: false };
  }

  const kind = classifyDeltaSeq(state.seq, seq);
  if (kind === 'duplicate') {
    return { state, requestReload: false };
  }
  if (kind === 'gap') {
    return { state, requestReload: true };
  }

  const tail = normalizeBars(payload.tail);
  const merged = mergeBarTail(state.bars, baseIndex, tail);
  if (merged === null) {
    return { state, requestReload: true };
  }
  return {
    state: { ...state, bars: merged, seq },
    requestReload: false,
  };
}

/**
 * Apply one decoded host message. Unknown types leave state unchanged.
 * `chart.full` replaces `bars` + `seq`.
 * `chart.delta` merges `tail` at `baseIndex`; seq gap → `requestReload`.
 */
export function applyChartHostMessage(
  state: ChartViewState,
  type: string,
  payload: Record<string, unknown>,
): ChartReduceOutcome {
  try {
    if (type === 'chart.init') {
      const drawings =
        'drawings' in payload ? normalizeUserDrawings(payload.drawings) : [];
      const next: ChartViewState = {
        ...state,
        ready: true,
        // Clear prior series on re-init; chart.full (possibly empty) follows.
        bars: [],
        plots: [],
        seq: 0,
        drawings,
        theme: typeof payload.theme === 'string' ? payload.theme : state.theme,
        seriesKey:
          typeof payload.seriesKey === 'string' ? payload.seriesKey : state.seriesKey,
        panes: 'panes' in payload ? payload.panes : state.panes,
      };
      if ('plugins' in payload) {
        const plugins = pickChartPlugins(payload.plugins);
        if (plugins) next.plugins = plugins;
      }
      return {
        state: next,
        requestReload: false,
      };
    }
    if (type === 'chart.full') {
      const seq = num(payload.seq);
      const next: ChartViewState = {
        ...state,
        bars: normalizeBars(payload.bars),
        plots: normalizePlotLines(payload.plots, payload.series),
        seq: seq === null ? state.seq : seq,
      };
      // Only replace user drawings when the batch is user-tool shaped.
      if ('drawings' in payload && isUserDrawingBatch(payload.drawings)) {
        next.drawings = normalizeUserDrawings(payload.drawings);
      }
      return { state: next, requestReload: false };
    }
    if (type === 'chart.delta') {
      return applyDelta(state, payload);
    }
    if (type === 'host.run.status') {
      if (!('plugins' in payload)) {
        return { state, requestReload: false };
      }
      const plugins = pickChartPlugins(payload.plugins);
      if (!plugins) {
        return { state, requestReload: false };
      }
      return { state: { ...state, plugins }, requestReload: false };
    }
    return { state, requestReload: false };
  } catch {
    return { state, requestReload: false };
  }
}

/**
 * Apply one decoded host message (state only). Prefer {@link applyChartHostMessage}
 * when the caller must honour seq-gap → `chart.requestReload`.
 */
export function reduceChartMessage(
  state: ChartViewState,
  type: string,
  payload: Record<string, unknown>,
): ChartViewState {
  return applyChartHostMessage(state, type, payload).state;
}
