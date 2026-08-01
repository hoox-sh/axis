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
 * Multi-chart grid layouts + named layout snapshots (pure helpers).
 *
 * @module chart/layout
 */

import {
  DEFAULT_CHART_TYPE,
  normalizeChartType,
  type ChartType,
} from './chart-type';
import type { PanelChromeMap } from '../ui/panels/types';
import type { Pane } from '../store/types';

/** Grid arrangement of chart slots (TradingView-style). */
export type ChartGridMode = '1' | '2h' | '2v' | '4';

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
] as const;

export function slotCountForMode(mode: ChartGridMode): number {
  if (mode === '4') return 4;
  if (mode === '2h' || mode === '2v') return 2;
  return 1;
}

export function isChartGridMode(v: unknown): v is ChartGridMode {
  return v === '1' || v === '2h' || v === '2v' || v === '4';
}

function newSlotId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createChartSlot(
  partial?: Partial<ChartSlot>,
  fallback?: { symbol?: string; interval?: string; exchange?: string },
): ChartSlot {
  return {
    id: partial?.id || newSlotId(),
    symbol: (partial?.symbol || fallback?.symbol || 'BTCUSDT').toUpperCase(),
    interval: partial?.interval || fallback?.interval || '1d',
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
      const alts = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
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

  let activeId =
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
    default:
      return 'grid-cols-1 grid-rows-1';
  }
}

export function findSlot(
  layout: ChartLayoutState,
  id?: string | null,
): ChartSlot | undefined {
  if (!id) return layout.slots[0];
  return layout.slots.find((s) => s.id === id) || layout.slots[0];
}
