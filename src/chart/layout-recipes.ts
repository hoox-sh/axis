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
 * One-click multi-chart layout presets (pure descriptors + apply via store).
 *
 * Recipes describe grid mode + per-slot symbol/interval; applying them uses
 * {@link setChartGridMode} / {@link updateChartSlot} so named save/load is
 * unchanged.
 *
 * @module chart/layout-recipes
 */

import type { ChartType } from './chart-type';
import {
  createChartSlot,
  slotCountForMode,
  type ChartGridMode,
  type ChartLayoutState,
  type ChartSlot,
} from './layout';
import {
  setActiveChartSlot,
  setChartGridMode,
  store,
  updateChartSlot,
} from '../store';

/** Optional seed for symbol/interval/exchange when a recipe slot omits them. */
export interface LayoutRecipeSeed {
  symbol?: string;
  interval?: string;
  exchange?: string;
  chartType?: ChartType;
}

/** One cell in a recipe — missing fields fall back to seed / defaults. */
export interface LayoutRecipeSlotSpec {
  /** When omitted, uses seed symbol (or BTCUSDT). */
  symbol?: string;
  /** When omitted, uses seed interval (or 1d). */
  interval?: string;
  exchange?: string;
  chartType?: ChartType;
}

/**
 * Declarative multi-chart preset.
 * `slots` length should match the mode cell count; extras are ignored and
 * short lists are padded from seed.
 */
export interface LayoutRecipe {
  id: string;
  label: string;
  hint: string;
  mode: ChartGridMode;
  slots: LayoutRecipeSlotSpec[];
}

/** Common majors for multi-symbol grids. */
export const MAJOR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const;

/**
 * Built-in one-click layouts.
 * Slot specs may use empty symbol/interval to mean “current chart seed”.
 */
export const LAYOUT_RECIPES: readonly LayoutRecipe[] = [
  {
    id: 'single-focus',
    label: 'Single focus',
    hint: 'One full-width chart (current symbol)',
    mode: '1',
    slots: [{ /* seed symbol + interval */ }],
  },
  {
    id: 'scalp-1m-5m',
    label: 'Scalp 1m+5m',
    hint: 'Same symbol · 1m and 5m stacked',
    mode: '2v',
    slots: [{ interval: '1m' }, { interval: '5m' }],
  },
  {
    id: 'swing-htf-bias',
    label: 'Swing HTF bias',
    hint: 'Same symbol · 1h execution + 1d bias',
    mode: '2h',
    slots: [{ interval: '1h' }, { interval: '1d' }],
  },
  {
    id: 'quad-watch',
    label: 'Quad watch',
    hint: '2×2 grid · majors at 15m / 1h / 4h / 1d',
    mode: '4',
    slots: [
      { symbol: 'BTCUSDT', interval: '15m' },
      { symbol: 'ETHUSDT', interval: '1h' },
      { symbol: 'SOLUSDT', interval: '4h' },
      { symbol: 'BNBUSDT', interval: '1d' },
    ],
  },
  {
    id: 'btc-majors',
    label: 'BTC majors',
    hint: '2×2 · BTC / ETH / SOL / BNB on the same interval',
    mode: '4',
    slots: [
      { symbol: 'BTCUSDT' },
      { symbol: 'ETHUSDT' },
      { symbol: 'SOLUSDT' },
      { symbol: 'BNBUSDT' },
    ],
  },
] as const;

export function findLayoutRecipe(id: string): LayoutRecipe | undefined {
  return LAYOUT_RECIPES.find((r) => r.id === id);
}

/**
 * Resolve a recipe into concrete slot field patches (pure).
 * Does not allocate slot ids — apply step maps onto live grid cells.
 */
export function resolveRecipeSlots(
  recipe: LayoutRecipe,
  seed?: LayoutRecipeSeed,
): Array<{
  symbol: string;
  interval: string;
  exchange: string;
  chartType?: ChartType;
}> {
  const need = slotCountForMode(recipe.mode);
  const baseSymbol = (seed?.symbol || 'BTCUSDT').toUpperCase();
  const baseInterval = seed?.interval || '1d';
  const baseExchange = seed?.exchange || 'binance';
  const baseType = seed?.chartType;

  const out: Array<{
    symbol: string;
    interval: string;
    exchange: string;
    chartType?: ChartType;
  }> = [];

  for (let i = 0; i < need; i++) {
    const spec = recipe.slots[i] || {};
    out.push({
      symbol: (spec.symbol || baseSymbol).toUpperCase(),
      interval: spec.interval || baseInterval,
      exchange: spec.exchange || baseExchange,
      chartType: spec.chartType ?? baseType,
    });
  }
  return out;
}

/**
 * Pure: build a full {@link ChartLayoutState} from a recipe (new slot ids).
 * Useful for tests and previews; live apply prefers store helpers instead.
 */
export function recipeToLayout(
  recipe: LayoutRecipe,
  seed?: LayoutRecipeSeed,
): ChartLayoutState {
  const resolved = resolveRecipeSlots(recipe, seed);
  const slots: ChartSlot[] = resolved.map((r) =>
    createChartSlot({
      symbol: r.symbol,
      interval: r.interval,
      exchange: r.exchange,
      chartType: r.chartType,
    }),
  );
  return {
    mode: recipe.mode,
    activeId: slots[0]!.id,
    slots,
  };
}

/**
 * Apply a layout recipe to the live workspace via store helpers:
 * {@link setChartGridMode} then {@link updateChartSlot} per cell.
 * Focuses the first slot afterward.
 *
 * @returns resolved slot patches that were written (for tests / callers)
 */
export function applyLayoutRecipe(
  recipe: LayoutRecipe,
  seed?: LayoutRecipeSeed,
): ReturnType<typeof resolveRecipeSlots> {
  const resolved = resolveRecipeSlots(recipe, seed);
  setChartGridMode(recipe.mode);

  const live = store.chartLayout?.slots || [];
  for (let i = 0; i < resolved.length; i++) {
    const slot = live[i];
    if (!slot) continue;
    const r = resolved[i]!;
    updateChartSlot(slot.id, {
      symbol: r.symbol,
      interval: r.interval,
      exchange: r.exchange,
      ...(r.chartType != null ? { chartType: r.chartType } : {}),
    });
  }
  if (live[0]) setActiveChartSlot(live[0].id);
  return resolved;
}
