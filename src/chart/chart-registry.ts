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
 * Multi-chart registry — one {@link PaneManager} (+ optional drawing layer)
 * per layout slot. The “active” slot backs legacy {@link getManager}.
 *
 * @module chart/chart-registry
 */

import type { PaneManager } from './pane-manager';
import type { DrawingLayer } from './drawing-layer';
import type { Bar } from '../store/types';

export interface ChartSlotRuntime {
  manager?: PaneManager;
  drawingLayer?: DrawingLayer;
  bars: Bar[];
  chartDataGen: number;
}

const runtimes = new Map<string, ChartSlotRuntime>();
let activeSlotId: string | null = null;

function emptyRuntime(): ChartSlotRuntime {
  return { bars: [], chartDataGen: 0 };
}

export function getSlotRuntime(slotId: string): ChartSlotRuntime {
  let r = runtimes.get(slotId);
  if (!r) {
    r = emptyRuntime();
    runtimes.set(slotId, r);
  }
  return r;
}

export function setActiveSlotId(id: string | null) {
  activeSlotId = id;
}

export function getActiveSlotId(): string | null {
  return activeSlotId;
}

export function setSlotManager(slotId: string, manager: PaneManager | undefined) {
  const r = getSlotRuntime(slotId);
  r.manager = manager;
}

export function getSlotManager(slotId: string): PaneManager | undefined {
  return runtimes.get(slotId)?.manager;
}

export function setSlotDrawingLayer(slotId: string, layer: DrawingLayer | undefined) {
  const r = getSlotRuntime(slotId);
  r.drawingLayer = layer;
}

export function getSlotDrawingLayer(slotId: string): DrawingLayer | undefined {
  return runtimes.get(slotId)?.drawingLayer;
}

export function setSlotBars(slotId: string, bars: Bar[], bumpGen = true) {
  const r = getSlotRuntime(slotId);
  r.bars = bars;
  if (bumpGen) r.chartDataGen += 1;
}

export function getSlotBars(slotId: string): Bar[] {
  return runtimes.get(slotId)?.bars ?? [];
}

export function getSlotChartDataGen(slotId: string): number {
  return runtimes.get(slotId)?.chartDataGen ?? 0;
}

/** Dispose manager/layer for a slot (keep bars for quick re-show). */
export function disposeSlotChart(slotId: string) {
  const r = runtimes.get(slotId);
  if (!r) return;
  const layer = r.drawingLayer;
  r.drawingLayer = undefined;
  if (layer) {
    try {
      layer.destroy();
    } catch {
      /* ignore */
    }
  }
  const mgr = r.manager;
  r.manager = undefined;
  if (mgr) {
    try {
      mgr.dispose();
    } catch {
      /* ignore */
    }
  }
}

/** Drop runtime entirely (slot removed from layout). */
export function removeSlotRuntime(slotId: string) {
  disposeSlotChart(slotId);
  runtimes.delete(slotId);
  if (activeSlotId === slotId) activeSlotId = null;
}

/** Active-slot helpers used by legacy getManager / getDrawingLayer. */
export function getActiveManager(): PaneManager | undefined {
  if (!activeSlotId) return undefined;
  return getSlotManager(activeSlotId);
}

export function getActiveDrawingLayer(): DrawingLayer | undefined {
  if (!activeSlotId) return undefined;
  return getSlotDrawingLayer(activeSlotId);
}

export function setActiveDrawingLayer(layer: DrawingLayer | undefined) {
  if (!activeSlotId) return;
  setSlotDrawingLayer(activeSlotId, layer);
}
