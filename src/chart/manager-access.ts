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
import { createPriceSeries, createVolumeSeries, TV } from './series-factory';
import {
  mapBarsToPriceData,
  lastBarDirection,
  normalizeChartType,
  type ChartType,
} from './chart-type';
import {
  store,
  setDrawings,
  setSelectedDrawingId,
  setDrawingTool,
} from '../store';
import type { Bar } from '../store/types';
import {
  getActiveManager,
  getActiveSlotId,
  setSlotDrawingLayer,
  setSlotManager,
} from './chart-registry';

/**
 * Legacy module fallback when no multi-chart slot is active (unit tests).
 * Prefer active-slot registry via {@link getManager}.
 */
let manager: PaneManager | undefined;
let drawingLayer: DrawingLayer | undefined;

/** Active chart manager (multi-chart) or legacy singleton. */
export function getManager(): PaneManager | undefined {
  return getActiveManager() ?? manager;
}

export function setManager(m: PaneManager | undefined, slotId?: string) {
  const id = slotId || getActiveSlotId();
  if (id) setSlotManager(id, m);
  // Keep legacy pointer on active slot for tests / single-chart
  if (!id || id === getActiveSlotId()) {
    manager = m;
  }
}

/** Imperative access to the price-pane drawing overlay (if created). */
export function getDrawingLayer(): DrawingLayer | undefined {
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
 * 1. Seed user drawings + active tool from store
 * 2. `onChange` → `setDrawings` (persist user list after place/move/delete)
 * 3. `barsProvider` → `store.bars` for magnet snap
 * 4. Seed magnet / stay-in-mode / lock-all / hide + style prefs from store
 * 5. `onSelectionChange` → `setSelectedDrawingId` (toolbar style bar)
 * 6. `onToolChange` → `setDrawingTool` (layer auto-cursor after place when not stay-in-mode)
 *
 * Invoked from {@link setDataToChart} after OHLCV is applied so the overlay tracks reloads.
 */
function ensureDrawingLayer() {
  const mgr = getManager();
  if (!mgr || getDrawingLayer()) return;
  const pricePane = mgr.getPane('price');
  const candle = pricePane?.series['candle'];
  if (!pricePane || !candle) return;
  const paneElId = mgr.paneDomId('price');
  const el = typeof document !== 'undefined' ? document.getElementById(paneElId) : null;
  if (!el) return;
  // happy-dom / minimal test envs may lack createElementNS
  if (typeof document.createElementNS !== 'function') return;

  try {
    const layer = new DrawingLayer(el, pricePane.chart, candle as never);
    // Geometry + active tool from persisted / current store
    layer.setDrawings(store.drawings);
    layer.setTool(store.drawingTool);
    // Layer → store: user drawing list after place, drag end, delete, clear
    layer.setOnChange((list) => setDrawings(list));
    // Magnet snap needs live OHLCV (weak/strong modes)
    layer.setBarsProvider(() => store.bars);
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
 * Ensure the price pane has a series matching `chartType`.
 * Swaps LWC series when the style changes; rebinds markers + drawing layer.
 */
export function ensurePriceSeries(chartType?: ChartType): void {
  const mgr = getManager();
  if (!mgr) return;
  const type = normalizeChartType(chartType ?? store.chartType);
  const pricePane = mgr.getPane('price');
  if (!pricePane) return;

  const currentType = mgr.getPriceChartType();
  const existing = pricePane.series['candle'];
  if (existing && currentType === type) return;

  // Drop markers plugin before removing the host series
  mgr.detachPriceMarkers();

  if (existing) {
    try {
      pricePane.chart.removeSeries(existing);
    } catch {
      /* ignore */
    }
    delete pricePane.series['candle'];
  }

  pricePane.series['candle'] = createPriceSeries(pricePane.chart, type);
  mgr.setPriceChartType(type);

  // Drawing layer needs the new series for price ↔ Y
  const layer = getDrawingLayer();
  if (layer) {
    layer.setSeries(pricePane.series['candle'] as never);
  }

  // Re-attach markers onto the new host series
  mgr.reapplyPriceMarkers();
}

/**
 * Full OHLCV replace for history loads / symbol changes / chart-type switches.
 * Do **not** call this on every live tick — use PaneManager.appendBar instead.
 */
export function setDataToChart(bars: Bar[], opts: SetDataToChartOpts = {}) {
  const mgr = getManager();
  if (!mgr) return;
  const fit = opts.fit !== false;
  const clearMarkers = opts.clearMarkers !== false;
  const pricePane = mgr.getPane('price');
  const volPane = mgr.getPane('volume');
  const chartType = normalizeChartType(store.chartType);

  if (clearMarkers) {
    mgr.clearTradeMarkers();
    mgr.clearShapeMarkers?.();
  }

  ensurePriceSeries(chartType);

  if (pricePane?.series['candle']) {
    const data = mapBarsToPriceData(bars, chartType);
    pricePane.series['candle'].setData(data as never);

    // Baseline: base at first bar close so early range splits meaningfully
    if (chartType === 'baseline' && bars.length) {
      try {
        pricePane.series['candle'].applyOptions({
          baseValue: { type: 'price', price: bars[0]!.close },
        });
      } catch {
        /* ignore */
      }
    }

    const dir = lastBarDirection(bars, chartType);
    if (dir) {
      pricePane.series['candle'].applyOptions({
        priceLineColor: dir === 'up' ? TV.up : TV.down,
      });
    }
    if (fit) {
      // Symbol / history change: resize host canvases + fit + auto-scale
      if (typeof mgr.afterDataReload === 'function') {
        mgr.afterDataReload();
      } else {
        try {
          pricePane.chart.timeScale().fitContent();
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (volPane && !volPane.series['volume']) {
    volPane.series['volume'] = createVolumeSeries(volPane.chart);
  }
  if (volPane?.series['volume']) {
    volPane.series['volume'].setData(
      bars.map((b) => ({
        time: b.time as never,
        value: b.volume ?? 0,
        color: b.close >= b.open ? 'rgba(94, 207, 138, 0.45)' : 'rgba(232, 93, 76, 0.45)',
      })),
    );
  }

  // Volume/indicator setData can reset local logical range — re-lock to price
  if (typeof mgr.alignTimeRangesFromPrice === 'function') {
    mgr.alignTimeRangesFromPrice();
  }

  // Ensure overlay exists after candle series is ready; re-sync store drawings
  // (drawings only on the active multi-chart slot)
  ensureDrawingLayer();
  getDrawingLayer()?.setDrawings(store.drawings);
}

/** Re-export toolbar singleton (DrawingLayer module active instance). */
export { getActiveDrawingLayer } from './drawing-layer';
