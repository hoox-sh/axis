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
 * Built-in bar/candle color packs — one per chart preset.
 * Shown in the Theme library alongside user-saved bar themes.
 *
 * @module theme/bar-packs
 */

import { tokensForGroup } from './catalog';
import { THEME_PRESETS } from './presets';
import type { BarColorTheme, ThemeTokens } from './types';

const BAR_KEYS = tokensForGroup('bar').map((d) => d.key);

function barTokensFromPreset(tokens: ThemeTokens): ThemeTokens {
  const out: ThemeTokens = {};
  for (const key of BAR_KEYS) {
    const value = tokens[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const CANDLE_NAMES: Record<string, string> = {
  'void-dark': 'AXIS Void candles',
  volt: 'PYNE Volt candles',
  signal: 'HOOX Signal candles',
  'void-light': 'Void Light candles',
  classic: 'Classic candles',
  mono: 'Mono candles',
  obsidian: 'Obsidian candles',
  graphite: 'Graphite candles',
  pacific: 'Pacific candles',
  dusk: 'Dusk candles',
  porcelain: 'Porcelain candles',
  parchment: 'Parchment candles',
  'ayu-dark': 'Ayu Dark candles',
  'ayu-mirage': 'Ayu Mirage candles',
  'ayu-light': 'Ayu Light candles',
  'tokyo-night': 'Tokyo Night candles',
  'tokyo-night-storm': 'Tokyo Night Storm candles',
  nord: 'Nord candles',
  'one-dark': 'One Dark candles',
  'rose-pine': 'Rosé Pine candles',
  'rose-pine-moon': 'Rosé Pine Moon candles',
};

/** Stable builtin id for a chart preset's candle pack. */
export function builtinBarThemeId(presetId: string): string {
  return `builtin:${presetId}`;
}

/** One bar coloring per THEME_PRESETS entry. */
export const BUILTIN_BAR_THEMES: readonly BarColorTheme[] = THEME_PRESETS.map((preset) => ({
  id: builtinBarThemeId(preset.id),
  name: CANDLE_NAMES[preset.id] || `${preset.name} candles`,
  tokens: barTokensFromPreset(preset.tokens),
  updatedAt: 0,
}));

const BY_ID = new Map(BUILTIN_BAR_THEMES.map((bar) => [bar.id, bar]));

/** Builtin candle pack for an id like `builtin:volt`, or null when unknown. */
export function getBuiltinBarTheme(id: string | null | undefined): BarColorTheme | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

/** True for ids minted by {@link builtinBarThemeId} (the `builtin:` prefix). */
export function isBuiltinBarThemeId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('builtin:');
}

/** Resolve a bar coloring from builtins or a user library list. */
export function resolveBarColorTheme(
  id: string,
  saved: readonly BarColorTheme[] | null | undefined,
): BarColorTheme | null {
  const builtin = getBuiltinBarTheme(id);
  if (builtin) return builtin;
  return (saved || []).find((bar) => bar.id === id) ?? null;
}
