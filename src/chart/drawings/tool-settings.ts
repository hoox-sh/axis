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
 * Per-tool drawing settings catalog — which controls apply, kind defaults,
 * and readers used by paint / the style bar.
 *
 * Does not mount UI or touch the chart layer.
 */

import {
  FIB_EXT_LEVELS,
  FIB_LEVELS,
  defaultExtendFlags,
  type DrawingKind,
  type DrawingLineStyle,
  type DrawingToolId,
} from '../drawing-types';

export { defaultExtendFlags };
import type { SegmentExtend } from './geometry';

/** Control ids shown in the style bar / settings popover. */
export type ToolSettingId =
  | 'color'
  | 'width'
  | 'lineStyle'
  | 'fillOpacity'
  | 'extendLeft'
  | 'extendRight'
  | 'showPrice'
  | 'showPct'
  | 'showStats'
  | 'text'
  | 'fontSize'
  | 'arrowStart'
  | 'arrowEnd'
  | 'fibLevels'
  | 'reverse'
  | 'rr'
  | 'lock';

/** Last-used / default extras for one drawing kind (persisted under drawingPrefs.byKind). */
export interface KindDrawingPrefs {
  color?: string;
  width?: number;
  lineStyle?: DrawingLineStyle;
  fillOpacity?: number;
  extendLeft?: boolean;
  extendRight?: boolean;
  fontSize?: number;
  showPrice?: boolean;
  showPct?: boolean;
  showStats?: boolean;
  reverse?: boolean;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  rr?: number;
  fibLevels?: number[];
}

const BASE: ToolSettingId[] = ['color', 'width', 'lineStyle'];

function kindSet(...ids: DrawingKind[]): ReadonlySet<string> {
  return new Set(ids);
}

const FILL_KINDS = kindSet(
  'rect',
  'ellipse',
  'channel',
  'triangle',
  'rotatedRect',
  'gannBox',
  'gannSquare',
  'highlighter',
  'dateRange',
  'priceRange',
  'datePriceRange',
  'fib',
  'fibext',
  'fibchannel',
  'fibArc',
  'fibWedge',
  'fibCircles',
  'long',
  'short',
);

const EXTEND_BOTH_KINDS = kindSet(
  'trend',
  'ray',
  'extend',
  'infoLine',
  'channel',
  'fib',
  'fibext',
  'fibchannel',
);

const EXTEND_RIGHT_ONLY = kindSet('hray');

const SHOW_PRICE_KINDS = kindSet(
  'hline',
  'hray',
  'vline',
  'priceLabel',
  'fib',
  'fibext',
  'fibtime',
  'fibchannel',
  'fibArc',
  'fibWedge',
  'fibCircles',
);

const SHOW_STATS_KINDS = kindSet(
  'infoLine',
  'measure',
  'dateRange',
  'priceRange',
  'datePriceRange',
  'trendAngle',
  'forecast',
);

const TEXT_KINDS = kindSet(
  'text',
  'anchoredText',
  'note',
  'callout',
  'flag',
  'priceLabel',
);

const ARROW_KINDS = kindSet('trend', 'ray', 'arrow', 'forecast');

const FIB_KINDS = kindSet(
  'fib',
  'fibext',
  'fibtime',
  'fibchannel',
  'fibArc',
  'fibWedge',
  'fibCircles',
);

const RR_KINDS = kindSet('long', 'short');

const WIDE_WIDTH_KINDS = kindSet('highlighter', 'brush');

/** Fibonacci time-zone multiples (verticals). */
export const FIB_TIME_LEVELS: readonly number[] = [0, 1, 1.618, 2.618, 3.618, 4.236];

const ALL_KINDS: DrawingKind[] = [
  'hline',
  'vline',
  'hray',
  'crossline',
  'trend',
  'ray',
  'extend',
  'infoLine',
  'trendAngle',
  'channel',
  'pitchfork',
  'gannFan',
  'gannBox',
  'gannSquare',
  'rect',
  'rotatedRect',
  'ellipse',
  'arrow',
  'arrowMarkUp',
  'arrowMarkDown',
  'triangle',
  'polyline',
  'path',
  'arc',
  'curve',
  'brush',
  'highlighter',
  'fib',
  'fibext',
  'fibtime',
  'fibchannel',
  'fibArc',
  'fibWedge',
  'fibCircles',
  'measure',
  'dateRange',
  'priceRange',
  'datePriceRange',
  'text',
  'priceLabel',
  'callout',
  'note',
  'flag',
  'anchoredText',
  'long',
  'short',
  'forecast',
  'xabcd',
  'headShoulders',
];

/** Every persistable drawing kind (excludes cursor / eraser). */
export const ALL_DRAWING_KINDS: readonly DrawingKind[] = ALL_KINDS;

function isKind(id: string): id is DrawingKind {
  return (ALL_KINDS as string[]).includes(id);
}

/** True when the tool is a placed drawing kind (not cursor/eraser). */
export function isDrawingKind(tool: DrawingToolId): tool is DrawingKind {
  return isKind(tool);
}

/** Settings that apply to a kind (lock is UI-only for a selection). */
export function settingsForKind(kind: DrawingKind | DrawingToolId): ReadonlySet<ToolSettingId> {
  if (kind === 'cursor' || kind === 'eraser' || !isKind(kind)) {
    return new Set();
  }
  const out = new Set<ToolSettingId>(BASE);
  if (FILL_KINDS.has(kind)) out.add('fillOpacity');
  if (EXTEND_BOTH_KINDS.has(kind)) {
    out.add('extendLeft');
    out.add('extendRight');
  } else if (EXTEND_RIGHT_ONLY.has(kind)) {
    out.add('extendRight');
  }
  if (SHOW_PRICE_KINDS.has(kind)) out.add('showPrice');
  if (SHOW_STATS_KINDS.has(kind)) out.add('showStats');
  if (TEXT_KINDS.has(kind)) {
    out.add('text');
    out.add('fontSize');
  }
  if (ARROW_KINDS.has(kind)) {
    out.add('arrowStart');
    out.add('arrowEnd');
  }
  if (FIB_KINDS.has(kind)) {
    out.add('fibLevels');
    out.add('reverse');
    out.add('showPct');
  }
  if (RR_KINDS.has(kind)) out.add('rr');
  return out;
}

export function hasSetting(kind: DrawingKind | DrawingToolId, id: ToolSettingId): boolean {
  return settingsForKind(kind).has(id);
}

/** Compact style-bar width chips for the active kind. */
export function widthsForKind(kind: DrawingKind | DrawingToolId): readonly number[] {
  if (WIDE_WIDTH_KINDS.has(kind)) return [4, 8, 12, 16];
  return [1, 1.5, 2, 3];
}

/** Default fib ratios for a fib-family kind. */
export function defaultFibLevels(kind: DrawingKind | DrawingToolId): readonly number[] {
  if (kind === 'fibext') return FIB_EXT_LEVELS;
  if (kind === 'fibtime') return FIB_TIME_LEVELS;
  return FIB_LEVELS;
}

/** Kind defaults applied on create when the user has not set byKind prefs. */
export function defaultKindPrefs(kind: DrawingKind): KindDrawingPrefs {
  const prefs: KindDrawingPrefs = {};
  if (kind === 'ray' || kind === 'hray') prefs.extendRight = true;
  if (kind === 'extend' || kind === 'channel') {
    prefs.extendLeft = true;
    prefs.extendRight = true;
  }
  if (kind === 'highlighter') {
    prefs.width = 8;
    prefs.fillOpacity = 0.35;
  }
  if (kind === 'brush') prefs.width = 3;
  if (kind === 'arrow' || kind === 'forecast') prefs.arrowEnd = true;
  if (kind === 'hline' || kind === 'hray' || kind === 'vline' || kind === 'priceLabel') {
    prefs.showPrice = true;
  }
  if (SHOW_STATS_KINDS.has(kind)) prefs.showStats = true;
  if (TEXT_KINDS.has(kind)) prefs.fontSize = 12;
  if (FIB_KINDS.has(kind)) {
    prefs.fibLevels = [...defaultFibLevels(kind)];
    prefs.showPct = true;
    prefs.showPrice = kind !== 'fibArc' && kind !== 'fibWedge' && kind !== 'fibCircles';
    prefs.fillOpacity = 0.08;
    prefs.reverse = false;
    if (kind === 'fib' || kind === 'fibext' || kind === 'fibchannel') {
      prefs.extendRight = true;
    }
  }
  if (kind === 'long' || kind === 'short') {
    prefs.rr = 1;
    prefs.fillOpacity = 0.18;
  }
  if (kind === 'rect' || kind === 'ellipse' || kind === 'rotatedRect' || kind === 'triangle') {
    prefs.fillOpacity = 0.15;
  }
  if (kind === 'dateRange' || kind === 'priceRange' || kind === 'datePriceRange') {
    prefs.fillOpacity = 0.12;
  }
  return prefs;
}

/** Merge global prefs + kind defaults + stored byKind[kind]. */
export function resolvedPrefsForTool(
  global: {
    color: string;
    width: number;
    lineStyle: DrawingLineStyle;
    fillOpacity: number;
    byKind?: Partial<Record<DrawingKind, KindDrawingPrefs>>;
  },
  tool: DrawingToolId,
): KindDrawingPrefs & {
  color: string;
  width: number;
  lineStyle: DrawingLineStyle;
  fillOpacity: number;
} {
  const kindDefaults = isKind(tool) ? defaultKindPrefs(tool) : {};
  const stored = isKind(tool) ? global.byKind?.[tool] : undefined;
  const merged: KindDrawingPrefs = { ...kindDefaults, ...stored };
  return {
    ...merged,
    color: merged.color || global.color,
    width: merged.width ?? global.width,
    lineStyle: merged.lineStyle ?? global.lineStyle,
    fillOpacity: merged.fillOpacity ?? global.fillOpacity,
  };
}

export function clampFontSize(n: unknown, fallback = 12): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(8, Math.min(32, Math.round(v)));
}

export function clampRiskReward(n: unknown, fallback = 1): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0.25, Math.min(10, v));
}

/** Cap / sanitize a fib level list (finite, unique-ish, bounded). */
export function sanitizeFibLevels(
  raw: unknown,
  fallback: readonly number[] = FIB_LEVELS,
): number[] {
  if (!Array.isArray(raw)) return [...fallback];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const n = typeof item === 'number' ? item : Number(item);
    if (!Number.isFinite(n)) continue;
    const clamped = Math.max(-10, Math.min(20, n));
    const key = Math.round(clamped * 1e6) / 1e6;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 24) break;
  }
  return out.length ? out : [...fallback];
}

type MetaBag = {
  kind?: string;
  style?: {
    extendLeft?: boolean;
    extendRight?: boolean;
    fontSize?: number;
  };
  meta?: Record<string, unknown> | null;
  text?: string;
};

function metaBool(d: MetaBag, key: string, fallback: boolean): boolean {
  const v = d.meta?.[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Fib ratios on a drawing, with kind fallback. */
export function fibLevelsOf(d: MetaBag): number[] {
  const kind = (d.kind || 'fib') as DrawingKind;
  return sanitizeFibLevels(d.meta?.fibLevels, defaultFibLevels(kind));
}

export function isFibReversed(d: MetaBag): boolean {
  return metaBool(d, 'reverse', false);
}

export function showPriceOf(d: MetaBag, fallback = true): boolean {
  return metaBool(d, 'showPrice', fallback);
}

export function showPctOf(d: MetaBag, fallback = true): boolean {
  return metaBool(d, 'showPct', fallback);
}

export function showStatsOf(d: MetaBag, fallback = true): boolean {
  return metaBool(d, 'showStats', fallback);
}

export function fontSizeOf(d: MetaBag, fallback = 12): number {
  return clampFontSize(d.style?.fontSize ?? d.meta?.fontSize, fallback);
}

export function riskRewardOf(d: MetaBag, fallback = 1): number {
  return clampRiskReward(d.meta?.rr, fallback);
}

export function arrowStartOf(d: MetaBag, fallback = false): boolean {
  return metaBool(d, 'arrowStart', fallback);
}

export function arrowEndOf(d: MetaBag, fallback = false): boolean {
  return metaBool(d, 'arrowEnd', fallback);
}

/**
 * Stop price for a long/short box: same distance as reward scaled by 1/rr.
 * rr=1 → 1:1 (stop mirrors target around entry).
 */
export function positionStopPrice(entry: number, target: number, rr: number): number {
  const reward = target - entry;
  const ratio = clampRiskReward(rr, 1);
  return entry - reward / ratio;
}

export function extendModeOf(
  d: MetaBag,
  kindDefaults: { extendLeft: boolean; extendRight: boolean },
): SegmentExtend {
  const left = d.style?.extendLeft ?? kindDefaults.extendLeft;
  const right = d.style?.extendRight ?? kindDefaults.extendRight;
  if (left && right) return 'both';
  if (left) return 'left';
  if (right) return 'right';
  return 'none';
}

/** Kinds whose label can be re-edited (dblclick / popover). */
export function isTextEditableKind(kind: string): boolean {
  return TEXT_KINDS.has(kind);
}

export function drawingTextOf(d: MetaBag): string {
  if (typeof d.text === 'string' && d.text.trim()) return d.text;
  if (typeof d.meta?.text === 'string') return d.meta.text;
  return '';
}
