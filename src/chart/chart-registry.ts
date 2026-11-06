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

/** Per-slot chart runtime: imperative manager/layer refs plus reactive bars and paint gen. */
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

/**
 * Snapshot of one slot's runtime.
 *
 * @param slotId layout slot id
 * @returns current refs and bars; creates the slot's store entry on first read
 */
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

/**
 * Point legacy helpers / shortcuts at one slot.
 *
 * @param id slot id to focus, or `null` when no chart is mounted
 */
export function setActiveSlotId(id: string | null): void {
  activeSlotId = id;
}

/** @returns the focused slot id, or `null` before any chart registers. */
export function getActiveSlotId(): string | null {
  return activeSlotId;
}

/**
 * Register (or clear) the chart manager for a slot.
 *
 * @param slotId layout slot id
 * @param manager live PaneManager, or `undefined` on teardown
 */
export function setSlotManager(slotId: string, manager: PaneManager | undefined): void {
  ensureSlot(slotId);
  slotRefs.get(slotId)!.manager = manager;
}

/** @returns the slot's PaneManager, or `undefined` when that slot is not mounted. */
export function getSlotManager(slotId: string): PaneManager | undefined {
  return slotRefs.get(slotId)?.manager;
}

/**
 * Register (or clear) the drawing layer for a slot.
 *
 * @param slotId layout slot id
 * @param layer live DrawingLayer, or `undefined` on teardown
 */
export function setSlotDrawingLayer(slotId: string, layer: DrawingLayer | undefined): void {
  ensureSlot(slotId);
  slotRefs.get(slotId)!.drawingLayer = layer;
}

/** @returns the slot's DrawingLayer, or `undefined` when that slot is not mounted. */
export function getSlotDrawingLayer(slotId: string): DrawingLayer | undefined {
  return slotRefs.get(slotId)?.drawingLayer;
}

/**
 * Publish OHLCV for a slot so its ChartHost memo repaints.
 *
 * @param slotId layout slot id
 * @param bars full bar window for that slot
 * @param bumpGen bump `chartDataGen` to force a full repaint (default true)
 */
export function setSlotBars(slotId: string, bars: Bar[], bumpGen = true): void {
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
export function disposeSlotChart(slotId: string): void {
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
export function removeSlotRuntime(slotId: string): void {
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

/** @returns the active slot's DrawingLayer, or `undefined` when no chart is mounted. */
export function getActiveDrawingLayer(): DrawingLayer | undefined {
  if (!activeSlotId) return undefined;
  return getSlotDrawingLayer(activeSlotId);
}

/**
 * Attach a drawing layer to the focused slot.
 *
 * @param layer layer to register; no-op when no slot is active
 */
export function setActiveDrawingLayer(layer: DrawingLayer | undefined): void {
  if (!activeSlotId) return;
  setSlotDrawingLayer(activeSlotId, layer);
}
