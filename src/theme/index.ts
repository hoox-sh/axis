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
 * AXIS Theme Manager — public API.
 *
 * Pine Script™ host colors:
 * - `chart.bg_color` / alias `chart.color_background`
 * - `chart.fg_color` / alias `chart.color_foreground`
 *
 * Component groups: chart, bar, grid, scale, crosshair, volume, line, area,
 * baseline, ui — each with typed tokens the user can override.
 *
 * @module theme
 */

export type {
  ThemeGroupId,
  ThemeTokenType,
  ThemeTokenValue,
  ThemeTokenDef,
  ThemeTokens,
  ChartThemeState,
  ThemePreset,
  ApplyChartThemeOpts,
  ApplySeriesThemeOpts,
} from './types';

export {
  TOKEN_ALIASES,
  THEME_TOKEN_DEFS,
  THEME_GROUPS,
  canonicalTokenKey,
  getTokenDef,
  tokensForGroup,
  catalogDefaults,
  pineColorMap,
} from './catalog';

export {
  PRESET_VOID_DARK,
  PRESET_VOID_LIGHT,
  PRESET_CLASSIC,
  PRESET_MONO,
  PRESET_OBSIDIAN,
  PRESET_GRAPHITE,
  PRESET_PACIFIC,
  PRESET_DUSK,
  PRESET_PORCELAIN,
  PRESET_PARCHMENT,
  /** @deprecated alias of classic */
  PRESET_HIGH_CONTRAST,
  THEME_PRESETS,
  getPreset,
  listPresets,
} from './presets';

export {
  defaultChartThemeState,
  normalizeOverrides,
  coerceTokenValue,
  hydrateChartTheme,
  resolveTokens,
  getToken,
  getColor,
  withTokenOverride,
  withPreset,
  withTokenOverrides,
  resetOverrides,
  themesEqual,
  serializeTheme,
  allTokenKeys,
} from './resolve';

export {
  applyThemeToDocument,
  buildChartOptionsFromTokens,
  applyThemeToChart,
  buildCandleSeriesOptions,
  buildBarSeriesOptions,
  buildLineSeriesOptions,
  buildAreaSeriesOptions,
  buildBaselineSeriesOptions,
  applyThemeToPriceSeries,
  volumeColors,
  tokensToVoidLike,
  pineHostColors,
} from './apply';

export { ThemeManager, getThemeManager, resetThemeManagerForTests } from './manager';
