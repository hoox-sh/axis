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
 * Apply stage 2 — overlay line + OHLC payload building (F-25).
 *
 * Pure transforms extracted from `runAndApplyInner`: engine series →
 * LWC-ready line points and bar/candle overlays. Epoch supersession is
 * preserved (a newer run winning mid-build returns `superseded`).
 *
 * @module indicators/apply-overlays
 */

import type { RunResult } from './runner';
import { appendLog } from '../store';
import { PLOT_PALETTE } from '../chart/series-factory';
import { resolvePineColor } from '../results/pine-color';
import { lineDataHasSample, isRunEpochCurrent } from './run-helpers';
// NOTE: single documented cycle — runner.ts owns the series-window helpers
// and imports this stage module for orchestration (see apply-context.ts).
// All cross-uses happen inside function bodies at call time.
import { alignSeriesToTimes, tailAlignSeriesToWindow } from './runner';
import {
  lineSeriesToOverlayData,
  ohlcSeriesToBarData,
  plotDisplayHas,
  PLOT_DISPLAY,
  type splitSeriesByKind,
  type PlotMetaEntry,
} from '../results/plot-visuals';

export interface OverlayLine {
  name: string;
  data: { time: number; value?: number }[];
  color?: string;
  linewidth?: number;
  kind?: 'plot' | 'hline';
  price?: number;
  linestyle?: string;
  style?: string | null;
  histbase?: number;
  display?: string | number | null;
}

export interface OverlayOhlc {
  name: string;
  kind: 'plotbar' | 'plotcandle';
  data: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    color?: string;
  }>;
  color?: string;
}

export interface OverlayBuildContext {
  epoch: number;
  silent: boolean;
  result: RunResult;
  seriesEntries: ReadonlyArray<readonly [string, unknown[]]>;
  split: ReturnType<typeof splitSeriesByKind>;
  plotMeta: Record<string, PlotMetaEntry>;
  ohlcvTimes: number[];
  needsAlign: boolean;
  resultTimes: number[] | null;
  chartWindowBars: number;
  seriesMap: Record<string, unknown[] | (number | null)[]>;
  userPlotColors: Record<string, { color: string; custom?: boolean }>;
  scriptName: string;
}

export type OverlayBuildOutcome =
  | { superseded: true }
  | { superseded?: false; overlayLines: OverlayLine[]; overlayOhlc: OverlayOhlc[] };

/**
 * Overlay color precedence: panel override → resolved script color →
 * palette fallback. Pine forms (`color.red`, `color.new(…)`) resolve to
 * CSS; unresolvable/empty values fall through (never persist raw tokens).
 */
export function pickOverlayColor(
  userColor: unknown,
  metaColor: unknown,
  fallback: string | undefined,
): string | undefined {
  return resolvePineColor(userColor) ?? resolvePineColor(metaColor) ?? fallback;
}

/**
 * Map engine series → LWC points. Keep **one point per OHLCV bar**.
 * Leading/trailing Pine `na` become whitespace `{ time }` (no value) so the
 * indicator pane has the same logical bar count as price — otherwise
 * multi-pane time sync leaves a permanent gap at the indicator start.
 * Null/NaN/undefined/string "na"/non-finite never produce a numeric value.
 */
function toLineData(
  ohlcvTimes: number[],
  arr: (number | null)[] | unknown[],
): { time: number; value?: number }[] {
  return lineSeriesToOverlayData(ohlcvTimes, arr);
}

export function buildOverlayPayloads(ctx: OverlayBuildContext): OverlayBuildOutcome {
  const {
    epoch,
    silent,
    result,
    seriesEntries,
    split,
    plotMeta,
    ohlcvTimes,
    needsAlign,
    resultTimes,
    chartWindowBars,
    seriesMap,
    userPlotColors,
    scriptName,
  } = ctx;
  const overlayLines: OverlayLine[] = [];
  // Prefer named `series` + `meta.plot_meta` (PYNE modern). Top-level `plots[]`
  // is often an all-null pad of bar length — never let that block named lines.
  // User color overrides from Scripts panel (persisted on the script card)

  if (seriesEntries.length > 0) {
    let colorIdx = 0;
    for (const [k, arr] of seriesEntries) {
      // Large multi-plot payloads: bail early if a newer run won
      if (!isRunEpochCurrent(epoch)) {
        return { superseded: true };
      }
      const meta = plotMeta[k] || {};
      const kindRaw = String(meta?.kind || 'plot');
      const isHline = kindRaw === 'hline';
      const data = toLineData(ohlcvTimes, arr);
      // hline may still apply with price-only meta even if series is sparse
      let price: number | undefined =
        meta?.price != null && Number.isFinite(Number(meta.price))
          ? Number(meta.price)
          : undefined;
      if (price == null && isHline && data.length) {
        const first = data.find((d) => d.value != null && Number.isFinite(d.value));
        if (first?.value != null) price = first.value;
      }
      // Need at least one real sample (or hline price); pure-whitespace series skip
      if (!lineDataHasSample(data) && !(isHline && price != null)) continue;
      // display.data_window / display.none: keep series for Data Window, skip pane
      if (!plotDisplayHas(meta?.display, PLOT_DISPLAY.pane)) continue;
      // Prefer panel color override → Pine plot color → palette
      const color = pickOverlayColor(
        userPlotColors[k]?.color,
        meta?.color,
        PLOT_PALETTE[colorIdx % PLOT_PALETTE.length],
      );
      colorIdx += 1;
      overlayLines.push({
        name: k,
        data,
        color,
        linewidth: meta?.linewidth != null ? Number(meta.linewidth) : undefined,
        kind: isHline ? 'hline' : 'plot',
        price,
        linestyle: meta?.linestyle ? String(meta.linestyle) : undefined,
        style: meta?.style != null ? String(meta.style) : null,
        histbase:
          meta?.histbase != null && Number.isFinite(Number(meta.histbase))
            ? Number(meta.histbase)
            : undefined,
        display: (meta?.display as string | number | null | undefined) ?? null,
      });
    }
  } else if (Array.isArray(result.plots) && result.plots.length) {
    // Legacy single-array plots only when no named line series and no specialized kinds.
    // Skip all-null pads (modern engines still send plots: [null, …]).
    if (!split.bgcolors.length && !split.shapes.length && !split.ohlc.length) {
      const data = toLineData(
        ohlcvTimes,
        !needsAlign
          ? result.plots
          : resultTimes
            ? alignSeriesToTimes(result.plots, resultTimes, ohlcvTimes)
            : tailAlignSeriesToWindow(result.plots, chartWindowBars),
      );
      if (lineDataHasSample(data)) {
        const userColor =
          userPlotColors[scriptName]?.color ||
          Object.values(userPlotColors)[0]?.color;
        overlayLines.push({
          name: scriptName,
          data,
          color:
            resolvePineColor(userColor) ?? PLOT_PALETTE[0],
        });
      }
    }
  }

  // plotbar / plotcandle → LWC Bar / Candlestick overlays
  const overlayOhlc: OverlayOhlc[] = [];
  {
    let ohlcColorIdx = overlayLines.length;
    for (const { key, values, meta } of split.ohlc) {
      if (!isRunEpochCurrent(epoch)) {
        return { superseded: true };
      }
      if (!plotDisplayHas(meta?.display, PLOT_DISPLAY.pane)) continue;
      const data = ohlcSeriesToBarData(ohlcvTimes, values, seriesMap, meta);
      if (!data.length) continue;
      const color = pickOverlayColor(
        userPlotColors[key]?.color,
        meta?.color,
        PLOT_PALETTE[ohlcColorIdx % PLOT_PALETTE.length],
      );
      ohlcColorIdx += 1;
      const kind: 'plotbar' | 'plotcandle' =
        String(meta?.kind || '').toLowerCase() === 'plotcandle' ? 'plotcandle' : 'plotbar';
      overlayOhlc.push({ name: key, kind, data, color });
    }
  }

  // Empty bars / zero-length plots: still sync empty overlays so stale lines clear
  if (!ohlcvTimes.length && !silent) {
    appendLog('warn', 'Run finished with no bars — chart overlays cleared', 'plot');
  }
  return { overlayLines, overlayOhlc };
}
