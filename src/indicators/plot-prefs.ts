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
 * Per-plot panel preferences: line width, line type, and `display.*` targets.
 *
 * ## What is Pine and what is AXIS
 *
 * - **`display`** is a real Pine `plot()` argument
 *   (`display.all` / `pane` / `data_window` / `price_scale` / `status_line` /
 *   `none`). AXIS honours the declared mask and lets the panel override it.
 * - **Line type is an AXIS platform override.** Pine `plot()` has no
 *   line-style argument (plot lines are solid; only `hline()` and drawing
 *   objects take `line.style_*`). The panel therefore stores a platform
 *   preference — never claim it comes from the script.
 * - **Width** maps to Pine `plot(..., linewidth=)` and is a real argument.
 *
 * Precedence everywhere: **panel override → Pine declaration → default**.
 * `null` / `undefined` on the override means "follow the script".
 *
 * @module indicators/plot-prefs
 */

import { PLOT_DISPLAY, parsePlotDisplay } from '../results/plot-visuals';
import type { Indicator } from '../store/types';

/** Panel line types (AXIS naming; rendered as LWC `LineStyle`). */
export const PLOT_LINE_STYLES = ['solid', 'dotted', 'dashed', 'large_dashed'] as const;

/** One panel line type (an AXIS preference, not a Pine `plot()` argument). */
export type PlotLineStyle = (typeof PLOT_LINE_STYLES)[number];

/** Human labels for the picker. */
export const PLOT_LINE_STYLE_LABELS: Record<PlotLineStyle, string> = {
  solid: 'Solid',
  dotted: 'Dotted',
  dashed: 'Dashed',
  large_dashed: 'Large dash',
};

/** One stored plot entry (`Indicator['plots'][name]`). */
export type PlotPrefs = Indicator['plots'][string];

/**
 * Normalize any engine / stored token to a panel line type.
 *
 * Accepts Pine drawing tokens (`line.style_dashed`, `style_dotted`) as well as
 * the engine's `plot_meta.linestyle` spellings.
 */
export function normalizePlotLineStyle(raw: unknown): PlotLineStyle | null {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .toLowerCase()
    .replace(/^(line|hline)\./, '')
    .replace(/^style_/, '')
    .replace(/[_-]/g, '');
  if (!s) return null;
  if (s === 'solid' || s === 'line') return 'solid';
  if (s === 'dotted' || s === 'dot') return 'dotted';
  if (s === 'dashed' || s === 'dash') return 'dashed';
  if (s.startsWith('large')) return 'large_dashed';
  return null;
}

/** Panel override, else the script's declared style, else null (solid). */
export function effectivePlotLineStyle(plot: PlotPrefs | undefined): PlotLineStyle | null {
  return normalizePlotLineStyle(plot?.linestyle) ?? normalizePlotLineStyle(plot?.pine?.linestyle);
}

/** Panel display override, else the script's declared mask, else `display.all`. */
export function effectivePlotDisplay(plot: PlotPrefs | undefined): number {
  if (plot?.display != null) return parsePlotDisplay(plot.display);
  if (plot?.pine?.display != null) return parsePlotDisplay(plot.pine.display);
  return PLOT_DISPLAY.all;
}

/** The script's own declared mask (for the “Pine: …” hint / reset). */
export function pinePlotDisplay(plot: PlotPrefs | undefined): number | null {
  return plot?.pine?.display != null ? parsePlotDisplay(plot.pine.display) : null;
}

/** True when the panel overrides the declared mask. */
export function hasDisplayOverride(plot: PlotPrefs | undefined): boolean {
  return plot?.display != null;
}

/**
 * Toggle one `display.*` target, preserving targets the panel does not manage
 * (`status_line` stays as the script declared it).
 */
export function togglePlotDisplayBit(plot: PlotPrefs | undefined, bit: number): number {
  const current = effectivePlotDisplay(plot);
  return (current & bit) === bit ? current & ~bit : current | bit;
}

/** Split a mask into the targets the panel exposes. */
export function plotDisplayTargets(bits: number): {
  pane: boolean;
  dataWindow: boolean;
  priceScale: boolean;
  statusLine: boolean;
  none: boolean;
} {
  return {
    pane: (bits & PLOT_DISPLAY.pane) !== 0,
    dataWindow: (bits & PLOT_DISPLAY.data_window) !== 0,
    priceScale: (bits & PLOT_DISPLAY.price_scale) !== 0,
    statusLine: (bits & PLOT_DISPLAY.status_line) !== 0,
    none: bits === PLOT_DISPLAY.none,
  };
}

/** Short human summary of a mask (panel chips). */
export function formatPlotDisplay(bits: number): string {
  if (bits === PLOT_DISPLAY.none) return 'hidden';
  if (bits === PLOT_DISPLAY.all) return 'all';
  const t = plotDisplayTargets(bits);
  const parts: string[] = [];
  if (t.pane) parts.push('pane');
  if (t.dataWindow) parts.push('data');
  if (t.priceScale) parts.push('scale');
  if (t.statusLine) parts.push('status');
  return parts.length ? parts.join(' · ') : 'hidden';
}

/**
 * Ultra-compact mask for the plot row (`PDS` = pane + data + status).
 * The long form lives in the tooltip.
 */
export function formatPlotDisplayCompact(bits: number): string {
  if (bits === PLOT_DISPLAY.none) return 'off';
  if (bits === PLOT_DISPLAY.all) return 'all';
  const t = plotDisplayTargets(bits);
  let out = '';
  if (t.pane) out += 'P';
  if (t.dataWindow) out += 'D';
  if (t.priceScale) out += 'S';
  if (t.statusLine) out += 'T';
  return out || 'off';
}

/** Effective line width (panel override → Pine `linewidth` → 1). */
export function effectivePlotWidth(plot: PlotPrefs | undefined): number {
  const raw = plot?.width ?? plot?.pine?.linewidth ?? 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(4, Math.round(n)));
}

/**
 * Snapshot the script's declared plot style from `plot_meta` (stored as
 * `plots[name].pine` so the panel can show the declaration and reset to it).
 * Returns null when the payload declared nothing.
 */
export function pinePlotMeta(
  meta: { linestyle?: unknown; display?: unknown; linewidth?: unknown } | null | undefined,
): { linestyle?: string; display?: number; linewidth?: number } | null {
  if (!meta) return null;
  const out: { linestyle?: string; display?: number; linewidth?: number } = {};
  const style = normalizePlotLineStyle(meta.linestyle);
  if (style) out.linestyle = style;
  if (meta.display != null && meta.display !== '') out.display = parsePlotDisplay(meta.display);
  const lw = Number(meta.linewidth);
  if (Number.isFinite(lw) && lw > 0) out.linewidth = Math.max(1, Math.min(4, Math.round(lw)));
  return Object.keys(out).length ? out : null;
}

/**
 * `display.*` targets the panel can toggle: pane, data window, price scale.
 * `status_line` is deliberately excluded so the script keeps what it declared.
 */
export const PANEL_DISPLAY_MASK =
  PLOT_DISPLAY.pane | PLOT_DISPLAY.data_window | PLOT_DISPLAY.price_scale;
