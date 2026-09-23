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
 * Classic multi-color swatches for fib, Gann, and pitchfork levels.
 *
 * Built-in colors only — per-drawing overrides live on `meta.levelColors`
 * and are applied by {@link resolveLevelPaint}, not by {@link levelSwatches}.
 */

import { defaultFibLevels } from './tool-settings';

const MULTI_COLOR_KINDS = new Set([
  'fib',
  'fibext',
  'fibtime',
  'fibchannel',
  'fibArc',
  'fibWedge',
  'fibCircles',
  'gannFan',
  'gannBox',
  'gannSquare',
  'pitchfork',
]);

const FIB_KINDS = new Set([
  'fib',
  'fibext',
  'fibtime',
  'fibchannel',
  'fibArc',
  'fibWedge',
  'fibCircles',
]);

/** Named fib ratios → stable classic colors (TradingView-like). */
const FIB_COLORS: Record<string, string> = {
  '0': '#787B86',
  '0.236': '#F23645',
  '0.382': '#FF9800',
  '0.5': '#4CAF50',
  '0.618': '#089981',
  '0.786': '#00BCD4',
  '1': '#787B86',
  '1.272': '#9C27B0',
  '1.414': '#7E57C2',
  '1.618': '#2962FF',
  '2': '#E91E63',
  '2.618': '#F23645',
  '3.618': '#FF9800',
  '4.236': '#4CAF50',
};

/**
 * Distinct hues for ratios outside {@link FIB_COLORS}.
 * Indexed by the ratio in thousandths so the named map never shifts.
 */
const FIB_CYCLE = [
  '#E040FB',
  '#FFEB3B',
  '#795548',
  '#607D8B',
  '#CDDC39',
  '#FF5722',
  '#3F51B5',
  '#00ACC1',
] as const;

const CANONICAL_KEYS: ReadonlyArray<readonly [number, string]> = [
  [0, '0'],
  [0.236, '0.236'],
  [0.382, '0.382'],
  [0.5, '0.5'],
  [0.618, '0.618'],
  [0.786, '0.786'],
  [1, '1'],
  [1.272, '1.272'],
  [1.618, '1.618'],
  [2, '2'],
  [2.618, '2.618'],
  [3.618, '3.618'],
  [4.236, '4.236'],
];

const GANN_FAN: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: '1x1', label: '1x1', color: '#2962FF' },
  { key: '1x2', label: '1x2', color: '#089981' },
  { key: '2x1', label: '2x1', color: '#089981' },
  { key: '1x3', label: '1x3', color: '#FF9800' },
  { key: '3x1', label: '3x1', color: '#FF9800' },
  { key: '1x4', label: '1x4', color: '#F23645' },
  { key: '4x1', label: '4x1', color: '#F23645' },
];

const GANN_BOX: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: 'border', label: 'Border', color: '#787B86' },
  { key: 'h:0.25', label: 'H 0.25', color: '#F23645' },
  { key: 'v:0.25', label: 'V 0.25', color: '#F23645' },
  { key: 'h:0.5', label: 'H 0.5', color: '#2962FF' },
  { key: 'v:0.5', label: 'V 0.5', color: '#2962FF' },
  { key: 'h:0.75', label: 'H 0.75', color: '#089981' },
  { key: 'v:0.75', label: 'V 0.75', color: '#089981' },
];

const GANN_SQUARE: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: 'border', label: 'Border', color: '#787B86' },
  { key: 'diagA', label: 'Diag \\', color: '#FF9800' },
  { key: 'diagB', label: 'Diag /', color: '#9C27B0' },
];

const PITCHFORK: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: 'median', label: 'Median', color: '#2962FF' },
  { key: 'upper', label: 'Upper', color: '#089981' },
  { key: 'lower', label: 'Lower', color: '#F23645' },
];

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isMultiColorKind(kind: string): boolean {
  return MULTI_COLOR_KINDS.has(kind);
}

/** Canonical key for a fib ratio (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618, 3.618, 4.236). Unknown ratios: trim to 3 decimals. */
export function levelKey(level: number): string {
  if (!Number.isFinite(level)) return '0';
  for (const [n, key] of CANONICAL_KEYS) {
    if (Math.abs(level - n) <= 1e-6) return key;
  }
  const rounded = Math.round(level * 1000) / 1000;
  if (Object.is(rounded, -0)) return '0';
  return String(rounded);
}

function cycleFib(key: string): string {
  const n = Number(key);
  let idx = 0;
  if (Number.isFinite(n)) {
    idx = Math.abs(Math.round(n * 1000));
  } else {
    for (let i = 0; i < key.length; i++) idx = (idx * 33 + key.charCodeAt(i)) >>> 0;
  }
  return FIB_CYCLE[idx % FIB_CYCLE.length]!;
}

function fibPaletteColor(key: string): string {
  const named = FIB_COLORS[key];
  if (named) return named;
  const n = Number(key);
  if (Number.isFinite(n)) {
    const canon = FIB_COLORS[levelKey(n)];
    if (canon) return canon;
  }
  return cycleFib(Number.isFinite(n) ? levelKey(n) : key);
}

function colorMap(rows: ReadonlyArray<{ key: string; color: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.color;
  return out;
}

const FAN_COLORS = colorMap(GANN_FAN);
const BOX_COLORS = colorMap(GANN_BOX);
const SQUARE_COLORS = colorMap(GANN_SQUARE);
/** Handle is painted but not a settings swatch row. Midlines share the 0.5 blue. */
const FORK_COLORS: Record<string, string> = {
  ...colorMap(PITCHFORK),
  handle: '#787B86',
};
const SQUARE_EXTRA: Record<string, string> = {
  ...SQUARE_COLORS,
  'h:0.5': '#2962FF',
  'v:0.5': '#2962FF',
};

function classicColor(kind: string, key: string): string | undefined {
  if (kind === 'gannFan') return FAN_COLORS[key];
  if (kind === 'gannBox') return BOX_COLORS[key];
  if (kind === 'gannSquare') return SQUARE_EXTRA[key];
  if (kind === 'pitchfork') return FORK_COLORS[key];
  if (FIB_KINDS.has(kind)) return fibPaletteColor(key);
  return undefined;
}

function paintedFibLevels(kind: string): readonly number[] {
  const levels = defaultFibLevels(kind as Parameters<typeof defaultFibLevels>[0]);
  // Zero radius is a point; arc / circle painters skip it.
  if (kind === 'fibArc' || kind === 'fibCircles') return levels.filter((lvl) => lvl !== 0);
  return levels;
}

/** Classic swatches for a kind. Colors are the built-in palette, not per-drawing overrides. */
export function levelSwatches(kind: string): { key: string; label: string; color: string }[] {
  if (kind === 'gannFan') return GANN_FAN.map((row) => ({ ...row }));
  if (kind === 'gannBox') return GANN_BOX.map((row) => ({ ...row }));
  if (kind === 'gannSquare') return GANN_SQUARE.map((row) => ({ ...row }));
  if (kind === 'pitchfork') return PITCHFORK.map((row) => ({ ...row }));
  if (!FIB_KINDS.has(kind)) return [];
  return paintedFibLevels(kind).map((lvl) => {
    const key = levelKey(lvl);
    return { key, label: key, color: fibPaletteColor(key) };
  });
}

function readLevelOverride(bag: unknown, key: string): string | undefined {
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return undefined;
  const raw = (bag as Record<string, unknown>)[key];
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  return HEX_COLOR.test(s) ? s : undefined;
}

/**
 * Stroke/fill color for one level.
 * - meta.multiColor === false → fallback (single user color)
 * - meta.levelColors[key] if it is a #rgb/#rrggbb string → that
 * - else classic palette color for key
 * - else fallback
 * Undefined multiColor means ON for isMultiColorKind kinds.
 */
export function resolveLevelPaint(
  drawing: {
    kind: string;
    meta?: {
      multiColor?: boolean;
      levelColors?: Record<string, string> | unknown;
      [key: string]: unknown;
    } | null;
  },
  key: string,
  fallback: string,
): string {
  const meta = drawing.meta && typeof drawing.meta === 'object' ? drawing.meta : undefined;
  const flag = meta?.multiColor;
  const on = flag === false ? false : flag === true ? true : isMultiColorKind(drawing.kind);
  if (!on) return fallback;
  const override = readLevelOverride(meta?.levelColors, key);
  if (override) return override;
  return classicColor(drawing.kind, key) ?? fallback;
}
