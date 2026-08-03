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
 * Theme token catalog — every editable chart/UI property the Theme Manager
 * knows about. Groups cover chart canvas, bars/candles, grid, scales,
 * crosshair, volume, line/area/baseline series, and chrome accents.
 *
 * Pine Script™ host colors:
 * - `chart.bg_color` (alias `chart.color_background`)
 * - `chart.fg_color` (alias `chart.color_foreground`)
 *
 * @module theme/catalog
 */

import type { ThemeGroupId, ThemeTokenDef, ThemeTokens } from './types';

/** Alias → canonical key (user-friendly / mistaken spellings). */
export const TOKEN_ALIASES: Record<string, string> = {
  'chart.color_background': 'chart.bg_color',
  'chart.color_foreground': 'chart.fg_color',
  'chart.background': 'chart.bg_color',
  'chart.foreground': 'chart.fg_color',
  'chart.bg': 'chart.bg_color',
  'chart.fg': 'chart.fg_color',
  // Common TV-property-style aliases
  'bar.up': 'bar.up.color',
  'bar.down': 'bar.down.color',
  'bar.border': 'bar.border_visible',
  'bar.thickness': 'bar.border_width',
  'bar.thin': 'bar.thin_bars',
  'bar.fill': 'bar.body_fill',
};

/**
 * Full token catalog. Defaults match AXIS void-dark (VOID palette).
 * Order within a group is the UI field order.
 */
export const THEME_TOKEN_DEFS: readonly ThemeTokenDef[] = [
  // ── Chart canvas (Pine host) ──────────────────────────────────────────
  {
    key: 'chart.bg_color',
    group: 'chart',
    label: 'Background',
    description: 'Chart canvas background (Pine: chart.bg_color)',
    type: 'color',
    pine: 'chart.bg_color',
    default: '#0a0b10',
  },
  {
    key: 'chart.fg_color',
    group: 'chart',
    label: 'Foreground',
    description: 'Chart text / foreground (Pine: chart.fg_color)',
    type: 'color',
    pine: 'chart.fg_color',
    default: '#c8cad4',
  },
  {
    key: 'chart.panel',
    group: 'chart',
    label: 'Panel',
    description: 'Elevated panel surface behind overlays',
    type: 'color',
    default: '#111218',
  },
  {
    key: 'chart.elev',
    group: 'chart',
    label: 'Elevated',
    description: 'Crosshair label / tooltip surface',
    type: 'color',
    default: '#171821',
  },

  // ── Bars / candles ────────────────────────────────────────────────────
  {
    key: 'bar.up.color',
    group: 'bar',
    label: 'Up body',
    description: 'Rising candle/bar body fill',
    type: 'color',
    default: '#5ecf8a',
  },
  {
    key: 'bar.up.border',
    group: 'bar',
    label: 'Up border',
    description: 'Rising candle border',
    type: 'color',
    default: '#5ecf8a',
  },
  {
    key: 'bar.up.wick',
    group: 'bar',
    label: 'Up wick',
    description: 'Rising candle wick',
    type: 'color',
    default: '#5ecf8a',
  },
  {
    key: 'bar.down.color',
    group: 'bar',
    label: 'Down body',
    description: 'Falling candle/bar body fill',
    type: 'color',
    default: '#e85d4c',
  },
  {
    key: 'bar.down.border',
    group: 'bar',
    label: 'Down border',
    description: 'Falling candle border',
    type: 'color',
    default: '#e85d4c',
  },
  {
    key: 'bar.down.wick',
    group: 'bar',
    label: 'Down wick',
    description: 'Falling candle wick',
    type: 'color',
    default: '#e85d4c',
  },
  {
    key: 'bar.body_fill',
    group: 'bar',
    label: 'Body fill',
    description: 'Fill candle bodies (off ≈ hollow-style up bars when supported)',
    type: 'boolean',
    default: true,
  },
  {
    key: 'bar.border_visible',
    group: 'bar',
    label: 'Border visible',
    description: 'Show candle body borders',
    type: 'boolean',
    default: true,
  },
  {
    key: 'bar.border_width',
    group: 'bar',
    label: 'Border width',
    description: 'Candle border thickness (LWC uses 1 when borders on)',
    type: 'number',
    default: 1,
    min: 0,
    max: 4,
    step: 1,
  },
  {
    key: 'bar.thin_bars',
    group: 'bar',
    label: 'Thin bars',
    description: 'Use thin OHLC bars (Bar series)',
    type: 'boolean',
    default: true,
  },

  // ── Grid ──────────────────────────────────────────────────────────────
  {
    key: 'grid.vert',
    group: 'grid',
    label: 'Vertical grid',
    type: 'color',
    default: 'rgba(140, 130, 180, 0.07)',
  },
  {
    key: 'grid.horz',
    group: 'grid',
    label: 'Horizontal grid',
    type: 'color',
    default: 'rgba(140, 130, 180, 0.07)',
  },
  {
    key: 'grid.visible',
    group: 'grid',
    label: 'Show grid',
    type: 'boolean',
    default: true,
  },

  // ── Scale / axes ──────────────────────────────────────────────────────
  {
    key: 'scale.border',
    group: 'scale',
    label: 'Scale border',
    type: 'color',
    default: '#3a3d4a',
  },
  {
    key: 'scale.text',
    group: 'scale',
    label: 'Scale text',
    type: 'color',
    default: '#8b8e9c',
  },

  // ── Crosshair ─────────────────────────────────────────────────────────
  {
    key: 'crosshair.color',
    group: 'crosshair',
    label: 'Crosshair',
    type: 'color',
    default: 'rgba(147, 159, 255, 0.38)',
  },
  {
    key: 'crosshair.label_bg',
    group: 'crosshair',
    label: 'Crosshair label',
    type: 'color',
    default: '#171821',
  },

  // ── Volume ────────────────────────────────────────────────────────────
  {
    key: 'volume.up',
    group: 'volume',
    label: 'Volume up',
    type: 'color',
    default: 'rgba(94, 207, 138, 0.45)',
  },
  {
    key: 'volume.down',
    group: 'volume',
    label: 'Volume down',
    type: 'color',
    default: 'rgba(232, 93, 76, 0.45)',
  },

  // ── Line / area main series ───────────────────────────────────────────
  {
    key: 'line.color',
    group: 'line',
    label: 'Line color',
    type: 'color',
    default: '#939fff',
  },
  {
    key: 'line.width',
    group: 'line',
    label: 'Line width',
    type: 'number',
    default: 2,
    min: 1,
    max: 4,
    step: 1,
  },
  {
    key: 'area.line',
    group: 'area',
    label: 'Area line',
    type: 'color',
    default: '#939fff',
  },
  {
    key: 'area.top',
    group: 'area',
    label: 'Area top fill',
    type: 'color',
    default: 'rgba(147, 159, 255, 0.28)',
  },
  {
    key: 'area.bottom',
    group: 'area',
    label: 'Area bottom fill',
    type: 'color',
    default: 'rgba(147, 159, 255, 0.02)',
  },

  // ── Baseline series ───────────────────────────────────────────────────
  {
    key: 'baseline.top_line',
    group: 'baseline',
    label: 'Baseline top line',
    type: 'color',
    default: '#5ecf8a',
  },
  {
    key: 'baseline.bottom_line',
    group: 'baseline',
    label: 'Baseline bottom line',
    type: 'color',
    default: '#e85d4c',
  },
  {
    key: 'baseline.top_fill1',
    group: 'baseline',
    label: 'Baseline top fill 1',
    type: 'color',
    default: 'rgba(94, 207, 138, 0.28)',
  },
  {
    key: 'baseline.top_fill2',
    group: 'baseline',
    label: 'Baseline top fill 2',
    type: 'color',
    default: 'rgba(94, 207, 138, 0.04)',
  },
  {
    key: 'baseline.bottom_fill1',
    group: 'baseline',
    label: 'Baseline bottom fill 1',
    type: 'color',
    default: 'rgba(232, 93, 76, 0.04)',
  },
  {
    key: 'baseline.bottom_fill2',
    group: 'baseline',
    label: 'Baseline bottom fill 2',
    type: 'color',
    default: 'rgba(232, 93, 76, 0.28)',
  },

  // ── UI accents used by chart chrome (optional CSS bridge) ─────────────
  {
    key: 'ui.accent',
    group: 'ui',
    label: 'Accent',
    description: 'Brand accent (void indigo)',
    type: 'color',
    default: '#939fff',
  },
  {
    key: 'ui.up',
    group: 'ui',
    label: 'UI up',
    type: 'color',
    default: '#5ecf8a',
  },
  {
    key: 'ui.down',
    group: 'ui',
    label: 'UI down',
    type: 'color',
    default: '#e85d4c',
  },
] as const;

/** Group metadata for UI section headers. */
export const THEME_GROUPS: readonly {
  id: ThemeGroupId;
  label: string;
  description?: string;
}[] = [
  { id: 'chart', label: 'Chart', description: 'Canvas · Pine chart.bg_color / chart.fg_color' },
  { id: 'bar', label: 'Bars & candles', description: 'Body, border, wick, fill, thickness' },
  { id: 'grid', label: 'Grid', description: 'Vertical / horizontal grid lines' },
  { id: 'scale', label: 'Scales', description: 'Price & time axis borders and labels' },
  { id: 'crosshair', label: 'Crosshair', description: 'Crosshair lines and labels' },
  { id: 'volume', label: 'Volume', description: 'Volume histogram up/down' },
  { id: 'line', label: 'Line', description: 'Line chart series' },
  { id: 'area', label: 'Area', description: 'Area chart series' },
  { id: 'baseline', label: 'Baseline', description: 'Baseline chart series' },
  { id: 'ui', label: 'UI accents', description: 'Accent / signal colors bridged to chrome' },
];

const DEFS_BY_KEY = new Map<string, ThemeTokenDef>(
  THEME_TOKEN_DEFS.map((d) => [d.key, d]),
);

/** Resolve alias → canonical key; unknown keys pass through. */
export function canonicalTokenKey(key: string): string {
  const k = String(key || '').trim();
  if (!k) return k;
  return TOKEN_ALIASES[k] || k;
}

/** Lookup catalog def by key or alias. */
export function getTokenDef(key: string): ThemeTokenDef | undefined {
  return DEFS_BY_KEY.get(canonicalTokenKey(key));
}

/** All defs in a group (UI order). */
export function tokensForGroup(group: ThemeGroupId): ThemeTokenDef[] {
  return THEME_TOKEN_DEFS.filter((d) => d.group === group);
}

/** Default token bag from catalog (void-dark values). */
export function catalogDefaults(): ThemeTokens {
  const out: ThemeTokens = {};
  for (const d of THEME_TOKEN_DEFS) {
    out[d.key] = d.default;
  }
  return out;
}

/**
 * Pine-facing map: official names + user aliases.
 * Used when exposing host colors to engines / docs.
 */
export function pineColorMap(tokens: ThemeTokens): Record<string, string> {
  const bg = String(tokens['chart.bg_color'] ?? '#0a0b10');
  const fg = String(tokens['chart.fg_color'] ?? '#c8cad4');
  return {
    'chart.bg_color': bg,
    'chart.fg_color': fg,
    'chart.color_background': bg,
    'chart.color_foreground': fg,
  };
}
