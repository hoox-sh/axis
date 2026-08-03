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
 * AXIS chart Theme Manager — types.
 *
 * Token keys follow Pine Script™ host surface names where they exist
 * (`chart.bg_color`, `chart.fg_color`) and dotted group paths for chart
 * properties that Pine does not expose as runtime variables
 * (`bar.up.color`, `grid.vert`, …).
 *
 * Aliases:
 * - `chart.color_background` → `chart.bg_color`
 * - `chart.color_foreground` → `chart.fg_color`
 *
 * @module theme/types
 */

/** High-level component group for UI sections and catalog filtering. */
export type ThemeGroupId =
  | 'chart'
  | 'bar'
  | 'grid'
  | 'scale'
  | 'crosshair'
  | 'volume'
  | 'line'
  | 'area'
  | 'baseline'
  | 'ui';

/** Value kind for a theme token. */
export type ThemeTokenType = 'color' | 'number' | 'boolean';

/** Scalar value stored for a token. */
export type ThemeTokenValue = string | number | boolean;

/**
 * Catalog entry describing one editable token.
 * Keys are stable dotted paths (e.g. `bar.up.color`).
 */
export interface ThemeTokenDef {
  /** Canonical dotted key (never an alias). */
  key: string;
  group: ThemeGroupId;
  /** Short UI label. */
  label: string;
  /** Longer hint / Pine name. */
  description?: string;
  type: ThemeTokenType;
  /** Official Pine Script™ name when this maps to a host series variable. */
  pine?: string;
  /** Default value for void-dark preset. */
  default: ThemeTokenValue;
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Resolved token bag — every catalog key present with a concrete value.
 * Also may hold alias keys when building the Pine-facing map.
 */
export type ThemeTokens = Record<string, ThemeTokenValue>;

/**
 * User / preset theme: base chrome mode + partial token overrides.
 * Missing keys fall back to the preset for `base` (or void-dark).
 */
export interface ChartThemeState {
  /**
   * Named preset id (`void-dark`, `void-light`, `classic`, …)
   * or `custom` when the user has edited tokens.
   */
  presetId: string;
  /**
   * UI chrome mode (`data-theme` on `<html>`).
   * Independent of chart canvas colors when tokens override them.
   */
  base: 'dark' | 'light';
  /**
   * Partial overrides on top of the selected preset defaults.
   * Keys may be aliases; they are normalized on write.
   */
  overrides: ThemeTokens;
}

/** Built-in named preset (full token set). */
export interface ThemePreset {
  id: string;
  name: string;
  description?: string;
  base: 'dark' | 'light';
  tokens: ThemeTokens;
}

/** Options when applying a theme to a Lightweight Charts instance. */
export interface ApplyChartThemeOpts {
  /** When false, leave price scale visibility alone. Default true. */
  applyPriceScale?: boolean;
  /** Secondary pane (volume/indicator) — hide time scale chrome. */
  secondary?: boolean;
}

/** Options when applying price-series colors. */
export interface ApplySeriesThemeOpts {
  /** Chart type affects hollow body / thin bars. */
  chartType?: string;
}
