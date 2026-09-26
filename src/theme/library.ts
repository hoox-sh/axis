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
 * Named custom themes and bar colorings.
 *
 * A saved chart theme stores the full chart snapshot plus its own bar coloring.
 * Bar colorings can also be saved on their own and linked into a theme.
 * Updating a linked bar coloring rewrites every theme that points at it.
 * Editing a bar token on the live chart clears the link until the user
 * saves or applies a bar coloring again.
 *
 * @module theme/library
 */

import { tokensForGroup } from './catalog';
import {
  coerceTokenValue,
  hydrateChartTheme,
  resolveTokens,
  serializeTheme,
  withTokenOverrides,
} from './resolve';
import type {
  BarColorTheme,
  ChartThemeState,
  EmbeddedBarTheme,
  SavedCustomTheme,
  ThemeTokenValue,
  ThemeTokens,
} from './types';

export const MAX_SAVED_THEMES = 40;
export const MAX_BAR_THEMES = 40;
const MAX_THEME_NAME = 48;

const BAR_DEFS = tokensForGroup('bar');
const BAR_KEYS: readonly string[] = BAR_DEFS.map((d) => d.key);

/** Canonical `bar.*` token keys, catalog order. */
export function barTokenKeys(): readonly string[] {
  return BAR_KEYS;
}

export function clampThemeName(name: string): string {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_THEME_NAME);
}

export function newThemeId(prefix: 'thm' | 'bar'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function tokenValueEqual(a: ThemeTokenValue | undefined, b: ThemeTokenValue | undefined): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

/** Full resolved bar-group tokens for the live (or saved) chart theme. */
export function barTokensFromState(state: ChartThemeState | null | undefined): ThemeTokens {
  const resolved = resolveTokens(state);
  const out: ThemeTokens = {};
  for (const key of BAR_KEYS) {
    const value = resolved[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Fill missing bar keys from the void-dark catalog so a palette is always complete. */
export function fillBarTokens(partial: ThemeTokens): ThemeTokens {
  return { ...barTokensFromState(null), ...partial };
}

/** Keep valid `bar.*` keys. Unlike chart overrides, catalog defaults are kept. */
export function coerceBarTokenBag(raw: unknown): ThemeTokens {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const bag = raw as Record<string, unknown>;
  const out: ThemeTokens = {};
  for (const def of BAR_DEFS) {
    if (!(def.key in bag)) continue;
    const coerced = coerceTokenValue(def, bag[def.key]);
    if (coerced !== undefined) out[def.key] = coerced;
  }
  return out;
}

export function barTokensEqual(a: ThemeTokens | null | undefined, b: ThemeTokens | null | undefined): boolean {
  const left = a || {};
  const right = b || {};
  for (const key of BAR_KEYS) {
    if (!tokenValueEqual(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Replace only bar-group overrides. Other tokens stay.
 * `barThemeId` is the library entry these colors came from.
 */
export function withBarColorTheme(
  state: ChartThemeState,
  tokens: ThemeTokens,
  barThemeId: string | null,
): ChartThemeState {
  const kept: ThemeTokens = {};
  const normalized = state.overrides || {};
  for (const [key, value] of Object.entries(normalized)) {
    if (!BAR_KEYS.includes(key)) kept[key] = value;
  }
  const next = withTokenOverrides(
    {
      presetId: state.presetId,
      base: state.base,
      overrides: kept,
      barThemeId: null,
    },
    coerceBarTokenBag(tokens),
  );
  const linked = barThemeId?.trim() || null;
  return { ...next, barThemeId: linked };
}

export function captureCustomTheme(args: {
  id: string;
  name: string;
  state: ChartThemeState;
  barThemes: readonly BarColorTheme[];
  activeBarThemeId: string | null;
  /** Previous embedded coloring, so a tweak keeps its name when the link breaks. */
  previousBar?: EmbeddedBarTheme | null;
  now?: number;
}): SavedCustomTheme {
  const name = clampThemeName(args.name) || 'Theme';
  const tokens = barTokensFromState(args.state);
  const linked = args.activeBarThemeId
    ? args.barThemes.find((bar) => bar.id === args.activeBarThemeId) ?? null
    : null;
  const linkedOk = linked && barTokensEqual(tokens, linked.tokens) ? linked : null;
  const previous = args.previousBar ?? null;
  const barName = linkedOk?.name || previous?.name || `${name} bars`;
  const refId = linkedOk?.id ?? null;
  const theme = serializeTheme(args.state);
  return {
    id: args.id,
    name,
    theme: { ...theme, barThemeId: refId },
    barTheme: {
      refId,
      name: clampThemeName(barName) || `${name} bars`,
      tokens,
    },
    updatedAt: args.now ?? Date.now(),
  };
}

/** Write a library bar coloring into a saved theme's own copy. */
export function attachBarTheme(theme: SavedCustomTheme, bar: BarColorTheme): SavedCustomTheme {
  return {
    ...theme,
    updatedAt: bar.updatedAt,
    theme: withBarColorTheme(theme.theme, bar.tokens, bar.id),
    barTheme: {
      refId: bar.id,
      name: bar.name,
      tokens: { ...bar.tokens },
    },
  };
}

/** Themes that reference `bar` get that coloring's latest name and tokens. */
export function syncBarThemeIntoCharts(
  themes: readonly SavedCustomTheme[],
  bar: BarColorTheme,
): SavedCustomTheme[] {
  return themes.map((theme) => (theme.barTheme.refId === bar.id ? attachBarTheme(theme, bar) : theme));
}

/** Drop the library link. The theme keeps the colors it already has. */
export function detachBarThemeRef(
  themes: readonly SavedCustomTheme[],
  barId: string,
): SavedCustomTheme[] {
  return themes.map((theme) => {
    if (theme.barTheme.refId !== barId) return theme;
    return {
      ...theme,
      theme: { ...theme.theme, barThemeId: null },
      barTheme: { ...theme.barTheme, refId: null },
    };
  });
}

function hydrateEmbeddedBar(
  raw: unknown,
  theme: ChartThemeState,
  fallbackName: string,
): EmbeddedBarTheme {
  const bag = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const fromTheme = barTokensFromState(theme);
  const patch = coerceBarTokenBag(bag.tokens);
  const tokens = { ...fromTheme, ...patch };
  const name = clampThemeName(typeof bag.name === 'string' ? bag.name : '') || fallbackName;
  const refId = typeof bag.refId === 'string' && bag.refId.trim() ? bag.refId.trim() : null;
  return { refId, name, tokens };
}

export function hydrateBarColorTheme(raw: unknown): BarColorTheme | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bag = raw as Record<string, unknown>;
  const id = typeof bag.id === 'string' ? bag.id.trim() : '';
  const name = clampThemeName(typeof bag.name === 'string' ? bag.name : '');
  if (!id || !name) return null;
  const tokens = fillBarTokens(coerceBarTokenBag(bag.tokens));
  const updatedAt = typeof bag.updatedAt === 'number' && Number.isFinite(bag.updatedAt) ? bag.updatedAt : 0;
  return { id, name, tokens, updatedAt };
}

export function hydrateSavedCustomTheme(raw: unknown): SavedCustomTheme | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const bag = raw as Record<string, unknown>;
  const id = typeof bag.id === 'string' ? bag.id.trim() : '';
  const name = clampThemeName(typeof bag.name === 'string' ? bag.name : '');
  if (!id || !name) return null;
  const theme = hydrateChartTheme(bag.theme);
  const barTheme = hydrateEmbeddedBar(bag.barTheme, theme, `${name} bars`);
  const updatedAt = typeof bag.updatedAt === 'number' && Number.isFinite(bag.updatedAt) ? bag.updatedAt : 0;
  return {
    id,
    name,
    theme: { ...theme, barThemeId: barTheme.refId },
    barTheme,
    updatedAt,
  };
}

function takeNamed<T extends { id: string; name: string }>(
  raw: unknown,
  limit: number,
  hydrate: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const item of raw) {
    const next = hydrate(item);
    if (!next) continue;
    const nameKey = next.name.toLowerCase();
    if (ids.has(next.id) || names.has(nameKey)) continue;
    ids.add(next.id);
    names.add(nameKey);
    out.push(next);
    if (out.length >= limit) break;
  }
  return out;
}

export function hydrateBarColorThemes(raw: unknown): BarColorTheme[] {
  return takeNamed(raw, MAX_BAR_THEMES, hydrateBarColorTheme);
}

export function hydrateSavedChartThemes(raw: unknown): SavedCustomTheme[] {
  return takeNamed(raw, MAX_SAVED_THEMES, hydrateSavedCustomTheme);
}

/** Next "Theme 2" / "Bars 2" label that does not collide. */
export function nextThemeName(list: readonly { name: string }[], prefix: string): string {
  const taken = new Set(list.map((item) => item.name.toLowerCase()));
  if (!taken.has(prefix.toLowerCase())) return prefix;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${prefix} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${prefix} ${list.length + 1}`;
}
