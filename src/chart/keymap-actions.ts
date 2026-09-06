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
 * @module chart/keymap-actions
 *
 * Chart-only shortcut side effects for the keyboard shortcut Hub. Every
 * helper reads the active chart / drawing layer through the chart registry
 * and no-ops gracefully when no chart is mounted (tests, cold start), so the
 * Hub can register these unconditionally.
 */

import { CrosshairMode } from 'lightweight-charts';
import { store, setDrawingTool, setChartGridMode, setDrawingUi } from '../store';
import { getActiveManager, getActiveDrawingLayer } from './chart-registry';
import type { DrawingToolId } from './drawing-types';

/** Price-pane chart of the active manager, or null when none is mounted. */
function getPriceChart() {
  const mgr = getActiveManager();
  if (!mgr) return null;
  const pane = mgr.getPane('price');
  return pane?.chart ?? null;
}

/** Zoom the visible range by a relative factor (positive = in, negative = out). */
export function zoomChartBy(delta: number): void {
  const chart = getPriceChart();
  if (!chart) return;
  try {
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const span = Math.max(1, range.to - range.from);
    const newSpan = Math.max(1, span * (1 - delta));
    const center = (range.from + range.to) / 2;
    ts.setVisibleLogicalRange({ from: center - newSpan / 2, to: center + newSpan / 2 });
  } catch {
    /* no-op */
  }
}

/** Pan the visible range by a bar count (negative = left). */
export function panChartBy(shift: number): void {
  const chart = getPriceChart();
  if (!chart) return;
  try {
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    ts.setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
  } catch {
    /* no-op */
  }
}

/** Fit the whole series into view. */
export function resetChartZoom(): void {
  const mgr = getActiveManager();
  if (!mgr) return;
  try {
    mgr.fitContent();
  } catch {
    /* no-op */
  }
}

/** Toggle the lightweight-charts crosshair mode (Normal ↔ Magnet). */
export function toggleCrosshair(): void {
  const chart = getPriceChart();
  if (!chart) return;
  try {
    const cur = chart.options().crosshair?.mode ?? CrosshairMode.Normal;
    chart.applyOptions({
      crosshair: { mode: cur === CrosshairMode.Normal ? CrosshairMode.Magnet : CrosshairMode.Normal },
    });
  } catch {
    /* no-op */
  }
}

/** Cycle drawing magnet strength: off → weak → strong → off. */
export function toggleMagnet(): void {
  const order = ['off', 'weak', 'strong'] as const;
  const i = order.indexOf(store.drawingUi.magnet);
  const next = order[(i + 1) % order.length]!;
  setDrawingUi({ magnet: next });
  getActiveDrawingLayer()?.setMagnet(next);
}

/** Delete the selected drawing on the active layer (respects lock rules). */
export function deleteSelectedDrawing(): void {
  const layer = getActiveDrawingLayer();
  if (!layer) return;
  layer.deleteSelected();
}

/** Cancel an in-progress drawing draft and clear selection. */
export function cancelDraft(): void {
  const layer = getActiveDrawingLayer();
  if (!layer) return;
  layer.cancelDraft();
}

/** Select a drawing tool (cursor / place tool). */
export function selectDrawingTool(tool: DrawingToolId): void {
  setDrawingTool(tool);
}

/** Apply a chart grid layout. */
export function applyChartGrid(mode: '1' | '2h' | '2v' | '4'): void {
  setChartGridMode(mode);
}