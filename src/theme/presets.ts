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
 * Built-in chart theme presets.
 *
 * @module theme/presets
 */

import { catalogDefaults } from './catalog';
import type { ThemePreset, ThemeTokens } from './types';

function withTokens(patch: ThemeTokens): ThemeTokens {
  return { ...catalogDefaults(), ...patch };
}

/** Default AXIS void-dark (matches VOID in series-factory). */
export const PRESET_VOID_DARK: ThemePreset = {
  id: 'void-dark',
  name: 'Void Dark',
  description: 'Default AXIS void indigo canvas',
  base: 'dark',
  tokens: catalogDefaults(),
};

/** Soft void lift — light chrome + light chart. */
export const PRESET_VOID_LIGHT: ThemePreset = {
  id: 'void-light',
  name: 'Void Light',
  description: 'Soft void lift for bright rooms',
  base: 'light',
  tokens: withTokens({
    'chart.bg_color': '#f4f3f8',
    'chart.fg_color': '#1a1b24',
    'chart.panel': '#ebeaf2',
    'chart.elev': '#e0dfe8',
    'bar.up.color': '#2e9e58',
    'bar.up.border': '#2e9e58',
    'bar.up.wick': '#2e9e58',
    'bar.down.color': '#c44538',
    'bar.down.border': '#c44538',
    'bar.down.wick': '#c44538',
    'grid.vert': 'rgba(60, 55, 90, 0.12)',
    'grid.horz': 'rgba(60, 55, 90, 0.12)',
    'scale.border': '#b8b6c4',
    'scale.text': '#5c5f6e',
    'crosshair.color': 'rgba(90, 106, 212, 0.45)',
    'crosshair.label_bg': '#e0dfe8',
    'volume.up': 'rgba(46, 158, 88, 0.4)',
    'volume.down': 'rgba(196, 69, 56, 0.4)',
    'line.color': '#5a6ad4',
    'area.line': '#5a6ad4',
    'area.top': 'rgba(90, 106, 212, 0.22)',
    'area.bottom': 'rgba(90, 106, 212, 0.02)',
    'baseline.top_line': '#2e9e58',
    'baseline.bottom_line': '#c44538',
    'baseline.top_fill1': 'rgba(46, 158, 88, 0.22)',
    'baseline.top_fill2': 'rgba(46, 158, 88, 0.04)',
    'baseline.bottom_fill1': 'rgba(196, 69, 56, 0.04)',
    'baseline.bottom_fill2': 'rgba(196, 69, 56, 0.22)',
    'ui.accent': '#5a6ad4',
    'ui.up': '#2e9e58',
    'ui.down': '#c44538',
  }),
};

/** Classic black / green-red trading colors. */
export const PRESET_CLASSIC: ThemePreset = {
  id: 'classic',
  name: 'Classic',
  description: 'Black canvas · classic green/red candles',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#000000',
    'chart.fg_color': '#d1d4dc',
    'chart.panel': '#0c0c0c',
    'chart.elev': '#121212',
    'bar.up.color': '#26a69a',
    'bar.up.border': '#26a69a',
    'bar.up.wick': '#26a69a',
    'bar.down.color': '#ef5350',
    'bar.down.border': '#ef5350',
    'bar.down.wick': '#ef5350',
    'grid.vert': 'rgba(42, 46, 57, 0.6)',
    'grid.horz': 'rgba(42, 46, 57, 0.6)',
    'scale.border': '#2a2e39',
    'scale.text': '#787b86',
    'crosshair.color': 'rgba(224, 227, 235, 0.25)',
    'crosshair.label_bg': '#2a2e39',
    'volume.up': 'rgba(38, 166, 154, 0.5)',
    'volume.down': 'rgba(239, 83, 80, 0.5)',
    'line.color': '#2962ff',
    'area.line': '#2962ff',
    'area.top': 'rgba(41, 98, 255, 0.28)',
    'area.bottom': 'rgba(41, 98, 255, 0.05)',
    'ui.accent': '#2962ff',
  }),
};

/** Monochrome — blue-gray bars, minimal chroma. */
export const PRESET_MONO: ThemePreset = {
  id: 'mono',
  name: 'Mono',
  description: 'Cool gray candles for low-distraction focus',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#0d0f12',
    'chart.fg_color': '#c5c9d1',
    'bar.up.color': '#9aa3b2',
    'bar.up.border': '#b0b8c6',
    'bar.up.wick': '#7a8494',
    'bar.down.color': '#4a5160',
    'bar.down.border': '#5c6575',
    'bar.down.wick': '#3a4150',
    'volume.up': 'rgba(154, 163, 178, 0.4)',
    'volume.down': 'rgba(74, 81, 96, 0.5)',
    'line.color': '#a7b0c0',
    'area.line': '#a7b0c0',
    'area.top': 'rgba(167, 176, 192, 0.25)',
    'area.bottom': 'rgba(167, 176, 192, 0.02)',
    'ui.accent': '#a7b0c0',
    'ui.up': '#9aa3b2',
    'ui.down': '#5c6575',
  }),
};

/** High-contrast accessibility-friendly pair. */
export const PRESET_HIGH_CONTRAST: ThemePreset = {
  id: 'high-contrast',
  name: 'High Contrast',
  description: 'Bright up/down on near-black canvas',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#000000',
    'chart.fg_color': '#ffffff',
    'chart.panel': '#0a0a0a',
    'chart.elev': '#141414',
    'bar.up.color': '#00e676',
    'bar.up.border': '#00e676',
    'bar.up.wick': '#00e676',
    'bar.down.color': '#ff1744',
    'bar.down.border': '#ff1744',
    'bar.down.wick': '#ff1744',
    'grid.vert': 'rgba(255, 255, 255, 0.12)',
    'grid.horz': 'rgba(255, 255, 255, 0.12)',
    'scale.border': '#ffffff',
    'scale.text': '#eeeeee',
    'crosshair.color': 'rgba(255, 255, 255, 0.55)',
    'crosshair.label_bg': '#222222',
    'volume.up': 'rgba(0, 230, 118, 0.55)',
    'volume.down': 'rgba(255, 23, 68, 0.55)',
    'line.color': '#40c4ff',
    'area.line': '#40c4ff',
    'area.top': 'rgba(64, 196, 255, 0.3)',
    'area.bottom': 'rgba(64, 196, 255, 0.04)',
    'ui.accent': '#40c4ff',
    'ui.up': '#00e676',
    'ui.down': '#ff1744',
  }),
};

/** All built-in presets in UI order. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  PRESET_VOID_DARK,
  PRESET_VOID_LIGHT,
  PRESET_CLASSIC,
  PRESET_MONO,
  PRESET_HIGH_CONTRAST,
];

const BY_ID = new Map(THEME_PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string | undefined | null): ThemePreset {
  if (id && BY_ID.has(id)) return BY_ID.get(id)!;
  return PRESET_VOID_DARK;
}

export function listPresets(): ThemePreset[] {
  return [...THEME_PRESETS];
}
