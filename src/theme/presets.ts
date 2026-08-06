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
 * Built-in chart theme presets — high-end, session-friendly palettes.
 *
 * Design goals: soft surface hierarchy (bg → panel → elev), restrained
 * candle chroma, whisper grids, no neon / pure-black high-contrast tricks.
 * Ten curated presets for optimal long-session charting.
 *
 * @module theme/presets
 */

import { catalogDefaults } from './catalog';
import type { ThemePreset, ThemeTokens } from './types';

function withTokens(patch: ThemeTokens): ThemeTokens {
  return { ...catalogDefaults(), ...patch };
}

// ── Foundations ──────────────────────────────────────────────────────────

/** Default AXIS void-dark (matches VOID in series-factory). */
export const PRESET_VOID_DARK: ThemePreset = {
  id: 'void-dark',
  name: 'Void Dark',
  description: 'Signature void indigo canvas · balanced for all-day use',
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
    'bar.up.wick': '#28904f',
    'bar.down.color': '#c44538',
    'bar.down.border': '#c44538',
    'bar.down.wick': '#b03d32',
    'grid.vert': 'rgba(60, 55, 90, 0.10)',
    'grid.horz': 'rgba(60, 55, 90, 0.10)',
    'scale.border': '#b8b6c4',
    'scale.text': '#5c5f6e',
    'crosshair.color': 'rgba(90, 106, 212, 0.40)',
    'crosshair.label_bg': '#e0dfe8',
    'volume.up': 'rgba(46, 158, 88, 0.36)',
    'volume.down': 'rgba(196, 69, 56, 0.36)',
    'line.color': '#5a6ad4',
    'area.line': '#5a6ad4',
    'area.top': 'rgba(90, 106, 212, 0.20)',
    'area.bottom': 'rgba(90, 106, 212, 0.02)',
    'baseline.top_line': '#2e9e58',
    'baseline.bottom_line': '#c44538',
    'baseline.top_fill1': 'rgba(46, 158, 88, 0.20)',
    'baseline.top_fill2': 'rgba(46, 158, 88, 0.03)',
    'baseline.bottom_fill1': 'rgba(196, 69, 56, 0.03)',
    'baseline.bottom_fill2': 'rgba(196, 69, 56, 0.20)',
    'ui.accent': '#5a6ad4',
    'ui.up': '#2e9e58',
    'ui.down': '#c44538',
  }),
};

/**
 * Classic trading desk — refined off-black (not pure #000), teal/coral candles.
 */
export const PRESET_CLASSIC: ThemePreset = {
  id: 'classic',
  name: 'Classic',
  description: 'Refined trading desk · teal & coral on soft black',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#0b0c0e',
    'chart.fg_color': '#cfd2d8',
    'chart.panel': '#111316',
    'chart.elev': '#171a1e',
    'bar.up.color': '#2f9e90',
    'bar.up.border': '#2f9e90',
    'bar.up.wick': '#288c80',
    'bar.down.color': '#e0706c',
    'bar.down.border': '#e0706c',
    'bar.down.wick': '#c8625e',
    'grid.vert': 'rgba(70, 78, 96, 0.22)',
    'grid.horz': 'rgba(70, 78, 96, 0.22)',
    'scale.border': '#2a303a',
    'scale.text': '#7a808c',
    'crosshair.color': 'rgba(200, 208, 220, 0.22)',
    'crosshair.label_bg': '#1c2026',
    'volume.up': 'rgba(47, 158, 144, 0.40)',
    'volume.down': 'rgba(224, 112, 108, 0.40)',
    'line.color': '#5b7cfa',
    'area.line': '#5b7cfa',
    'area.top': 'rgba(91, 124, 250, 0.22)',
    'area.bottom': 'rgba(91, 124, 250, 0.03)',
    'baseline.top_line': '#2f9e90',
    'baseline.bottom_line': '#e0706c',
    'baseline.top_fill1': 'rgba(47, 158, 144, 0.18)',
    'baseline.top_fill2': 'rgba(47, 158, 144, 0.03)',
    'baseline.bottom_fill1': 'rgba(224, 112, 108, 0.03)',
    'baseline.bottom_fill2': 'rgba(224, 112, 108, 0.18)',
    'ui.accent': '#5b7cfa',
    'ui.up': '#2f9e90',
    'ui.down': '#e0706c',
  }),
};

/** Monochrome — cool blue-gray bars, minimal chroma. */
export const PRESET_MONO: ThemePreset = {
  id: 'mono',
  name: 'Mono',
  description: 'Cool graphite candles · low-distraction focus',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#0d0f12',
    'chart.fg_color': '#c5c9d1',
    'chart.panel': '#13161b',
    'chart.elev': '#191d24',
    'bar.up.color': '#9aa3b2',
    'bar.up.border': '#aeb6c4',
    'bar.up.wick': '#7a8494',
    'bar.down.color': '#4e5666',
    'bar.down.border': '#5c6575',
    'bar.down.wick': '#3e4554',
    'grid.vert': 'rgba(130, 140, 155, 0.07)',
    'grid.horz': 'rgba(130, 140, 155, 0.07)',
    'scale.border': '#2a303a',
    'scale.text': '#787f8c',
    'crosshair.color': 'rgba(170, 178, 190, 0.28)',
    'crosshair.label_bg': '#191d24',
    'volume.up': 'rgba(154, 163, 178, 0.36)',
    'volume.down': 'rgba(78, 86, 102, 0.42)',
    'line.color': '#a7b0c0',
    'area.line': '#a7b0c0',
    'area.top': 'rgba(167, 176, 192, 0.20)',
    'area.bottom': 'rgba(167, 176, 192, 0.02)',
    'baseline.top_line': '#9aa3b2',
    'baseline.bottom_line': '#5c6575',
    'baseline.top_fill1': 'rgba(154, 163, 178, 0.18)',
    'baseline.top_fill2': 'rgba(154, 163, 178, 0.03)',
    'baseline.bottom_fill1': 'rgba(92, 101, 117, 0.03)',
    'baseline.bottom_fill2': 'rgba(92, 101, 117, 0.18)',
    'ui.accent': '#a7b0c0',
    'ui.up': '#9aa3b2',
    'ui.down': '#5c6575',
  }),
};

// ── Dark luxury / atmospheric ────────────────────────────────────────────

/** Warm-black luxury desk · muted sage & soft coral · gold accent. */
export const PRESET_OBSIDIAN: ThemePreset = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'Warm-black luxury desk · muted sage & soft coral',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#100e0c',
    'chart.fg_color': '#c8c3b8',
    'chart.panel': '#171412',
    'chart.elev': '#1e1a17',
    'bar.up.color': '#7f9a82',
    'bar.up.border': '#8ba68e',
    'bar.up.wick': '#6d8670',
    'bar.down.color': '#c48478',
    'bar.down.border': '#d09488',
    'bar.down.wick': '#ad7468',
    'grid.vert': 'rgba(186, 168, 128, 0.055)',
    'grid.horz': 'rgba(186, 168, 128, 0.055)',
    'scale.border': '#2c2824',
    'scale.text': '#7d7870',
    'crosshair.color': 'rgba(196, 178, 140, 0.28)',
    'crosshair.label_bg': '#1e1a17',
    'volume.up': 'rgba(127, 154, 130, 0.32)',
    'volume.down': 'rgba(196, 132, 120, 0.32)',
    'line.color': '#c4a574',
    'area.line': '#c4a574',
    'area.top': 'rgba(196, 165, 116, 0.18)',
    'area.bottom': 'rgba(196, 165, 116, 0.02)',
    'baseline.top_line': '#7f9a82',
    'baseline.bottom_line': '#c48478',
    'baseline.top_fill1': 'rgba(127, 154, 130, 0.18)',
    'baseline.top_fill2': 'rgba(127, 154, 130, 0.03)',
    'baseline.bottom_fill1': 'rgba(196, 132, 120, 0.03)',
    'baseline.bottom_fill2': 'rgba(196, 132, 120, 0.18)',
    'ui.accent': '#c4a574',
    'ui.up': '#7f9a82',
    'ui.down': '#c48478',
  }),
};

/** Cool charcoal industrial · desaturated teal & dusty rose. */
export const PRESET_GRAPHITE: ThemePreset = {
  id: 'graphite',
  name: 'Graphite',
  description: 'Cool charcoal industrial · desat teal & dusty rose',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#0e1013',
    'chart.fg_color': '#c0c5cb',
    'chart.panel': '#15181c',
    'chart.elev': '#1b1f24',
    'bar.up.color': '#6a9892',
    'bar.up.border': '#7aa8a2',
    'bar.up.wick': '#5a8680',
    'bar.down.color': '#b07e86',
    'bar.down.border': '#c08e96',
    'bar.down.wick': '#9a6e76',
    'grid.vert': 'rgba(150, 160, 175, 0.06)',
    'grid.horz': 'rgba(150, 160, 175, 0.06)',
    'scale.border': '#2a2f36',
    'scale.text': '#7a818a',
    'crosshair.color': 'rgba(160, 170, 185, 0.28)',
    'crosshair.label_bg': '#1b1f24',
    'volume.up': 'rgba(106, 152, 146, 0.32)',
    'volume.down': 'rgba(176, 126, 134, 0.32)',
    'line.color': '#8b98a8',
    'area.line': '#8b98a8',
    'area.top': 'rgba(139, 152, 168, 0.18)',
    'area.bottom': 'rgba(139, 152, 168, 0.02)',
    'baseline.top_line': '#6a9892',
    'baseline.bottom_line': '#b07e86',
    'baseline.top_fill1': 'rgba(106, 152, 146, 0.18)',
    'baseline.top_fill2': 'rgba(106, 152, 146, 0.03)',
    'baseline.bottom_fill1': 'rgba(176, 126, 134, 0.03)',
    'baseline.bottom_fill2': 'rgba(176, 126, 134, 0.18)',
    'ui.accent': '#8b98a8',
    'ui.up': '#6a9892',
    'ui.down': '#b07e86',
  }),
};

/** Deep ocean · teal-cyan up / warm clay down. */
export const PRESET_PACIFIC: ThemePreset = {
  id: 'pacific',
  name: 'Pacific',
  description: 'Deep ocean blue-black · teal-cyan / warm clay',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#0a131c',
    'chart.fg_color': '#c5d4de',
    'chart.panel': '#0f1b26',
    'chart.elev': '#152432',
    'bar.up.color': '#3aada0',
    'bar.up.border': '#3aada0',
    'bar.up.wick': '#32968b',
    'bar.down.color': '#c48a6a',
    'bar.down.border': '#c48a6a',
    'bar.down.wick': '#b07a5c',
    'grid.vert': 'rgba(80, 140, 160, 0.07)',
    'grid.horz': 'rgba(80, 140, 160, 0.07)',
    'scale.border': '#1e3344',
    'scale.text': '#7a96a8',
    'crosshair.color': 'rgba(100, 170, 185, 0.32)',
    'crosshair.label_bg': '#152432',
    'volume.up': 'rgba(58, 173, 160, 0.35)',
    'volume.down': 'rgba(196, 138, 106, 0.35)',
    'line.color': '#5a9fb0',
    'area.line': '#5a9fb0',
    'area.top': 'rgba(90, 159, 176, 0.22)',
    'area.bottom': 'rgba(90, 159, 176, 0.02)',
    'baseline.top_line': '#3aada0',
    'baseline.bottom_line': '#c48a6a',
    'baseline.top_fill1': 'rgba(58, 173, 160, 0.2)',
    'baseline.top_fill2': 'rgba(58, 173, 160, 0.04)',
    'baseline.bottom_fill1': 'rgba(196, 138, 106, 0.04)',
    'baseline.bottom_fill2': 'rgba(196, 138, 106, 0.2)',
    'ui.accent': '#5a9fb0',
    'ui.up': '#3aada0',
    'ui.down': '#c48a6a',
  }),
};

/** Blue-violet twilight · desaturated mint / soft coral. */
export const PRESET_DUSK: ThemePreset = {
  id: 'dusk',
  name: 'Dusk',
  description: 'Blue-violet twilight · desaturated mint / soft coral',
  base: 'dark',
  tokens: withTokens({
    'chart.bg_color': '#13111c',
    'chart.fg_color': '#d2cddc',
    'chart.panel': '#1a1724',
    'chart.elev': '#221f2e',
    'bar.up.color': '#6d9b8a',
    'bar.up.border': '#7aa894',
    'bar.up.wick': '#5a8676',
    'bar.down.color': '#c17b72',
    'bar.down.border': '#cd8a81',
    'bar.down.wick': '#a86860',
    'grid.vert': 'rgba(138, 124, 178, 0.08)',
    'grid.horz': 'rgba(138, 124, 178, 0.08)',
    'scale.border': '#2f2a3c',
    'scale.text': '#8a8499',
    'crosshair.color': 'rgba(149, 135, 201, 0.36)',
    'crosshair.label_bg': '#221f2e',
    'volume.up': 'rgba(109, 155, 138, 0.36)',
    'volume.down': 'rgba(193, 123, 114, 0.36)',
    'line.color': '#9587c9',
    'area.line': '#9587c9',
    'area.top': 'rgba(149, 135, 201, 0.20)',
    'area.bottom': 'rgba(149, 135, 201, 0.02)',
    'baseline.top_line': '#6d9b8a',
    'baseline.bottom_line': '#c17b72',
    'baseline.top_fill1': 'rgba(109, 155, 138, 0.20)',
    'baseline.top_fill2': 'rgba(109, 155, 138, 0.03)',
    'baseline.bottom_fill1': 'rgba(193, 123, 114, 0.03)',
    'baseline.bottom_fill2': 'rgba(193, 123, 114, 0.20)',
    'ui.accent': '#9587c9',
    'ui.up': '#6d9b8a',
    'ui.down': '#c17b72',
  }),
};

// ── Light premium ────────────────────────────────────────────────────────

/** Cool porcelain / pearl · forest-teal / terracotta · periwinkle. */
export const PRESET_PORCELAIN: ThemePreset = {
  id: 'porcelain',
  name: 'Porcelain',
  description: 'Cool pearl porcelain · forest-teal / terracotta',
  base: 'light',
  tokens: withTokens({
    'chart.bg_color': '#ebecef',
    'chart.fg_color': '#1c222a',
    'chart.panel': '#e2e5ea',
    'chart.elev': '#d6dae1',
    'bar.up.color': '#3d8474',
    'bar.up.border': '#3d8474',
    'bar.up.wick': '#35786a',
    'bar.down.color': '#c06a58',
    'bar.down.border': '#c06a58',
    'bar.down.wick': '#b05f4e',
    'grid.vert': 'rgba(55, 65, 85, 0.08)',
    'grid.horz': 'rgba(55, 65, 85, 0.08)',
    'scale.border': '#c4c9d2',
    'scale.text': '#5a6472',
    'crosshair.color': 'rgba(123, 142, 203, 0.40)',
    'crosshair.label_bg': '#d6dae1',
    'volume.up': 'rgba(61, 132, 116, 0.34)',
    'volume.down': 'rgba(192, 106, 88, 0.34)',
    'line.color': '#7b8ecb',
    'area.line': '#7b8ecb',
    'area.top': 'rgba(123, 142, 203, 0.18)',
    'area.bottom': 'rgba(123, 142, 203, 0.02)',
    'baseline.top_line': '#3d8474',
    'baseline.bottom_line': '#c06a58',
    'baseline.top_fill1': 'rgba(61, 132, 116, 0.18)',
    'baseline.top_fill2': 'rgba(61, 132, 116, 0.03)',
    'baseline.bottom_fill1': 'rgba(192, 106, 88, 0.03)',
    'baseline.bottom_fill2': 'rgba(192, 106, 88, 0.18)',
    'ui.accent': '#7b8ecb',
    'ui.up': '#3d8474',
    'ui.down': '#c06a58',
  }),
};

/** Warm ivory paper · olive-sage / brick-rose · bronze-gold. */
export const PRESET_PARCHMENT: ThemePreset = {
  id: 'parchment',
  name: 'Parchment',
  description: 'Warm ivory paper · olive-sage / brick-rose',
  base: 'light',
  tokens: withTokens({
    'chart.bg_color': '#f1ebe0',
    'chart.fg_color': '#2a241c',
    'chart.panel': '#e8e0d0',
    'chart.elev': '#ddd3c0',
    'bar.up.color': '#6b8a5a',
    'bar.up.border': '#6b8a5a',
    'bar.up.wick': '#5f7c50',
    'bar.down.color': '#b66a60',
    'bar.down.border': '#b66a60',
    'bar.down.wick': '#a65e55',
    'grid.vert': 'rgba(90, 70, 40, 0.08)',
    'grid.horz': 'rgba(90, 70, 40, 0.08)',
    'scale.border': '#d0c4b0',
    'scale.text': '#6b5f50',
    'crosshair.color': 'rgba(176, 141, 82, 0.40)',
    'crosshair.label_bg': '#ddd3c0',
    'volume.up': 'rgba(107, 138, 90, 0.34)',
    'volume.down': 'rgba(182, 106, 96, 0.34)',
    'line.color': '#b08d52',
    'area.line': '#b08d52',
    'area.top': 'rgba(176, 141, 82, 0.18)',
    'area.bottom': 'rgba(176, 141, 82, 0.02)',
    'baseline.top_line': '#6b8a5a',
    'baseline.bottom_line': '#b66a60',
    'baseline.top_fill1': 'rgba(107, 138, 90, 0.18)',
    'baseline.top_fill2': 'rgba(107, 138, 90, 0.03)',
    'baseline.bottom_fill1': 'rgba(182, 106, 96, 0.03)',
    'baseline.bottom_fill2': 'rgba(182, 106, 96, 0.18)',
    'ui.accent': '#b08d52',
    'ui.up': '#6b8a5a',
    'ui.down': '#b66a60',
  }),
};

/**
 * All built-in presets in UI order (10 curated).
 * Foundations first, then dark boutique, then light boutique.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
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
];

const BY_ID = new Map(THEME_PRESETS.map((p) => [p.id, p]));

/** Legacy id aliases → current presets (workspace / older localStorage). */
const LEGACY_IDS: Record<string, string> = {
  'high-contrast': 'classic',
  aurora: 'dusk',
  'nord-mist': 'graphite',
  'ink-ember': 'pacific',
  silk: 'porcelain',
};

export function getPreset(id: string | undefined | null): ThemePreset {
  if (id && BY_ID.has(id)) return BY_ID.get(id)!;
  if (id && LEGACY_IDS[id] && BY_ID.has(LEGACY_IDS[id]!)) {
    return BY_ID.get(LEGACY_IDS[id]!)!;
  }
  return PRESET_VOID_DARK;
}

export function listPresets(): ThemePreset[] {
  return [...THEME_PRESETS];
}

/**
 * @deprecated Removed pure high-contrast neon preset — use {@link PRESET_CLASSIC}.
 * Kept as an alias export so older imports do not break at compile time.
 */
export const PRESET_HIGH_CONTRAST = PRESET_CLASSIC;
