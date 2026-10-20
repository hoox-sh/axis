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
 * Apply stage 3 — chart mutations for overlay payloads (F-25).
 *
 * LWC series mutations extracted from `runAndApplyInner`: overlay lines,
 * OHLC overlays, badges, bgcolor bands, fills, shape markers, barcolors and
 * the non-overlay price-pane repair. Called inside the orchestrator's chart
 * fence (LWC throws must not reject the run).
 *
 * @module indicators/apply-mutations
 */

import { appendLog, EDITOR_RUN_KEY } from '../store';
import { getActiveDrawingLayer } from '../chart/drawing-layer';
import { ensureScriptPaneLayer } from '../chart/manager-access';
import type { PaneManager } from '../chart/pane-manager';
import {
  barcolorSeriesToMap,
  bgcolorSeriesToHistogramData,
  plotDisplayHas,
  PLOT_DISPLAY,
  resolvePlotFillBands,
  shapeSeriesToMarkers,
  type PlotMetaEntry,
} from '../results/plot-visuals';
import type { OverlayLine, OverlayOhlc } from './apply-overlays';
import type { splitSeriesByKind } from '../results/plot-visuals';
import { tailAlignSeriesToWindow } from './runner';

export interface ChartMutationContext {
  manager: PaneManager;
  paneId: string;
  overlay: boolean;
  overlayLines: OverlayLine[];
  overlayOhlc: OverlayOhlc[];
  split: ReturnType<typeof splitSeriesByKind>;
  plotMeta: Record<string, PlotMetaEntry>;
  seriesMap: Record<string, unknown[] | (number | null)[]>;
  ohlcvTimes: number[];
  silent: boolean;
  indicatorId: string | undefined;
  forceFull: boolean;
}

export function applyChartMutations(ctx: ChartMutationContext): void {
  const overlayOwner = {
    ownerId: ctx.indicatorId ?? EDITOR_RUN_KEY,
    forceFull: ctx.forceFull,
  };
  ctx.manager.syncOverlayLines(ctx.paneId, ctx.overlayLines, overlayOwner);
  // plotbar / plotcandle OHLC overlays (empty list clears this owner’s OHLC)
  if (typeof ctx.manager.syncOverlayOhlc === 'function') {
    ctx.manager.syncOverlayOhlc(ctx.paneId, ctx.overlayOhlc, overlayOwner);
  }
  if (ctx.overlayOhlc.length && !ctx.silent) {
    appendLog(
      'ok',
      `plot OHLC: ${ctx.overlayOhlc.map((o) => `${o.name}(${o.kind})`).join(', ')}`,
      'plot',
    );
  }
  // Refresh corner badges (name + settings / eye / re-run / remove)
  try {
    ctx.manager.refreshBadges?.(ctx.paneId);
    if (ctx.paneId !== 'price') ctx.manager.refreshBadges?.('price');
  } catch {
    /* badges optional */
  }

  // bgcolor → histogram underlay on the script pane (price when overlay)
  const bgBands = ctx.split.bgcolors
    .filter(({ meta }) => plotDisplayHas(meta.display, PLOT_DISPLAY.pane))
    .map(({ key, values, meta }) => ({
      name: key,
      title: meta.title || key,
      data: bgcolorSeriesToHistogramData(ctx.ohlcvTimes, values, meta.color),
    }))
    .filter((b) => b.data.length > 0);
  ctx.manager.syncBgcolorBands(bgBands, {
    ...overlayOwner,
    paneId: ctx.overlay ? 'price' : ctx.paneId,
  });
  if (bgBands.length && !ctx.silent) {
    appendLog('ok', `bgcolor: ${bgBands.length} band series`, 'plot');
  }

  // fill(plot1, plot2, color=…) → SVG band on the script pane (price when overlay)
  const fillBands = resolvePlotFillBands(ctx.seriesMap, ctx.plotMeta).filter((f) =>
    plotDisplayHas(ctx.plotMeta[f.name]?.display, PLOT_DISPLAY.pane),
  );
  try {
    const priceLayer = getActiveDrawingLayer();
    const paneLayer =
      !ctx.overlay && ctx.paneId !== 'price' ? ensureScriptPaneLayer(ctx.paneId) : undefined;
    const layer = paneLayer ?? priceLayer;
    // The non-target layer may still hold this owner's fills from a prior
    // ctx.overlay toggle — clear it so fills don't duplicate / stay stale.
    const other = paneLayer ? priceLayer : undefined;
    if (other && other !== layer) {
      try {
        other.clearPlotFills?.(ctx.indicatorId ?? EDITOR_RUN_KEY);
      } catch {
        /* optional */
      }
    }
    if (layer?.setPlotFills) {
      if (fillBands.length) {
        const times: number[] = new Array(ctx.ohlcvTimes.length);
        let tn = 0;
        for (let i = 0; i < ctx.ohlcvTimes.length; i++) {
          const t = ctx.ohlcvTimes[i];
          const n = typeof t === 'number' ? t : Number(t);
          if (!Number.isFinite(n)) continue;
          times[tn++] = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
        }
        times.length = tn;
        const axisLen = times.length;
        layer.setPlotFills(
          fillBands.map((f) => ({
            name: f.name,
            times,
            // Index zip: pin the tail so a shorter series still covers the last bars.
            upper: tailAlignSeriesToWindow(f.upper, axisLen) as (number | null)[],
            lower: tailAlignSeriesToWindow(f.lower, axisLen) as (number | null)[],
            colors: f.colors
              ? (tailAlignSeriesToWindow(f.colors, axisLen) as (string | null)[])
              : f.colors,
            color: f.color,
          })),
          ctx.indicatorId ?? EDITOR_RUN_KEY,
        );
        if (!ctx.silent) {
          appendLog(
            'ok',
            `fill: ${fillBands.map((f) => `${f.name}(${f.plot1}↔${f.plot2})`).join(', ')}`,
            'plot',
          );
        }
      } else {
        layer.clearPlotFills?.(ctx.indicatorId ?? EDITOR_RUN_KEY);
      }
    }
  } catch {
    /* drawing layer optional in tests */
  }

  // plotshape / plotchar → markers (owner-scoped so multi-script runs keep others)
  const shapeMarkers = ctx.split.shapes
    .filter(({ meta }) => plotDisplayHas(meta.display, PLOT_DISPLAY.pane))
    .flatMap(({ key, values, meta }) =>
      shapeSeriesToMarkers(ctx.ohlcvTimes, values, meta, { idPrefix: key }),
    );
  const shapeOwner = ctx.indicatorId ?? EDITOR_RUN_KEY;
  if (shapeMarkers.length || ctx.split.shapes.length) {
    ctx.manager.setShapeMarkers(
      shapeMarkers,
      shapeOwner,
      ctx.overlay ? 'price' : ctx.paneId,
    );
  }
  if (shapeMarkers.length && !ctx.silent) {
    appendLog('ok', `plotshape: ${shapeMarkers.length} marker(s)`, 'plot');
  }

  // barcolor() → tint price candles (LWC per-bar color fields).
  // Last script with barcolor wins; runs without barcolor do not clear
  // (history reload / clearChartScriptState clears via clearBarColors).
  try {
    if (ctx.split.barcolors?.length) {
      const paneBarcolors = ctx.split.barcolors.filter(({ meta }) =>
        plotDisplayHas(meta?.display, PLOT_DISPLAY.pane),
      );
      const colorMap = barcolorSeriesToMap(ctx.ohlcvTimes, paneBarcolors);
      const n = ctx.manager.applyBarColors?.(colorMap, ctx.indicatorId ?? EDITOR_RUN_KEY) ?? 0;
      if (n > 0 && !ctx.silent) {
        appendLog('ok', `barcolor: ${n} bar(s) tinted`, 'plot');
      }
    }
  } catch {
    /* barcolor optional on older managers */
  }

  // Non-overlay scripts must not leave series on the price pane
  // (legacy unowned + this owner’s keys from a prior ctx.overlay=true run)
  if (!ctx.overlay && ctx.paneId !== 'price') {
    const owner = ctx.indicatorId ?? EDITOR_RUN_KEY;
    try {
      ctx.manager.removeOverlaysForOwner?.('price', owner, { keepMarkers: true });
      // Also drop legacy unowned keys for these plot names
      const pricePane = ctx.manager.getPane('price');
      if (pricePane) {
        for (const line of ctx.overlayLines) {
          const key = `ctx.overlay_${line.name}`;
          if (pricePane.series[key]) {
            try {
              pricePane.chart.removeSeries(pricePane.series[key]);
            } catch {
              /* ignore */
            }
            delete pricePane.series[key];
          }
        }
        for (const o of ctx.overlayOhlc) {
          const key = `ctx.overlay_ohlc_${o.name}`;
          if (pricePane.series[key]) {
            try {
              pricePane.chart.removeSeries(pricePane.series[key]);
            } catch {
              /* ignore */
            }
            delete pricePane.series[key];
          }
        }
      }
    } catch {
      /* ctx.manager optional */
    }
  }

  auditChartTimeParity(ctx.manager);
}

/**
 * Report series whose bar times diverge from the candle axis.
 *
 * The library's shared time scale is the union of every series' rows, so a
 * co-painted series that holds a bar the candles do not have makes the
 * renderer fail with `Value is null` — with no clue about which series did
 * it. The audit names it. Throttled per issue so a persistent divergence
 * cannot flood the log.
 */
const parityReported = new Map<string, number>();

function auditChartTimeParity(manager: PaneManager): void {
  let issues: string[] = [];
  try {
    issues = manager.auditTimeParity?.() ?? [];
  } catch {
    return;
  }
  if (!issues.length) return;
  const now = Date.now();
  for (const issue of issues) {
    const last = parityReported.get(issue) ?? 0;
    if (now - last < 30_000) continue;
    parityReported.set(issue, now);
    appendLog('warn', `time axis drift: ${issue}`, 'chart');
  }
}
