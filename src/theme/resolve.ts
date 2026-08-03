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
 * Theme resolution — merge preset + overrides, normalize keys, clamp values.
 *
 * @module theme/resolve
 */

import {
  THEME_TOKEN_DEFS,
  canonicalTokenKey,
  catalogDefaults,
  getTokenDef,
} from './catalog';
import { getPreset } from './presets';
import type {
  ChartThemeState,
  ThemeTokenDef,
  ThemeTokenValue,
  ThemeTokens,
} from './types';

/** Default store shape for chart theme. */
export function defaultChartThemeState(): ChartThemeState {
  return {
    presetId: 'void-dark',
    base: 'dark',
    overrides: {},
  };
}

/**
 * Normalize a raw overrides bag: alias → canonical, drop unknown keys,
 * coerce types / clamp numbers.
 */
export function normalizeOverrides(raw: unknown): ThemeTokens {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ThemeTokens = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = canonicalTokenKey(k);
    const def = getTokenDef(key);
    if (!def) continue;
    const coerced = coerceTokenValue(def, v);
    if (coerced === undefined) continue;
    // Skip values identical to catalog default — keeps payload small
    if (valuesEqual(coerced, def.default)) continue;
    out[key] = coerced;
  }
  return out;
}

function valuesEqual(a: ThemeTokenValue, b: ThemeTokenValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9;
  }
  return a === b;
}

/** Coerce a raw value to the def's type; undefined if unusable. */
export function coerceTokenValue(
  def: ThemeTokenDef,
  raw: unknown,
): ThemeTokenValue | undefined {
  if (raw === undefined || raw === null) return undefined;
  switch (def.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1 || raw === '1') return true;
      if (raw === 'false' || raw === 0 || raw === '0') return false;
      return undefined;
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return undefined;
      let v = n;
      if (def.min != null) v = Math.max(def.min, v);
      if (def.max != null) v = Math.min(def.max, v);
      if (def.step != null && def.step > 0) {
        const base = def.min ?? 0;
        v = base + Math.round((v - base) / def.step) * def.step;
      }
      return v;
    }
    case 'color': {
      if (typeof raw !== 'string') return undefined;
      const s = raw.trim();
      if (!s) return undefined;
      // Accept #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), named
      if (
        /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) ||
        /^(rgb|rgba|hsl|hsla)\(/i.test(s) ||
        /^[a-zA-Z]+$/.test(s)
      ) {
        return s;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Hydrate durable theme state from localStorage / snapshot.
 * Tolerates partial / legacy shapes.
 */
export function hydrateChartTheme(raw: unknown): ChartThemeState {
  const d = defaultChartThemeState();
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const bag = raw as Record<string, unknown>;
  const presetId =
    typeof bag.presetId === 'string' && bag.presetId.trim()
      ? bag.presetId.trim()
      : d.presetId;
  const base =
    bag.base === 'light' || bag.base === 'dark'
      ? bag.base
      : getPreset(presetId).base;
  const overrides = normalizeOverrides(bag.overrides ?? bag.tokens);
  return { presetId, base, overrides };
}

/**
 * Full resolved token map (catalog defaults ← preset ← overrides).
 */
export function resolveTokens(state: ChartThemeState | null | undefined): ThemeTokens {
  const s = state ?? defaultChartThemeState();
  const preset = getPreset(s.presetId === 'custom' ? s.base === 'light' ? 'void-light' : 'void-dark' : s.presetId);
  // When custom, start from base-matching void preset so light chrome still has light canvas defaults
  const baseTokens =
    s.presetId === 'custom'
      ? getPreset(s.base === 'light' ? 'void-light' : 'void-dark').tokens
      : preset.tokens;
  const overrides = normalizeOverrides(s.overrides);
  return { ...catalogDefaults(), ...baseTokens, ...overrides };
}

/** Read one token (supports aliases). */
export function getToken(
  state: ChartThemeState | null | undefined,
  key: string,
): ThemeTokenValue {
  const tokens = resolveTokens(state);
  const canon = canonicalTokenKey(key);
  const v = tokens[canon];
  if (v !== undefined) return v;
  return getTokenDef(canon)?.default ?? '';
}

/** String helper for color tokens. */
export function getColor(
  state: ChartThemeState | null | undefined,
  key: string,
): string {
  return String(getToken(state, key));
}

/**
 * Apply a single override; returns new state (immutable).
 * Sets `presetId` to `custom` when the value differs from the active preset.
 */
export function withTokenOverride(
  state: ChartThemeState,
  key: string,
  value: ThemeTokenValue,
): ChartThemeState {
  const canon = canonicalTokenKey(key);
  const def = getTokenDef(canon);
  if (!def) return state;
  const coerced = coerceTokenValue(def, value);
  if (coerced === undefined) return state;

  const preset = getPreset(
    state.presetId === 'custom'
      ? state.base === 'light'
        ? 'void-light'
        : 'void-dark'
      : state.presetId,
  );
  const nextOverrides = { ...normalizeOverrides(state.overrides) };
  const presetVal = preset.tokens[canon] ?? def.default;

  if (valuesEqual(coerced, presetVal) && state.presetId !== 'custom') {
    delete nextOverrides[canon];
  } else if (valuesEqual(coerced, presetVal) && state.presetId === 'custom') {
    delete nextOverrides[canon];
  } else {
    nextOverrides[canon] = coerced;
  }

  // Stay on named preset if no overrides remain and value matches preset
  const hasOverrides = Object.keys(nextOverrides).length > 0;
  if (!hasOverrides && valuesEqual(coerced, presetVal) && state.presetId !== 'custom') {
    return { ...state, overrides: {} };
  }

  return {
    presetId: hasOverrides || state.presetId === 'custom' ? (hasOverrides ? 'custom' : state.presetId) : state.presetId,
    base: state.base,
    overrides: nextOverrides,
  };
}

/** Switch to a named preset (clears overrides). */
export function withPreset(presetId: string): ChartThemeState {
  const p = getPreset(presetId);
  return {
    presetId: p.id,
    base: p.base,
    overrides: {},
  };
}

/**
 * Patch many overrides at once. Marks `custom` when any override remains.
 */
export function withTokenOverrides(
  state: ChartThemeState,
  patch: ThemeTokens,
): ChartThemeState {
  let next = state;
  for (const [k, v] of Object.entries(patch)) {
    next = withTokenOverride(next, k, v);
  }
  return next;
}

/** Reset overrides but keep base + last named preset if recoverable. */
export function resetOverrides(state: ChartThemeState): ChartThemeState {
  if (state.presetId === 'custom') {
    return withPreset(state.base === 'light' ? 'void-light' : 'void-dark');
  }
  return withPreset(state.presetId);
}

/** Whether two theme states paint the same. */
export function themesEqual(a: ChartThemeState, b: ChartThemeState): boolean {
  if (a.presetId !== b.presetId || a.base !== b.base) return false;
  const ak = Object.keys(a.overrides).sort();
  const bk = Object.keys(b.overrides).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!valuesEqual(a.overrides[ak[i]!]!, b.overrides[bk[i]!]!)) return false;
  }
  return true;
}

/** Snapshot for persist / debug. */
export function serializeTheme(state: ChartThemeState): ChartThemeState {
  return {
    presetId: state.presetId,
    base: state.base,
    overrides: normalizeOverrides(state.overrides),
  };
}

/** All catalog keys (canonical). */
export function allTokenKeys(): string[] {
  return THEME_TOKEN_DEFS.map((d) => d.key);
}
