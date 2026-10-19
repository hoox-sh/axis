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
 * Apply stage 6 — indicator store update (F-25).
 *
 * Final store mutations extracted from `runAndApplyInner`: engine-exported
 * inputs capture, series cache for cross-indicator `input.source`, and the
 * add/replace indicator record (including the new-script re-own dance that
 * migrates EDITOR_RUN_KEY artifacts to the real script id).
 *
 * Returns `false` when superseded (caller returns the superseded result).
 * The final `return result` stays in the orchestrator.
 *
 * @module indicators/apply-store
 */

import {
  addIndicator,
  appendLog,
  setIndicatorSeries,
  setStatus,
  setLastRun,
  setStore,
  store,
  updateIndicator,
  EDITOR_RUN_KEY,
} from '../store';
import { getManager, getDrawingLayer, ensureScriptPaneLayer } from '../chart/manager-access';
import { getActiveDrawingLayer } from '../chart/drawing-layer';
import {
  bgcolorSeriesToHistogramData,
  type splitSeriesByKind,
  type PlotMetaEntry,
} from '../results/plot-visuals';
import { PLOT_PALETTE } from '../chart/series-factory';
import { plotDisplayHas, PLOT_DISPLAY } from '../results/plot-visuals';
import { normalizeStrategyEvents, eventsToMarkers } from '../results/events';
import { resolvePineColor } from '../results/pine-color';
import type { RunOptions, RunResult } from './runner';
import type { OverlayLine, OverlayOhlc } from './apply-overlays';
import type { Bar } from '../store/types';
import type { PlotSample } from '../plugins/types';

export interface StoreUpdateContext {
  epoch: number;
  result: RunResult;
  silent: boolean;
  indicatorId: string | undefined;
  opts: RunOptions;
  script: string;
  paneId: string;
  overlay: boolean;
  existing: { plots?: Record<string, { color: string; custom?: boolean }>; inputValues?: Record<string, unknown>; strategyProps?: Record<string, unknown> } | undefined;
  overlayLines: OverlayLine[];
  overlayOhlc: OverlayOhlc[];
  split: ReturnType<typeof splitSeriesByKind>;
  ohlcvTimes: number[];
  seriesMap: Record<string, unknown[] | (number | null)[]>;
  plotMeta: Record<string, PlotMetaEntry>;
  seriesEntries: ReadonlyArray<readonly [string, unknown[]]>;
  scriptName: string;
  bars: Bar[];
}

// NOTE: single documented cycle — runner.ts owns `nonemptyBag` /
// `withAxisSource` and imports this stage module for orchestration.
import { formatRunError, isRunEpochCurrent } from './run-helpers';
import { reportUiError } from '../ui/boot-errors';
// NOTE: single documented cycle — runner.ts owns `nonemptyBag` /
// `withAxisSource` and imports this stage module for orchestration.
import { nonemptyBag, withAxisSource } from './runner';

export function updateIndicatorStore(ctx: StoreUpdateContext): boolean {
  // Final epoch gate before store mutations (indicator list / series cache)
  if (!isRunEpochCurrent(ctx.epoch)) return false;

  // Capture engine-exported inputs into lastRun meta for Script Settings
  const engineInputs =
    (ctx.result as { inputs?: unknown }).inputs ??
    ctx.result.meta?.inputs;
  if (engineInputs && ctx.result.meta) {
    ctx.result.meta = { ...ctx.result.meta, inputs: engineInputs };
  }

  // Cache line plots for cross-indicator input.source (exclude hline-only noise)
  const seriesForCache: Record<string, PlotSample[]> = {};
  const titlesForCache: Record<string, string> = {};
  for (const [k, arr] of ctx.seriesEntries) {
    seriesForCache[k] = (Array.isArray(arr) ? arr : []) as (number | null)[];
    const meta = ctx.plotMeta[k];
    const title = meta?.title != null ? String(meta.title) : k;
    titlesForCache[k] = title;
  }
  // The bar times the cached series is aligned to. A consumer re-joins by
  // time: the chart window slides, so the cached series is one bar behind
  // the window it was written for and an index zip would shift every value.
  const timesForCache = ctx.ohlcvTimes.slice();

  try {
    if (ctx.indicatorId === undefined) {
      const plots: Record<string, { color: string }> = {};
      let colorIdx = 0;
      if (ctx.seriesEntries.length) {
        for (const [k] of ctx.seriesEntries) {
          const meta = ctx.plotMeta[k];
          plots[k] = {
            // Persist resolved CSS only — raw Pine tokens are invalid in
            // the card swatch and would shadow later runs as overrides.
            color:
              resolvePineColor(meta?.color) ??
              PLOT_PALETTE[colorIdx % PLOT_PALETTE.length],
          };
          colorIdx += 1;
        }
      } else {
        plots[ctx.scriptName] = { color: PLOT_PALETTE[0] };
      }
      // Prefer original ctx.opts/editor overrides (plot refs), not engine-expanded arrays
      const savedInputs =
        nonemptyBag(ctx.opts.inputs) ??
        (ctx.opts.skipEditorDraft ? undefined : nonemptyBag(store.editorInputValues));
      const savedStrategyProps =
        nonemptyBag(ctx.opts.strategyProps) ??
        (ctx.opts.skipEditorDraft
          ? undefined
          : nonemptyBag(store.editorStrategyProps));
      const newId = addIndicator(
        ctx.scriptName,
        ctx.script,
        ctx.paneId,
        plots,
        savedInputs && Object.keys(savedInputs).length ? savedInputs : undefined,
        savedStrategyProps && Object.keys(savedStrategyProps).length
          ? savedStrategyProps
          : undefined,
      );
      // Run cache was under EDITOR_RUN_KEY — migrate so tables/results follow
      // the real ctx.script id and delete clears them with the card.
      try {
        setLastRun(withAxisSource(ctx.result, ctx.script), {
          scriptId: newId,
          focus: !ctx.silent,
          persistence: ctx.silent || ctx.opts.liveTick ? 'skip' : 'auto',
        });
        setLastRun(null, { scriptId: EDITOR_RUN_KEY });
      } catch {
        /* store optional */
      }
      // Chart series were applied under EDITOR_RUN_KEY — re-own under the real
      // ctx.script id so the next reapply/live run does not stack a second copy
      // (identical last-value labels: "last" + "current" on the right scale).
      // Also re-own strategy trade markers so remove(id) clears long/short labels.
      try {
        const mgr = getManager();
        if (mgr?.getPane?.(ctx.paneId) && isRunEpochCurrent(ctx.epoch)) {
          mgr.removeOverlaysForOwner?.(ctx.paneId, EDITOR_RUN_KEY, { keepMarkers: true });
          mgr.syncOverlayLines?.(ctx.paneId, ctx.overlayLines, { ownerId: newId });
          if (typeof mgr.syncOverlayOhlc === 'function') {
            mgr.syncOverlayOhlc(ctx.paneId, ctx.overlayOhlc, { ownerId: newId });
          }
          if (typeof mgr.syncBgcolorBands === 'function') {
            const bgBands = ctx.split.bgcolors
              .filter(({ meta }) => plotDisplayHas(meta.display, PLOT_DISPLAY.pane))
              .map(({ key, values, meta }) => ({
                name: key,
                data: bgcolorSeriesToHistogramData(ctx.ohlcvTimes, values, meta.color),
              }))
              .filter((b) => b.data.length > 0);
            // The band belongs on the script's own pane (the price pane for an
            // overlay script). Without the pane it landed on the price pane,
            // where the removal loop (which only inspects the target pane)
            // never removed it — a permanent duplicate band.
            mgr.syncBgcolorBands(bgBands, {
              ownerId: newId,
              paneId: ctx.overlay ? 'price' : ctx.paneId,
            });
          }
          // Trade markers / plotshape / Pine SVG were set under EDITOR_RUN_KEY
          try {
            mgr.reownShapeMarkers?.(EDITOR_RUN_KEY, newId);
          } catch {
            /* shape markers optional */
          }
          try {
            const priceLayer = getDrawingLayer() ?? getActiveDrawingLayer();
            priceLayer?.reownScriptDrawings?.(EDITOR_RUN_KEY, newId);
            priceLayer?.reownPlotFills?.(EDITOR_RUN_KEY, newId);
            if (!ctx.overlay && ctx.paneId !== 'price') {
              const paneLayer = ensureScriptPaneLayer(ctx.paneId);
              paneLayer?.reownScriptDrawings?.(EDITOR_RUN_KEY, newId);
              paneLayer?.reownPlotFills?.(EDITOR_RUN_KEY, newId);
            }
          } catch {
            /* drawing layer optional */
          }
          try {
            mgr.clearTradeMarkers?.(EDITOR_RUN_KEY);
            const ev = ctx.result.events || [];
            if (ev.length && typeof mgr.setTradeMarkers === 'function') {
              const fillMode = store.strategyUi?.slippageNextOpen ? 'next_open' : 'close';
              const normalized = normalizeStrategyEvents(ev, {
                bars: store.bars || [],
                includeOrders: false,
                fillMode,
              });
              const markers = eventsToMarkers(normalized, {
                invertLabels: !!store.strategyUi?.invertTradeLabels,
                exactOnCandle: store.strategyUi?.exactOnCandle !== false,
              });
              mgr.setTradeMarkers(markers, newId);
            }
          } catch {
            /* markers optional */
          }
        }
      } catch {
        /* chart may be disposed */
      }
      if (Object.keys(seriesForCache).length) {
        setIndicatorSeries(newId, {
          name: ctx.scriptName,
          series: seriesForCache,
          titles: titlesForCache,
          times: timesForCache,
        });
      }
    } else {
      // Re-run replace: refresh source / name / pane. Explicit panel picks
      // (custom) survive; auto-persisted colors refresh from the fresh run
      // so ctx.script color edits take effect instead of sticking forever.
      const plots: Record<string, { color: string; custom?: boolean }> = {
        ...(ctx.existing?.plots || {}),
      };
      let colorIdx = 0;
      if (ctx.seriesEntries.length) {
        for (const [k] of ctx.seriesEntries) {
          if (plots[k]?.custom) continue;
          const meta = ctx.plotMeta[k];
          plots[k] = {
            color:
              resolvePineColor(meta?.color) ??
              PLOT_PALETTE[colorIdx % PLOT_PALETTE.length],
          };
          colorIdx += 1;
        }
      }
      const savedInputs = nonemptyBag(ctx.opts.inputs) ?? ctx.existing?.inputValues;
      const savedStrategyProps =
        nonemptyBag(ctx.opts.strategyProps) ?? ctx.existing?.strategyProps;
      updateIndicator(ctx.indicatorId, {
        name: ctx.scriptName,
        code: ctx.script,
        paneId: ctx.paneId,
        plots,
        ...(savedInputs && Object.keys(savedInputs).length
          ? { inputValues: savedInputs }
          : {}),
        ...(savedStrategyProps && Object.keys(savedStrategyProps).length
          ? { strategyProps: savedStrategyProps }
          : {}),
      });
      if (Object.keys(seriesForCache).length) {
        setIndicatorSeries(ctx.indicatorId, {
          name: ctx.scriptName,
          series: seriesForCache,
          titles: titlesForCache,
          times: timesForCache,
        });
      }
    }
  } catch (e: unknown) {
    reportUiError(e, {
      source: 'run',
      context: 'Indicator store update failed',
      status: false,
    });
  }
  return true;
}
