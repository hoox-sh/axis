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
 * Slot **bars** / **chartDataGen** live in a Solid store so ChartHost inactive
 * slots re-paint when those paths change. Managers and drawing layers stay
 * imperative refs (not reactive).
 *
 * @module chart/chart-registry
 */

import { batch, createSignal } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { PaneManager } from './pane-manager';
import type { DrawingLayer } from './drawing-layer';
import type { Bar } from '../store/types';

export interface ChartSlotRuntime {
  manager?: PaneManager;
  drawingLayer?: DrawingLayer;
  bars: Bar[];
  chartDataGen: number;
}

/** Reactive per-slot OHLCV + generation (tracked by getSlotBars / getSlotChartDataGen). */
interface SlotReactive {
  bars: Bar[];
  chartDataGen: number;
}

/** Imperative manager / drawing-layer refs (not reactive). */
interface SlotRefs {
  manager?: PaneManager;
  drawingLayer?: DrawingLayer;
}

const [slotData, setSlotData] = createStore<Record<string, SlotReactive>>({});
const slotRefs = new Map<string, SlotRefs>();
let activeSlotId: string | null = null;

/**
 * Bumped only when a slot key is created or removed so cold readers
 * (missing key) re-subscribe; path updates to bars/gen stay fine-grained.
 */
const [structureEpoch, setStructureEpoch] = createSignal(0);

function ensureSlot(slotId: string): void {
  if (slotData[slotId] == null) {
    setSlotData(slotId, { bars: [], chartDataGen: 0 });
    setStructureEpoch((n) => n + 1);
  }
  if (!slotRefs.has(slotId)) {
    slotRefs.set(slotId, {});
  }
}

export function getSlotRuntime(slotId: string): ChartSlotRuntime {
  ensureSlot(slotId);
  const refs = slotRefs.get(slotId)!;
  const data = slotData[slotId]!;
  return {
    manager: refs.manager,
    drawingLayer: refs.drawingLayer,
    bars: data.bars,
    chartDataGen: data.chartDataGen,
  };
}

export function setActiveSlotId(id: string | null) {
  activeSlotId = id;
}

export function getActiveSlotId(): string | null {
  return activeSlotId;
}

export function setSlotManager(slotId: string, manager: PaneManager | undefined) {
  ensureSlot(slotId);
  slotRefs.get(slotId)!.manager = manager;
}

export function getSlotManager(slotId: string): PaneManager | undefined {
  return slotRefs.get(slotId)?.manager;
}

export function setSlotDrawingLayer(slotId: string, layer: DrawingLayer | undefined) {
  ensureSlot(slotId);
  slotRefs.get(slotId)!.drawingLayer = layer;
}

export function getSlotDrawingLayer(slotId: string): DrawingLayer | undefined {
  return slotRefs.get(slotId)?.drawingLayer;
}

export function setSlotBars(slotId: string, bars: Bar[], bumpGen = true) {
  if (slotData[slotId] == null) {
    batch(() => {
      setSlotData(slotId, {
        bars,
        chartDataGen: bumpGen ? 1 : 0,
      });
      setStructureEpoch((n) => n + 1);
    });
    if (!slotRefs.has(slotId)) slotRefs.set(slotId, {});
    return;
  }
  batch(() => {
    setSlotData(slotId, 'bars', bars);
    if (bumpGen) {
      setSlotData(slotId, 'chartDataGen', (n) => n + 1);
    }
  });
}

/**
 * Reactive read of slot bars. Tracks `slotData[slotId].bars` when the slot
 * exists (fine-grained). Cold miss tracks {@link structureEpoch} so the first
 * `setSlotBars` / ensure still wakes ChartHost memos/effects.
 */
export function getSlotBars(slotId: string): Bar[] {
  const entry = slotData[slotId];
  if (entry == null) {
    structureEpoch();
    return [];
  }
  return entry.bars;
}

/**
 * Reactive read of slot chart data generation. Same cold-miss / fine-grained
 * rules as {@link getSlotBars}.
 */
export function getSlotChartDataGen(slotId: string): number {
  const entry = slotData[slotId];
  if (entry == null) {
    structureEpoch();
    return 0;
  }
  return entry.chartDataGen;
}

/** Dispose manager/layer for a slot (keep bars for quick re-show). */
export function disposeSlotChart(slotId: string) {
  const refs = slotRefs.get(slotId);
  if (!refs) return;
  const layer = refs.drawingLayer;
  refs.drawingLayer = undefined;
  if (layer) {
    try {
      layer.destroy();
    } catch {
      /* ignore */
    }
  }
  const mgr = refs.manager;
  refs.manager = undefined;
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
  slotRefs.delete(slotId);
  if (slotData[slotId] != null) {
    batch(() => {
      setSlotData(
        produce((s) => {
          delete s[slotId];
        }),
      );
      setStructureEpoch((n) => n + 1);
    });
  }
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
