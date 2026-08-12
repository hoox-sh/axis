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
 * Imperative chart manager access without Solid UI imports.
 * Lets runner / streams / load-symbol work in unit tests without Lucide/Solid DOM.
 *
 * Also owns **drawing-layer wiring**: lazily creates {@link DrawingLayer} on the
 * price pane host (`#pane-price`) once the candle series exists, seeds it from
 * store prefs, and bridges layer callbacks back into the store.
 */

import type { PaneManager } from './pane-manager';
import { DrawingLayer } from './drawing-layer';
import { createPriceSeries, createVolumeSeries } from './series-factory';
import {
  mapBarsToPriceData,
  lastBarDirection,
  normalizeChartType,
  resetHeikinAshiCache,
  type ChartType,
} from './chart-type';
import {
  heavyTimeScaleOptions,
  isHeavyBarLoad,
  mapBarsToVolumeData,
} from './heavy-data';
import {
  formatPriceWithDecimals,
  priceFormatForDecimals,
  resolvePriceDecimals,
} from './price-precision';
import {
  store,
  setDrawings,
  setSelectedDrawingId,
  setDrawingTool,
  setCrosshair,
} from '../store';
import type { Bar, Drawing } from '../store/types';
import {
  debugPinsToMarkers,
  pinsFromLastRun,
  resolveDebugPinTarget,
  type DebugPin,
} from '../results/debug-pins';
import {
  getActiveManager,
  getActiveSlotId,
  getSlotDrawingLayer,
  setSlotDrawingLayer,
  setSlotManager,
} from './chart-registry';
import { reportUiError } from '../ui/boot-errors';
import { getThemeManager } from '../theme';
import {
  drawingsForSymbol,
  mergeLayerDrawingsForSymbol,
} from './drawings/sync';

/**
 * User drawings visible on the active chart for the current symbol.
 * Includes untagged (legacy) drawings so pre-anchoring data still paints.
 */
export function visibleDrawingsForActiveSymbol(
  symbol: string = store.symbol,
): Drawing[] {
  return drawingsForSymbol(store.drawings, symbol, {
    includeUntagged: true,
  }) as Drawing[];
}

/**
 * Layer → store bridge: merge the layer’s list into the full multi-symbol store
 * so place/edit/clear on the active symbol never drops other symbols’ drawings.
 */
function onLayerDrawingsChange(list: Drawing[]) {
  const merged = mergeLayerDrawingsForSymbol(
    store.drawings,
    store.symbol,
    list,
    { includeUntagged: true },
  ) as Drawing[];
  setDrawings(merged);
}

/**
 * Full-history paint path: drop Pine script drawings, plot fills, and indicator
 * overlays so a symbol/interval change does not leave stale series on screen.
 * User drawings are re-synced separately (per-symbol filter).
 */
function clearChartScriptState(mgr: PaneManager, layer: DrawingLayer | undefined) {
  try {
    layer?.clearScriptDrawings?.();
  } catch {
    /* optional */
  }
  try {
    layer?.clearPlotFills?.();
  } catch {
    /* optional */
  }
  try {
    mgr.clearBarColors?.();
  } catch {
    /* optional */
  }
  try {
    mgr.clearShapeMarkers?.();
  } catch {
    /* optional */
  }
  try {
    if (typeof mgr.getAllPanes === 'function') {
      for (const p of mgr.getAllPanes()) {
        try {
          mgr.removeOverlays?.(p.id);
        } catch {
          /* ignore */
        }
      }
    } else {
      // Fallback when getAllPanes is missing (tests / older doubles)
      for (const id of ['price', 'volume', 'equity'] as const) {
        try {
          mgr.removeOverlays?.(id);
        } catch {
          /* ignore */
        }
      }
      for (const pane of store.panes || []) {
        if (!pane?.id) continue;
        try {
          mgr.removeOverlays?.(pane.id);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* overlays optional */
  }
  try {
    mgr.hideEquityPane?.();
  } catch {
    /* equity optional */
  }
}

/**
 * Legacy module fallback when no multi-chart slot is active (unit tests).
 * Prefer active-slot registry via {@link getManager}.
 */
let manager: PaneManager | undefined;
let drawingLayer: DrawingLayer | undefined;
/** ThemeManager unregister for the active price series */
let priceSeriesThemeUnreg: (() => void) | undefined;

/**
 * Active chart manager (multi-chart) or legacy singleton.
 * Never returns a disposed/stale legacy pointer while a multi-chart slot is
 * active — after slot teardown {@link getActiveManager} is undefined and we
 * must not fall through to a zombie `manager` ref.
 */
export function getManager(): PaneManager | undefined {
  const active = getActiveManager();
  if (active) return active;
  // Slot id set but manager already disposed (or not yet mounted)
  if (getActiveSlotId()) return undefined;
  return manager;
}

export function setManager(m: PaneManager | undefined, slotId?: string) {
  const id = slotId || getActiveSlotId();
  if (id) setSlotManager(id, m);
  // Keep legacy pointer on active slot for tests / single-chart
  if (!id || id === getActiveSlotId()) {
    if (m === undefined && manager !== undefined) {
      // Active manager cleared — drop theme subscription so reapplyAll cannot
      // touch a series whose chart was removed.
      try {
        priceSeriesThemeUnreg?.();
      } catch {
        /* ignore */
      }
      priceSeriesThemeUnreg = undefined;
    }
    manager = m;
  }
}

/**
 * Imperative access to the price-pane drawing overlay (if created).
 * Prefers the active multi-chart registry entry; falls back to module ref
 * (ensureDrawingLayer race + unit tests without a slot id).
 */
export function getDrawingLayer(): DrawingLayer | undefined {
  const id = getActiveSlotId();
  if (id) return getSlotDrawingLayer(id) ?? drawingLayer;
  return drawingLayer;
}

/** Replace or clear the module-local layer ref (e.g. on chart teardown). */
export function setDrawingLayer(layer: DrawingLayer | undefined, slotId?: string) {
  const id = slotId || getActiveSlotId();
  if (id) setSlotDrawingLayer(id, layer);
  if (!id || id === getActiveSlotId()) {
    drawingLayer = layer;
  }
}

/**
 * Lazily construct {@link DrawingLayer} when chart infrastructure is ready.
 *
 * Preconditions (all required; silent no-op otherwise):
 * - `manager` set and price pane has a candle series
 * - DOM host `#pane-price` exists
 * - `document.createElementNS` available (skipped under minimal happy-dom)
 *
 * Wiring on create:
 * 1. Seed **symbol-filtered** user drawings + active tool from store
 * 2. `onChange` → {@link onLayerDrawingsChange} (merge into multi-symbol store)
 * 3. `barsProvider` → `store.bars` for magnet snap
 * 4. `symbolProvider` → `store.symbol` so new placements stamp `meta.symbol`
 * 5. Seed magnet / stay-in-mode / lock-all / hide + style prefs from store
 * 6. `onSelectionChange` → `setSelectedDrawingId` (toolbar style bar)
 * 7. `onToolChange` → `setDrawingTool` (layer auto-cursor after place when not stay-in-mode)
 *
 * Invoked from {@link setDataToChart} after OHLCV is applied so the overlay tracks reloads.
 */
function ensureDrawingLayer() {
  const mgr = getManager();
  if (!mgr || getDrawingLayer()) return;
  const pricePane = mgr.getPane('price');
  const candle = pricePane?.series['candle'];
  if (!pricePane || !candle) return;
  // Real PaneManager exposes paneDomId; test doubles often omit it.
  const paneElId =
    typeof mgr.paneDomId === 'function' ? mgr.paneDomId('price') : 'pane-price';
  const el = typeof document !== 'undefined' ? document.getElementById(paneElId) : null;
  if (!el) return;
  // happy-dom / minimal test envs may lack createElementNS
  if (typeof document.createElementNS !== 'function') return;

  try {
    const layer = new DrawingLayer(el, pricePane.chart, candle as never);
    // Geometry for the active symbol only (+ untagged legacy)
    layer.setDrawings(visibleDrawingsForActiveSymbol());
    layer.setTool(store.drawingTool);
    // Layer → store: merge per-symbol so other tickers keep their drawings
    layer.setOnChange((list) => onLayerDrawingsChange(list));
    // Magnet snap needs live OHLCV (weak/strong modes)
    layer.setBarsProvider(() => store.bars);
    // Anchor new placements to the active chart symbol
    layer.setSymbolProvider(() => store.symbol);
    // Interaction prefs (defaults match DrawingPrefs / DrawingUi when store partial)
    layer.setMagnet(store.drawingUi?.magnet ?? 'off');
    layer.setStayInMode(!!store.drawingUi?.stayInMode);
    layer.setLockAll(!!store.drawingUi?.lockAll);
    layer.setHideDrawings(!!store.drawingUi?.hideDrawings);
    layer.setStylePrefs({
      color: store.drawingPrefs?.color ?? '#939fff',
      width: store.drawingPrefs?.width ?? 1.5,
      lineStyle: store.drawingPrefs?.lineStyle ?? 'solid',
      fillOpacity: store.drawingPrefs?.fillOpacity ?? 0.15,
    });
    // Layer → store: selection + tool (toolbar style bar / afterPlace)
    layer.setOnSelectionChange((id) => setSelectedDrawingId(id));
    layer.setOnToolChange((tool) => setDrawingTool(tool));
    setDrawingLayer(layer);
  } catch {
    setDrawingLayer(undefined);
  }
}

export type SetDataToChartOpts = {
  /** Reset viewport to fit all bars (full loads only; never live ticks). Default true. */
  fit?: boolean;
  /** Clear trade markers before applying OHLCV. Default true for full loads. */
  clearMarkers?: boolean;
};

/**
 * Apply price-scale decimal precision to the main price series (+ crosshair).
 * Mode from {@link store.priceScaleDecimals}; auto uses symbol + bars.
 */
export function applyPriceScaleDecimals(opts?: {
  bars?: typeof store.bars;
  symbol?: string;
}): number {
  const mgr = getManager();
  const pricePane = mgr?.getPane('price');
  const series = pricePane?.series['candle'];
  if (!series || !pricePane?.chart) return 2;

  const bars = opts?.bars ?? store.bars;
  const symbol = opts?.symbol ?? store.symbol;
  const decimals = resolvePriceDecimals(store.priceScaleDecimals, { bars, symbol });
  const fmt = priceFormatForDecimals(decimals);

  try {
    series.applyOptions({ priceFormat: fmt } as never);
  } catch {
    /* series disposed */
  }
  try {
    // Crosshair horizontal label uses localization.priceFormatter when set
    pricePane.chart.applyOptions({
      localization: {
        priceFormatter: (p: number) => formatPriceWithDecimals(p, decimals),
      },
    } as never);
  } catch {
    /* chart disposed */
  }
  return decimals;
}

/**
 * Ensure the price pane has a series matching `chartType`.
 * Swaps LWC series when the style changes; rebinds markers + drawing layer.
 */
export function ensurePriceSeries(chartType?: ChartType): void {
  const mgr = getManager();
  if (!mgr) return;
  try {
    const type = normalizeChartType(chartType ?? store.chartType);
    const pricePane = mgr.getPane('price');
    if (!pricePane?.chart) return;

    const currentType = mgr.getPriceChartType();
    const existing = pricePane.series['candle'];
    if (existing && currentType === type) return;

    // Drop markers plugin before removing the host series
    try {
      mgr.detachPriceMarkers();
    } catch {
      /* markers optional */
    }

    if (existing) {
      try {
        priceSeriesThemeUnreg?.();
      } catch {
        /* ignore */
      }
      priceSeriesThemeUnreg = undefined;
      try {
        pricePane.chart.removeSeries(existing);
      } catch {
        /* ignore */
      }
      delete pricePane.series['candle'];
    }

    pricePane.series['candle'] = createPriceSeries(pricePane.chart, type);
    mgr.setPriceChartType(type);

    try {
      priceSeriesThemeUnreg = getThemeManager().registerPriceSeries(
        pricePane.series['candle'],
        type,
      );
    } catch {
      priceSeriesThemeUnreg = undefined;
    }

    // Respect chart [N] last-value / name labels pref on the new series
    try {
      pricePane.series['candle'].applyOptions({
        lastValueVisible: store.lastValueLabelsVisible !== false,
      });
    } catch {
      /* ignore */
    }
    // Price scale decimals (auto from symbol/bars or fixed)
    try {
      applyPriceScaleDecimals();
    } catch {
      /* ignore */
    }

    // Drawing layer needs the new series for price ↔ Y
    try {
      getDrawingLayer()?.setSeries(pricePane.series['candle'] as never);
    } catch {
      /* layer optional */
    }

    // Re-attach markers onto the new host series
    try {
      mgr.reapplyPriceMarkers();
    } catch {
      /* markers optional */
    }
  } catch (err: unknown) {
    reportUiError(err, {
      source: 'chart',
      context: 'Price series ensure failed',
      status: false,
    });
  }
}

/**
 * Full OHLCV replace for history loads / symbol changes / chart-type switches.
 * Do **not** call this on every live tick — use PaneManager.appendBar instead.
 *
 * When `fit` is true (default — full loads / symbol change):
 * - Clears trade/shape/debug markers
 * - Clears Pine script drawings, plot fills, indicator overlays, equity
 * - Re-syncs **symbol-filtered** user drawings onto the layer
 * - Fits time scale + auto-scale via {@link PaneManager.afterDataReload}
 *
 * Series mutations are isolated: LWC failures are logged + status-bar surfaced
 * instead of bubbling through Solid effects (which would unmount the tree).
 */
export function setDataToChart(bars: Bar[], opts: SetDataToChartOpts = {}) {
  const mgr = getManager();
  if (!mgr) return;
  try {
    const fit = opts.fit !== false;
    const clearMarkers = opts.clearMarkers !== false;
    const pricePane = mgr.getPane('price');
    const volPane = mgr.getPane('volume');
    const chartType = normalizeChartType(store.chartType);

    if (clearMarkers) {
      try {
        mgr.clearTradeMarkers();
        mgr.clearShapeMarkers?.();
        mgr.clearDebugPinMarkers?.();
      } catch (err: unknown) {
        reportUiError(err, {
          source: 'chart',
          context: 'Clear markers failed',
          status: false,
        });
      }
    }

    // Full history replace (symbol / interval): wipe script visuals before paint
    if (fit) {
      clearChartScriptState(mgr, getDrawingLayer());
      // Drop selection that may point at a drawing not on the new symbol
      setSelectedDrawingId(null);
      try {
        getDrawingLayer()?.setSelectedId?.(null);
      } catch {
        /* optional */
      }
    }

    ensurePriceSeries(chartType);

    // Tune LWC conflation for this history size before the heavy setData paint
    const tsHeavy = heavyTimeScaleOptions(bars.length);
    try {
      pricePane?.chart.timeScale().applyOptions(tsHeavy as never);
      volPane?.chart.timeScale().applyOptions({
        enableConflation: tsHeavy.enableConflation,
        conflationThresholdFactor: tsHeavy.conflationThresholdFactor,
        // Volume follows price range — no need to precompute twice
        precomputeConflationOnInit: false,
      } as never);
    } catch {
      /* conflation options optional on older mocks */
    }

    if (pricePane?.series['candle']) {
      // Full replace invalidates incremental HA live state (re-seeded by mapper)
      if (chartType !== 'heikinashi') resetHeikinAshiCache();
      const data = mapBarsToPriceData(bars, chartType);
      pricePane.series['candle'].setData(data as never);
      // Re-detect decimals after history lands (auto uses symbol + bars)
      try {
        applyPriceScaleDecimals({ bars, symbol: store.symbol });
      } catch {
        /* ignore */
      }

      // Baseline: base at first bar close so early range splits meaningfully
      if (chartType === 'baseline' && bars.length) {
        try {
          pricePane.series['candle'].applyOptions({
            baseValue: { type: 'price', price: bars[0]!.close },
          });
        } catch {
          /* baseline option optional */
        }
      }

      const dir = lastBarDirection(bars, chartType);
      if (dir) {
        try {
          const voidLike = getThemeManager().getVoidLike();
          pricePane.series['candle'].applyOptions({
            priceLineColor: dir === 'up' ? voidLike.up : voidLike.down,
          });
        } catch {
          /* price line tint optional */
        }
      }
      if (fit) {
        // Defer fit/layout work one frame so LWC can commit setData first
        // (noticeable on 10k+ candles — avoids long main-thread block).
        const runFit = () => {
          try {
            if (typeof mgr.afterDataReload === 'function') {
              mgr.afterDataReload();
            } else {
              pricePane.chart.timeScale().fitContent();
            }
          } catch {
            /* fit optional */
          }
        };
        if (isHeavyBarLoad(bars.length) && typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(runFit);
        } else {
          runFit();
        }
      }
    }

    if (volPane && !volPane.series['volume']) {
      volPane.series['volume'] = createVolumeSeries(volPane.chart);
    }
    if (volPane?.series['volume']) {
      const volColors = getThemeManager().getVolumeColors();
      volPane.series['volume'].setData(
        mapBarsToVolumeData(bars, volColors) as never,
      );
      try {
        volPane.series['volume'].applyOptions({
          lastValueVisible: store.lastValueLabelsVisible !== false,
        });
      } catch {
        /* ignore */
      }
    }

    // Volume/indicator setData can reset local logical range — re-lock to price
    if (typeof mgr.alignTimeRangesFromPrice === 'function') {
      try {
        mgr.alignTimeRangesFromPrice();
      } catch {
        /* align optional */
      }
    }

    // Re-assert series name / last-value labels after series create/paint
    try {
      mgr.applyLastValueLabelsToAllSeries?.();
    } catch {
      /* optional */
    }

    // Ensure overlay exists after candle series is ready; re-sync **per-symbol**
    // user drawings (drawings only on the active multi-chart slot)
    ensureDrawingLayer();
    try {
      getDrawingLayer()?.setDrawings(visibleDrawingsForActiveSymbol());
    } catch (err: unknown) {
      reportUiError(err, {
        source: 'chart',
        context: 'Drawing layer sync failed',
        status: false,
      });
    }
  } catch (err: unknown) {
    reportUiError(err, {
      source: 'chart',
      context: 'Chart series update failed',
      status: true,
    });
  }
}

/**
 * Apply or clear debug-pin markers on the active chart from `store.lastRun`.
 * No-op when manager is missing; clears markers when disabled or empty.
 */
export function applyDebugPinsToChart(enabled?: boolean) {
  const mgr = getManager();
  if (!mgr) return;
  try {
    const on = enabled ?? !!store.debugPinsEnabled;
    if (!on || store.lastRun == null) {
      mgr.clearDebugPinMarkers?.();
      return;
    }
    const pins = pinsFromLastRun(store.lastRun, { bars: store.bars });
    const markers = debugPinsToMarkers(pins, store.bars);
    if (!markers.length) {
      mgr.clearDebugPinMarkers?.();
      return;
    }
    mgr.setDebugPinMarkers?.(markers);
  } catch (err: unknown) {
    reportUiError(err, {
      source: 'chart',
      context: 'Debug pin markers failed',
      status: false,
    });
  }
}

/**
 * Jump chart + Data Window crosshair to a debug pin / log bar.
 * Resolves barIndex ↔ time via `store.bars` when one side is missing.
 */
export function jumpToDebugPin(pin: Pick<DebugPin, 'time' | 'barIndex'> | null | undefined) {
  if (pin == null) return;
  const { time, barIndex } = resolveDebugPinTarget(pin, store.bars);
  setCrosshair(time, barIndex);
  if (time != null && Number.isFinite(time)) {
    getManager()?.scrollToTime(time);
  }
}

/** Re-export toolbar singleton (DrawingLayer module active instance). */
export { getActiveDrawingLayer } from './drawing-layer';
