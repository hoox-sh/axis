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
 * Compare / overlay a second symbol on the price pane.
 *
 * Pure align + normalize helpers (tested) plus imperative apply against
 * {@link PaneManager}. Compare series use fixed keys so indicator
 * `syncOverlayLines` (which only manages `overlay_*`) will not wipe them.
 *
 * @module chart/compare-overlay
 */

import type { ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Bar } from '../store/types';
import type { PaneManager } from './pane-manager';
import { createLineSeries, VOID } from './series-factory';
import { getSource } from '../sources/catalog';
import { pluginKey } from '../plugins/types';
import { clampHistoryBars, store } from '../store';
import { normalizeHistoricalBars } from '../data/parse-bars';
import { seriesLabelTitle } from './last-value-labels';

/** Line series key for the compare symbol (not under `overlay_`). */
export const COMPARE_SERIES_KEY = 'compare';
/** Optional main-as-% companion line when dual percent mode is on. */
export const COMPARE_MAIN_PCT_KEY = 'compare_main_pct';

/** Default stroke for the compare series (void orange). */
export const COMPARE_COLOR = VOID.orange;
/** Main series % companion when dual-normalizing. */
export const COMPARE_MAIN_PCT_COLOR = VOID.indigo;

/**
 * Built-in left price scale for absolute / solo-% compare so the main right
 * scale keeps the primary symbol's price range.
 */
export const COMPARE_PRICE_SCALE_ID = 'left';

export type TimedClose = { time: number; close: number };
export type LinePoint = { time: number; value: number };

export type CompareMode = 'percent' | 'absolute';

export type AlignedPair = {
  time: number;
  main: number;
  compare: number;
};

/**
 * Map bars (or close series) to timed closes. Skips non-finite closes.
 * Times are left as-is (expected unix seconds).
 */
export function extractCloses(
  bars: ReadonlyArray<{ time: number; close: number }>,
): TimedClose[] {
  const out: TimedClose[] = [];
  for (const b of bars) {
    if (!Number.isFinite(b.time) || !Number.isFinite(b.close)) continue;
    out.push({ time: b.time, close: b.close });
  }
  return out;
}

/**
 * Inner-join two close series on matching timestamps (sorted ascending).
 * Uses two-pointer scan — O(n + m).
 */
export function alignByTime(
  main: ReadonlyArray<TimedClose>,
  compare: ReadonlyArray<TimedClose>,
): AlignedPair[] {
  const a = [...main].sort((x, y) => x.time - y.time);
  const b = [...compare].sort((x, y) => x.time - y.time);
  const out: AlignedPair[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ta = a[i]!.time;
    const tb = b[j]!.time;
    if (ta === tb) {
      out.push({ time: ta, main: a[i]!.close, compare: b[j]!.close });
      i += 1;
      j += 1;
    } else if (ta < tb) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return out;
}

/**
 * Percent change from the first value in the list:
 * `(v / v0 - 1) * 100`. Empty or non-finite v0 → empty array.
 */
export function toPercentChange(values: ReadonlyArray<number>): number[] {
  if (!values.length) return [];
  const v0 = values[0]!;
  if (!Number.isFinite(v0) || v0 === 0) return [];
  return values.map((v) => ((v / v0) - 1) * 100);
}

/**
 * Align main + compare by time, then map both to % change from the first
 * common bar close (independent baselines per series).
 *
 * Formula per series: `(c / c0 - 1) * 100` where c0 is that series' close
 * at the first common timestamp.
 */
export function normalizeToPercent(
  mainBars: ReadonlyArray<{ time: number; close: number }>,
  compareBars: ReadonlyArray<{ time: number; close: number }>,
): { main: LinePoint[]; compare: LinePoint[]; baselineTime: number | null } {
  const aligned = alignByTime(extractCloses(mainBars), extractCloses(compareBars));
  if (!aligned.length) {
    return { main: [], compare: [], baselineTime: null };
  }
  const m0 = aligned[0]!.main;
  const c0 = aligned[0]!.compare;
  if (!Number.isFinite(m0) || m0 === 0 || !Number.isFinite(c0) || c0 === 0) {
    return { main: [], compare: [], baselineTime: null };
  }
  const main: LinePoint[] = [];
  const compare: LinePoint[] = [];
  for (const row of aligned) {
    main.push({ time: row.time, value: ((row.main / m0) - 1) * 100 });
    compare.push({ time: row.time, value: ((row.compare / c0) - 1) * 100 });
  }
  return { main, compare, baselineTime: aligned[0]!.time };
}

/**
 * Align by time and return absolute closes for both series (no % transform).
 */
export function alignAbsolute(
  mainBars: ReadonlyArray<{ time: number; close: number }>,
  compareBars: ReadonlyArray<{ time: number; close: number }>,
): { main: LinePoint[]; compare: LinePoint[] } {
  const aligned = alignByTime(extractCloses(mainBars), extractCloses(compareBars));
  return {
    main: aligned.map((r) => ({ time: r.time, value: r.main })),
    compare: aligned.map((r) => ({ time: r.time, value: r.compare })),
  };
}

/**
 * Build line data for the compare series given mode.
 * - percent: only compare as % from first common bar
 * - absolute: compare closes on common timestamps
 *
 * When `includeMainPercent` is true and mode is percent, also returns main %.
 */
export function buildCompareSeriesData(
  mainBars: ReadonlyArray<{ time: number; close: number }>,
  compareBars: ReadonlyArray<{ time: number; close: number }>,
  mode: CompareMode,
  includeMainPercent = false,
): { compare: LinePoint[]; mainPercent: LinePoint[] } {
  if (mode === 'absolute') {
    const { compare } = alignAbsolute(mainBars, compareBars);
    return { compare, mainPercent: [] };
  }
  const { main, compare } = normalizeToPercent(mainBars, compareBars);
  return {
    compare,
    mainPercent: includeMainPercent ? main : [],
  };
}

/** Remove compare series keys from the price pane (no-op if missing). */
export function clearCompareOverlay(manager: PaneManager | undefined | null): void {
  if (!manager) return;
  const pane = manager.getPane('price');
  if (!pane) return;
  for (const key of [COMPARE_SERIES_KEY, COMPARE_MAIN_PCT_KEY]) {
    const series = pane.series[key];
    if (!series) continue;
    try {
      pane.chart.removeSeries(series);
    } catch {
      /* ignore */
    }
    delete pane.series[key];
  }
  // Hide left scale again when no compare series remain
  try {
    pane.chart.priceScale(COMPARE_PRICE_SCALE_ID).applyOptions({ visible: false });
  } catch {
    /* ignore */
  }
}

function ensureCompareLine(
  pane: NonNullable<ReturnType<PaneManager['getPane']>>,
  key: string,
  title: string,
  color: string,
  priceScaleId: string,
): ISeriesApi<'Line'> {
  const existing = pane.series[key] as ISeriesApi<'Line'> | undefined;
  // Respect chart [N] last-value / name label preference
  let lastValueVisible = true;
  try {
    lastValueVisible = store.lastValueLabelsVisible !== false;
  } catch {
    lastValueVisible = true;
  }
  if (existing) {
    try {
      existing.applyOptions({
        color,
        title: seriesLabelTitle(title),
        priceScaleId,
        lastValueVisible,
        priceLineVisible: false,
      });
    } catch {
      /* ignore */
    }
    return existing;
  }
  const series = createLineSeries(pane.chart, title, color, undefined, 2);
  try {
    series.applyOptions({
      priceScaleId,
      lastValueVisible,
      priceLineVisible: false,
      title: seriesLabelTitle(title),
      color,
    });
  } catch {
    /* ignore */
  }
  pane.series[key] = series;
  return series;
}

function configureCompareScale(
  pane: NonNullable<ReturnType<PaneManager['getPane']>>,
  scaleId: string,
  mode: CompareMode,
): void {
  try {
    pane.chart.priceScale(scaleId).applyOptions({
      visible: true,
      borderVisible: true,
      borderColor: VOID.border,
      textColor: VOID.textDim,
      scaleMargins: { top: 0.08, bottom: 0.12 },
      entireTextOnly: false,
      minimumWidth: mode === 'percent' ? 56 : 72,
    });
  } catch {
    /* ignore */
  }
}

export type ApplyCompareOpts = {
  mainBars: ReadonlyArray<Bar>;
  compareBars: ReadonlyArray<Bar>;
  symbol: string;
  mode: CompareMode;
  /** When mode is percent, also paint main as % on the same scale. */
  normalizeMain?: boolean;
  color?: string;
};

/**
 * Create/update compare line series on the price pane.
 * Call {@link clearCompareOverlay} when compare is disabled.
 */
export function applyCompareOverlay(
  manager: PaneManager | undefined | null,
  opts: ApplyCompareOpts,
): void {
  if (!manager) return;
  const pane = manager.getPane('price');
  if (!pane) return;

  const mode = opts.mode === 'absolute' ? 'absolute' : 'percent';
  const normalizeMain = !!opts.normalizeMain && mode === 'percent';
  const { compare, mainPercent } = buildCompareSeriesData(
    opts.mainBars,
    opts.compareBars,
    mode,
    normalizeMain,
  );

  if (!compare.length) {
    clearCompareOverlay(manager);
    return;
  }

  const color = opts.color || COMPARE_COLOR;
  // Always use the left scale so main OHLC on the right keeps its price range.
  // Dual %: both % lines share the left scale.
  const scaleId = COMPARE_PRICE_SCALE_ID;

  const title =
    mode === 'percent' ? `${opts.symbol} %` : opts.symbol;

  const series = ensureCompareLine(pane, COMPARE_SERIES_KEY, title, color, scaleId);
  // Finite-only line data — LWC rejects NaN/Infinity
  const compareData = compare
    .filter((d) => Number.isFinite(d.time) && Number.isFinite(d.value))
    .map((d) => ({ time: d.time as UTCTimestamp, value: d.value }));
  try {
    series.setData(compareData);
  } catch {
    /* disposed / thrash */
  }

  if (normalizeMain && mainPercent.length) {
    const mainSeries = ensureCompareLine(
      pane,
      COMPARE_MAIN_PCT_KEY,
      'Main %',
      COMPARE_MAIN_PCT_COLOR,
      scaleId,
    );
    const mainData = mainPercent
      .filter((d) => Number.isFinite(d.time) && Number.isFinite(d.value))
      .map((d) => ({ time: d.time as UTCTimestamp, value: d.value }));
    try {
      mainSeries.setData(mainData);
    } catch {
      /* disposed / thrash */
    }
  } else {
    const extra = pane.series[COMPARE_MAIN_PCT_KEY];
    if (extra) {
      try {
        pane.chart.removeSeries(extra);
      } catch {
        /* ignore */
      }
      delete pane.series[COMPARE_MAIN_PCT_KEY];
    }
  }

  configureCompareScale(pane, scaleId, mode);
}

/**
 * Fetch OHLCV for a compare symbol via the active source plugin.
 * Does **not** touch `store.bars` / chart main series.
 */
export async function fetchCompareBars(
  symbol: string,
  interval: string = store.interval,
  sourceId: string = store.source,
): Promise<Bar[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) throw new Error('Compare symbol required');
  const source = getSource(sourceId);
  if (!source) throw new Error(`Unknown source: ${sourceId}`);

  const limit = clampHistoryBars(store.historyBars);
  const configs = store.pluginsConfig || {};
  const sourceCfg =
    configs[pluginKey('source', sourceId)] || configs[sourceId] || {};

  const bars = await source.fetchHistorical({
    symbol: sym,
    interval,
    config: {
      ...sourceCfg,
      limit,
    },
  });
  if (!bars?.length) throw new Error('Compare source returned no bars');

  // Same sanitize/limit path as load-symbol so partial OHLCV cannot poison compare
  const normalized = normalizeHistoricalBars(bars, { limit });
  if (!normalized.length) throw new Error('Compare source returned no valid bars');
  return normalized;
}
