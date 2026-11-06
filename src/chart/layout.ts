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
 * Multi-chart grid layouts + named layout snapshots (pure helpers).
 *
 * @module chart/layout
 */

import { DEFAULT_CHART_TYPE, normalizeChartType, type ChartType } from './chart-type';
import type { PanelChromeMap } from '../ui/panels/types';
import type { Pane } from '../store/types';

/** Grid arrangement of chart slots (TradingView-style). */
export type ChartGridMode = '1' | '2h' | '2v' | '4' | '6' | '8';

/** One chart cell in the workspace grid. */
export interface ChartSlot {
  id: string;
  symbol: string;
  interval: string;
  chartType: ChartType;
  exchange: string;
}

/** Live multi-chart workspace state (persisted). */
export interface ChartLayoutState {
  mode: ChartGridMode;
  /** Focused slot — topbar Load/Run/drawings target this chart. */
  activeId: string;
  slots: ChartSlot[];
}

/**
 * Named snapshot the user can save/load.
 * Includes grid + optional chrome so a “layout” restores workspace feel.
 */
export interface SavedChartLayout {
  id: string;
  name: string;
  updatedAt: number;
  chartLayout: ChartLayoutState;
  /** Optional workspace extras */
  panelChrome?: PanelChromeMap;
  panes?: Pane[];
  theme?: 'dark' | 'light';
  uiScale?: number;
  historyBars?: number;
}

/**
 * Grid modes offered by the workspace layout picker, in display order.
 * `cells` mirrors {@link slotCountForMode} and drives the glyph preview.
 */
export const CHART_GRID_MODES: readonly {
  id: ChartGridMode;
  label: string;
  hint: string;
  cells: number;
}[] = [
  { id: '1', label: '1', hint: 'Single chart', cells: 1 },
  { id: '2h', label: '2H', hint: 'Two charts side by side', cells: 2 },
  { id: '2v', label: '2V', hint: 'Two charts stacked', cells: 2 },
  { id: '4', label: '4', hint: '2×2 chart grid', cells: 4 },
  { id: '6', label: '6', hint: '3×2 chart grid', cells: 6 },
  { id: '8', label: '8', hint: '4×2 chart grid', cells: 8 },
] as const;

/**
 * How many chart slots a grid mode occupies.
 *
 * @param mode grid arrangement; unknown values fall through to `1`
 * @returns 1, 2, 4, 6 or 8 slots
 */
export function slotCountForMode(mode: ChartGridMode): number {
  if (mode === '8') return 8;
  if (mode === '6') return 6;
  if (mode === '4') return 4;
  if (mode === '2h' || mode === '2v') return 2;
  return 1;
}

/**
 * Type guard for grid mode strings coming from storage or URL state.
 *
 * @param v untrusted persisted value
 * @returns true for the six supported mode ids
 */
export function isChartGridMode(v: unknown): v is ChartGridMode {
  return v === '1' || v === '2h' || v === '2v' || v === '4' || v === '6' || v === '8';
}

function newSlotId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a complete {@link ChartSlot}, filling gaps from `fallback` and then
 * from the defaults (`BTCUSDT` / `15m` / `binance`).
 *
 * @param partial fields to keep; a missing `id` gets a fresh `c_…` id
 * @param fallback workspace-level symbol/interval/exchange used before defaults
 * @returns a slot whose `symbol` is upper-cased and `chartType` normalized
 */
export function createChartSlot(
  partial?: Partial<ChartSlot>,
  fallback?: { symbol?: string; interval?: string; exchange?: string },
): ChartSlot {
  return {
    id: partial?.id || newSlotId(),
    symbol: (partial?.symbol || fallback?.symbol || 'BTCUSDT').toUpperCase(),
    interval: partial?.interval || fallback?.interval || '15m',
    chartType: normalizeChartType(partial?.chartType || DEFAULT_CHART_TYPE),
    exchange: partial?.exchange || fallback?.exchange || 'binance',
  };
}

/** Fresh single-chart layout matching current symbol/interval defaults. */
export function defaultChartLayout(seed?: {
  symbol?: string;
  interval?: string;
  exchange?: string;
  chartType?: ChartType;
}): ChartLayoutState {
  const slot = createChartSlot(
    {
      chartType: seed?.chartType,
      symbol: seed?.symbol,
      interval: seed?.interval,
      exchange: seed?.exchange,
    },
    seed,
  );
  return { mode: '1', activeId: slot.id, slots: [slot] };
}

/**
 * Resize `slots` to match `mode`, cloning from the active (or first) slot
 * when growing; drop trailing when shrinking. Always returns a valid activeId.
 */
export function normalizeChartLayout(
  raw: Partial<ChartLayoutState> | null | undefined,
  seed?: { symbol?: string; interval?: string; exchange?: string; chartType?: ChartType },
): ChartLayoutState {
  const mode: ChartGridMode = isChartGridMode(raw?.mode) ? raw!.mode : '1';
  const need = slotCountForMode(mode);
  const incoming = Array.isArray(raw?.slots) ? raw!.slots : [];
  const base =
    incoming.find((s) => s && s.id === raw?.activeId) ||
    incoming[0] ||
    createChartSlot(undefined, seed);

  const slots: ChartSlot[] = [];
  for (let i = 0; i < need; i++) {
    const src = incoming[i];
    if (src && typeof src === 'object') {
      slots.push(
        createChartSlot(
          {
            id: typeof src.id === 'string' && src.id ? src.id : undefined,
            symbol: src.symbol,
            interval: src.interval,
            chartType: src.chartType,
            exchange: src.exchange,
          },
          {
            symbol: base.symbol,
            interval: base.interval,
            exchange: base.exchange,
          },
        ),
      );
    } else {
      // New cells: slight symbol variety from seed watchlist-like defaults
      const alts = [
        'BTCUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'BNBUSDT',
        'XRPUSDT',
        'ADAUSDT',
        'DOGEUSDT',
        'AVAXUSDT',
      ];
      slots.push(
        createChartSlot(
          {
            symbol: alts[i % alts.length],
            interval: base.interval,
            chartType: base.chartType,
            exchange: base.exchange,
          },
          base,
        ),
      );
    }
  }

  const activeId =
    typeof raw?.activeId === 'string' && slots.some((s) => s.id === raw.activeId)
      ? raw!.activeId!
      : slots[0]!.id;

  return { mode, activeId, slots };
}

/** CSS grid class fragments for the workspace. */
export function gridClassForMode(mode: ChartGridMode): string {
  switch (mode) {
    case '2h':
      return 'grid-cols-2 grid-rows-1';
    case '2v':
      return 'grid-cols-1 grid-rows-2';
    case '4':
      return 'grid-cols-2 grid-rows-2';
    case '6':
      return 'grid-cols-3 grid-rows-2';
    case '8':
      return 'grid-cols-4 grid-rows-2';
    default:
      return 'grid-cols-1 grid-rows-1';
  }
}

/**
 * Look up a slot, falling back to the first slot so callers always have a
 * target chart.
 *
 * @param layout current workspace layout
 * @param id slot id to find; `null`/`undefined` selects the first slot
 * @returns the matching slot, the first slot, or `undefined` for an empty layout
 */
export function findSlot(layout: ChartLayoutState, id?: string | null): ChartSlot | undefined {
  if (!id) return layout.slots[0];
  return layout.slots.find((s) => s.id === id) || layout.slots[0];
}
