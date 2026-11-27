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
 * Apply resolved theme tokens to DOM (CSS vars) and Lightweight Charts APIs.
 *
 * @module theme/apply
 */

import {
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type SeriesType,
} from 'lightweight-charts';
import { pineColorMap } from './catalog';
import { resolveTokens } from './resolve';
import { syntaxPackForPreset } from './syntax-packs';
import type {
  ApplyChartThemeOpts,
  ApplySeriesThemeOpts,
  ChartThemeState,
  ThemeTokens,
} from './types';

/** Chart-scoped CSS vars (bridge for canvas / series-factory helpers). */
const CHART_CSS_VAR_MAP: Record<string, string> = {
  'chart.bg_color': '--chart-bg',
  'chart.fg_color': '--chart-fg',
  'chart.panel': '--chart-panel',
  'chart.elev': '--chart-elev',
  'bar.up.color': '--chart-bar-up',
  'bar.down.color': '--chart-bar-down',
  'grid.vert': '--chart-grid-vert',
  'grid.horz': '--chart-grid-horz',
  'scale.border': '--chart-scale-border',
  'scale.text': '--chart-scale-text',
  'crosshair.color': '--chart-crosshair',
  'ui.accent': '--chart-accent',
  'ui.up': '--chart-ui-up',
  'ui.down': '--chart-ui-down',
};

function tok(tokens: ThemeTokens, key: string, fallback: string): string {
  const v = tokens[key];
  return v != null && String(v).trim() ? String(v) : fallback;
}

// ── Contrast floors (WCAG-ish) ──────────────────────────────────────────────
// Chart presets drive UI label colors (`scale.text` → `--color-text-dim`), and
// some presets (Graphite, mono) ship subdued values ≈2.4–3.9:1. These helpers
// numerically mix a color toward the body-text color until it clears a floor.

type RGB = { r: number; g: number; b: number; a: number };

function toRgb(c: string): RGB | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function rgbToCss({ r, g, b, a }: RGB): string {
  const hx = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  const base = `#${hx(r)}${hx(g)}${hx(b)}`;
  return a >= 0.999 ? base : `${base}${hx(a * 255)}`;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a,
  };
}

function relLuminance({ r, g, b }: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** WCAG AA body-text floor for chrome labels, faint copy, and accent-as-text. */
export const TEXT_CONTRAST_MIN = 4.5;

/** Contrast of two parseable hex colors, or null when either is color-mix/var. */
export function contrastRatioHex(fg: string, bg: string): number | null {
  const a = toRgb(fg);
  const b = toRgb(bg);
  if (!a || !b) return null;
  return contrastRatio(a, b);
}

/**
 * Mix `color` toward `text` (numeric sRGB interpolation) until it reaches
 * `min` contrast against `bg`. Returns the original value when unparseable
 * (color-mix / var() strings pass through untouched) or already sufficient.
 */
function ensureContrast(color: string, bg: string, text: string, min: number): string {
  const c = toRgb(color);
  const b = toRgb(bg);
  const t = toRgb(text);
  if (!c || !b || !t) return color;
  if (contrastRatio(c, b) >= min) return color;
  for (let i = 1; i <= 10; i++) {
    const m = mixRgb(c, t, i / 10);
    if (contrastRatio(m, b) >= min) return rgbToCss(m);
  }
  return rgbToCss(t);
}

/** Max-min channel span in 0..1 — proxy for chroma on sRGB hex. */
function rgbChroma(c: RGB): number {
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
}

function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) / 441.67; // ≈0..1
}

/**
 * Quiet surface edge: mix panel (fallback bg) toward fg ~15%.
 * Used when `scale.border` is high-chroma or near the accent.
 */
export function quietEdgeColor(panel: string, bg: string, fg: string, amount = 0.15): string {
  const surface = toRgb(panel) || toRgb(bg);
  const text = toRgb(fg);
  if (!surface || !text) {
    return `color-mix(in srgb, ${panel || bg} ${Math.round((1 - amount) * 100)}%, ${fg} ${Math.round(amount * 100)}%)`;
  }
  return rgbToCss(mixRgb(surface, text, amount));
}

/**
 * True when a border hex is “loud” — high chroma or close to the accent.
 * Unparseable values (rgba / color-mix) are treated as quiet.
 */
export function isLoudBorder(border: string, accent: string): boolean {
  const b = toRgb(border);
  if (!b) return false;
  if (rgbChroma(b) >= 0.28) return true;
  const a = toRgb(accent);
  if (a && colorDistance(b, a) <= 0.22) return true;
  return false;
}

/** Brand packs own `--color-accent-2` for editor strings. Everyone else
 *  keeps it as the contrast-safe market up color. */
const BRAND_SYNTAX_IDS = new Set(['void-dark', 'axis', 'volt', 'pyne', 'signal', 'hoox']);

/** Minimum sRGB distance so warn / info / series don't collapse into accent or candles. */
const SIGNAL_DISTANCE = 0.16;

const SERIES_DARK = [
  '#6ee7f5',
  '#e8b84a',
  '#d8b4fe',
  '#f0a070',
  '#7ddbff',
  '#f2a2d0',
  '#c4f57a',
  '#9ad0ff',
  '#f5a3c7',
  '#e7d08a',
];

const SERIES_LIGHT = [
  '#0b6a86',
  '#7d5c12',
  '#6d28d9',
  '#a15c38',
  '#1d4e89',
  '#9d174d',
  '#0f6b5a',
  '#3d4eb8',
  '#7a3e6d',
  '#5c4a12',
];

function mixHex(a: string, b: string, t: number): string | null {
  const from = toRgb(a);
  const to = toRgb(b);
  if (!from || !to) return null;
  return rgbToCss(mixRgb(from, to, t));
}

function ensureContrastToward(color: string, bg: string, toward: string, min: number): string {
  const c = toRgb(color);
  const b = toRgb(bg);
  const t = toRgb(toward);
  if (!c || !b || !t) return color;
  if (contrastRatio(c, b) >= min) return color;
  for (let i = 1; i <= 12; i++) {
    const m = mixRgb(c, t, i / 12);
    if (contrastRatio(m, b) >= min) return rgbToCss(m);
  }
  return rgbToCss(t);
}

/** Darken toward black / lighten toward white so signal hues stay put.
 *  Mixing toward body text (a blue-black or warm white) muddies gold and green. */
function foldContrast(color: string, surfaces: string[], toward: string, min: number): string {
  let out = color;
  for (const surface of surfaces) out = ensureContrastToward(out, surface, toward, min);
  return out;
}

function hueDeg(rgb: RGB): number {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 0.08) return -1;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function farEnough(color: string, avoid: string[], minDistance: number): boolean {
  const rgb = toRgb(color);
  if (!rgb) return true;
  const hue = hueDeg(rgb);
  for (const other of avoid) {
    const o = toRgb(other);
    if (!o) continue;
    const otherHue = hueDeg(o);
    if (hue >= 0 && otherHue >= 0) {
      const sep = Math.abs(hue - otherHue);
      if (Math.min(sep, 360 - sep) >= 28) continue;
    }
    if (colorDistance(rgb, o) < minDistance) return false;
  }
  return true;
}

function pickDistinct(
  candidates: string[],
  avoid: string[],
  surfaces: string[],
  toward: string,
  min: number,
): string {
  let fallback = foldContrast(candidates[0] ?? toward, surfaces, toward, min);
  for (const candidate of candidates) {
    const safe = foldContrast(candidate, surfaces, toward, min);
    fallback = safe;
    if (farEnough(safe, avoid, SIGNAL_DISTANCE)) return safe;
  }
  const anchors = ['#E879F9', '#F472B6', '#A78BFA', '#F59E0B', '#34D399'];
  for (const anchor of anchors) {
    for (let t = 0.4; t <= 0.85; t += 0.15) {
      const mixed = mixHex(fallback, anchor, t);
      if (!mixed) continue;
      const safe = foldContrast(mixed, surfaces, toward, min);
      if (farEnough(safe, avoid, SIGNAL_DISTANCE)) return safe;
    }
  }
  return fallback;
}

function pickSeries(
  pool: readonly string[],
  candles: string[],
  surfaces: string[],
  toward: string,
): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  const take = (color: string, minDistance: number) => {
    if (picked.length >= 6) return;
    const safe = foldContrast(color, surfaces, toward, 3);
    const key = safe.toLowerCase();
    if (seen.has(key)) return;
    if (!farEnough(safe, [...candles, ...picked], minDistance)) return;
    picked.push(safe);
    seen.add(key);
  };
  for (const candidate of pool) take(candidate, 0.1);
  for (const candidate of pool) take(candidate, 0);
  let spin = 0;
  while (picked.length < 6 && spin < pool.length) {
    const base = pool[spin] ?? toward;
    const mixed = mixHex(base, toward, 0.18 + spin * 0.07) ?? base;
    take(mixed, 0);
    spin += 1;
  }
  return picked;
}

/**
 * Soften loud / accent-near `scale.border` into a quiet surface edge.
 * UI chrome and chart separators both use the quiet edge when loud;
 * otherwise the authored border is kept.
 */
export function resolveChromeBorder(args: {
  scaleBorder: string;
  panel: string;
  bg: string;
  fg: string;
  accent: string;
}): { border: string; soft: string; softened: boolean; chartBorder: string } {
  const quiet = quietEdgeColor(args.panel, args.bg, args.fg, 0.15);
  const softened = isLoudBorder(args.scaleBorder, args.accent);
  const border = softened ? quiet : args.scaleBorder;
  const soft = `color-mix(in srgb, ${border} 55%, ${args.bg} 45%)`;
  const chartBorder = softened ? quiet : args.scaleBorder;
  return { border, soft, softened, chartBorder };
}

/**
 * Map resolved theme tokens → full product chrome CSS variables
 * (`--color-*` used by Tailwind / index.css) so presets recolor the whole UI.
 */
export function buildChromeCssVars(
  tokens: ThemeTokens,
  base: 'dark' | 'light',
): Record<string, string> {
  const bg = tok(tokens, 'chart.bg_color', base === 'light' ? '#F3F4F8' : '#030304');
  const panel = tok(tokens, 'chart.panel', base === 'light' ? '#EAEBF1' : '#0A0B10');
  const elev = tok(tokens, 'chart.elev', base === 'light' ? '#E2E4EC' : '#0C0E14');
  const fg = tok(tokens, 'chart.fg_color', base === 'light' ? '#1A1D26' : '#EEEEEE');
  const scaleBorder = tok(tokens, 'scale.border', base === 'light' ? '#C5CAD6' : '#1C2230');
  const accentRaw = tok(tokens, 'ui.accent', base === 'light' ? '#4A59C4' : '#939FFF');
  const up = tok(tokens, 'ui.up', tok(tokens, 'bar.up.color', '#3DDC97'));
  const down = tok(tokens, 'ui.down', tok(tokens, 'bar.down.color', '#F07178'));
  const edges = resolveChromeBorder({
    scaleBorder,
    panel,
    bg,
    fg,
    accent: accentRaw,
  });

  // Primary body text: prefer slightly brighter than chart.fg for dark chrome
  const text = base === 'light' ? fg : tok(tokens, 'chart.fg_color', '#EEEEEE');

  // Secondary labels: presets drive these via `scale.text`; enforce a contrast
  // floor so subdued presets (Graphite / mono) stay legible in the app chrome.
  const dim = ensureContrast(
    tok(tokens, 'scale.text', base === 'light' ? '#5C6575' : '#9D9EA3'),
    bg,
    text,
    TEXT_CONTRAST_MIN,
  );
  // Faint labels: mix *away from* the surface (darken on light, lighten on
  // dark) — the old single-direction mix washed light themes out further.
  const faintRaw = (() => {
    const d = toRgb(dim);
    const b = toRgb(bg);
    const t = toRgb(text);
    if (!d || !b || !t) return `color-mix(in srgb, ${dim} 70%, ${bg} 30%)`;
    return rgbToCss(mixRgb(d, base === 'light' ? t : b, 0.3));
  })();
  const faint = ensureContrast(
    ensureContrast(faintRaw, bg, text, TEXT_CONTRAST_MIN),
    panel,
    text,
    TEXT_CONTRAST_MIN,
  );
  const accent = ensureContrast(
    ensureContrast(accentRaw, bg, text, TEXT_CONTRAST_MIN),
    panel,
    text,
    TEXT_CONTRAST_MIN,
  );

  const mixBlack = base === 'light' ? '#030304' : '#000000';
  const mixWhite = base === 'light' ? '#ffffff' : '#ffffff';
  const surfaces = [bg, panel, elev];
  const toward = base === 'light' ? '#000000' : '#ffffff';
  const upSafe = foldContrast(up, surfaces, toward, TEXT_CONTRAST_MIN);
  const downSafe = foldContrast(down, surfaces, toward, TEXT_CONTRAST_MIN);
  const amber = mixHex(accent, '#E8B84A', 0.65) ?? '#E8B84A';
  const warnCandidates =
    base === 'light'
      ? ['#7D5C12', '#A97812', '#C4922A', amber, '#F59E0B', '#F472B6']
      : [amber, '#E8B84A', '#C4922A', '#F59E0B', '#F472B6'];
  const warn = pickDistinct(
    warnCandidates,
    [accent, upSafe, downSafe],
    surfaces,
    toward,
    TEXT_CONTRAST_MIN,
  );
  const cyanAnchor = base === 'light' ? '#0b6a86' : '#6ee7f5';
  const cyanMix = mixHex(up, cyanAnchor, base === 'light' ? 0.65 : 0.7) ?? cyanAnchor;
  const infoCandidates =
    base === 'light'
      ? ['#0B6A86', cyanMix, '#1D4E89', '#7EB6FF', '#A78BFA', '#E879F9']
      : [cyanMix, cyanAnchor, '#7EB6FF', '#60A5FA', '#A78BFA', '#E879F9'];
  const info = pickDistinct(
    infoCandidates,
    [accent, upSafe, downSafe, warn],
    surfaces,
    toward,
    TEXT_CONTRAST_MIN,
  );
  const series = pickSeries(
    base === 'light' ? SERIES_LIGHT : SERIES_DARK,
    [upSafe, downSafe],
    surfaces,
    toward,
  );

  return {
    // Surfaces
    '--color-void': bg,
    '--color-bg-base': bg,
    '--color-bg-panel': panel,
    '--color-bg-elev': elev,
    '--color-bg-hover': `color-mix(in srgb, ${elev} 72%, ${text} 28%)`,

    // Edges — quiet when scale.border is loud/near accent
    '--color-border': edges.border,
    '--color-border-soft': edges.soft,
    '--color-border-focus': `color-mix(in srgb, ${accent} 65%, transparent)`,

    // Text
    '--color-text': text,
    '--color-text-dim': dim,
    '--color-text-faint': faint,

    // Accents / signals
    '--color-accent': accent,
    '--color-accent-hover': `color-mix(in srgb, ${accent} 78%, ${
      base === 'light' ? mixBlack : mixWhite
    } 22%)`,
    '--color-accent-2': upSafe,
    '--color-green': upSafe,
    '--color-red': downSafe,
    '--color-purple': accent,
    // Warn / info stay readable and off the accent and candle hues.
    '--color-accent-3': warn,
    '--color-orange': warn,
    '--color-yellow': warn,
    '--color-cyan': info,
    '--color-series-1': series[0] ?? info,
    '--color-series-2': series[1] ?? warn,
    '--color-series-3': series[2] ?? accent,
    '--color-series-4': series[3] ?? upSafe,
    '--color-series-5': series[4] ?? downSafe,
    '--color-series-6': series[5] ?? info,
    '--chart-series-1': series[0] ?? info,
    '--chart-series-2': series[1] ?? warn,
    '--chart-series-3': series[2] ?? accent,
    '--chart-series-4': series[3] ?? upSafe,
    '--chart-series-5': series[4] ?? downSafe,
    '--chart-series-6': series[5] ?? info,

    // Pine editor highlight extras (series builtins vs library exports)
    '--color-editor-builtin':
      base === 'light'
        ? `color-mix(in srgb, ${up} 30%, #0e8aaa 70%)`
        : `color-mix(in srgb, ${up} 28%, #6ee7f5 72%)`,
    '--color-editor-lib':
      base === 'light'
        ? `color-mix(in srgb, ${accent} 40%, #9b4dca 60%)`
        : `color-mix(in srgb, ${accent} 38%, #d8b4fe 62%)`,
    '--color-editor-lib-member':
      base === 'light'
        ? `color-mix(in srgb, ${accent} 25%, #c026d3 75%)`
        : `color-mix(in srgb, ${accent} 20%, #e879f9 80%)`,
    '--color-editor-type':
      base === 'light'
        ? `color-mix(in srgb, ${accent} 30%, #c47a18 70%)`
        : `color-mix(in srgb, ${accent} 22%, #E8B84A 78%)`,

    // Focus / shadows track theme depth
    '--ui-focus-ring': `0 0 0 1px color-mix(in srgb, ${accent} 40%, transparent)`,
    '--ui-focus-ring-inset': `inset 0 0 0 1px color-mix(in srgb, ${accent} 70%, transparent)`,
    '--ui-shadow-panel':
      base === 'light' ? '0 8px 28px rgba(20, 18, 40, 0.12)' : '0 8px 28px rgba(0, 0, 0, 0.48)',
    '--ui-shadow-dialog':
      base === 'light' ? '0 16px 48px rgba(20, 18, 40, 0.16)' : '0 16px 48px rgba(0, 0, 0, 0.6)',
  };
}

/**
 * Write theme CSS variables + `data-theme` on `<html>`.
 * Updates both chart bridge vars and full chrome (`--color-*`) so presets
 * recolor the entire app shell, not only the Lightweight Charts canvas.
 * Safe in non-DOM environments (tests).
 */
export function applyThemeToDocument(
  state: ChartThemeState | null | undefined,
  doc: Document | null | undefined = typeof document !== 'undefined' ? document : null,
): void {
  if (!doc?.documentElement) return;
  const tokens = resolveTokens(state);
  const root = doc.documentElement;
  const base = state?.base === 'light' ? 'light' : 'dark';
  try {
    root.setAttribute('data-theme', base);
  } catch {
    /* ignore */
  }

  // Chart bridge vars
  for (const [tokenKey, cssVar] of Object.entries(CHART_CSS_VAR_MAP)) {
    const v = tokens[tokenKey];
    if (v == null) continue;
    try {
      root.style.setProperty(cssVar, String(v));
    } catch {
      /* ignore */
    }
  }

  // Full chrome / Tailwind color tokens
  const chrome = buildChromeCssVars(tokens, base);
  for (const [cssVar, value] of Object.entries(chrome)) {
    try {
      root.style.setProperty(cssVar, value);
    } catch {
      /* ignore */
    }
  }

  // Editor syntax pack overrides (brand packs mirror VS Code tokenColors).
  // Non-brand presets put market up back on accent-2 after that override.
  const syntax = syntaxPackForPreset(state?.presetId, tokens, base);
  const presetId = String(state?.presetId || '').trim();
  if (!BRAND_SYNTAX_IDS.has(presetId) && chrome['--color-green']) {
    syntax['--color-accent-2'] = chrome['--color-green'];
  }
  for (const [cssVar, value] of Object.entries(syntax)) {
    try {
      root.style.setProperty(cssVar, value);
    } catch {
      /* ignore */
    }
  }

  // Digits line up in every theme. color-scheme follows the chosen base,
  // not the OS, because the product toggle is explicit.
  try {
    root.style.setProperty('font-variant-numeric', 'tabular-nums lining-nums');
    root.style.setProperty('color-scheme', base);
  } catch {
    /* ignore */
  }

  // Pine aliases as data attributes for tooling / pyne host bridge
  try {
    const pine = pineColorMap(tokens);
    root.dataset['chartBgColor'] = pine['chart.bg_color'];
    root.dataset['chartFgColor'] = pine['chart.fg_color'];
    root.dataset['themePreset'] = state?.presetId || 'void-dark';
  } catch {
    /* ignore */
  }
}

/**
 * Build LWC `createChart` / `applyOptions` layout bag from tokens.
 */
export function buildChartOptionsFromTokens(
  tokens: ThemeTokens,
  opts: ApplyChartThemeOpts = {},
): Record<string, unknown> {
  const gridOn = tokens['grid.visible'] !== false;
  const gridVert = gridOn ? String(tokens['grid.vert'] ?? 'transparent') : 'transparent';
  const gridHorz = gridOn ? String(tokens['grid.horz'] ?? 'transparent') : 'transparent';
  const bg = String(tokens['chart.bg_color'] ?? '#030304');
  const panel = String(tokens['chart.panel'] ?? '#0A0B10');
  const chartFg = String(tokens['chart.fg_color'] ?? '#EEEEEE');
  const fg = String(tokens['scale.text'] ?? chartFg);
  const scaleBorder = String(tokens['scale.border'] ?? '#1C2230');
  const accent = String(tokens['ui.accent'] ?? '#939FFF');
  const border = resolveChromeBorder({
    scaleBorder,
    panel,
    bg,
    fg: chartFg,
    accent,
  }).chartBorder;
  const cross = String(tokens['crosshair.color'] ?? 'rgba(147, 159, 255, 0.38)');
  const labelBg = String(tokens['crosshair.label_bg'] ?? tokens['chart.elev'] ?? '#0C0E14');

  return {
    layout: {
      background: { type: ColorType.Solid, color: bg },
      textColor: fg,
      panes: {
        enableResize: opts.enablePaneResize !== false,
        separatorColor: border,
        separatorHoverColor: cross,
      },
    },
    grid: {
      vertLines: { color: gridVert, visible: gridOn },
      horzLines: { color: gridHorz, visible: gridOn },
    },
    rightPriceScale: {
      borderColor: border,
      textColor: fg,
    },
    leftPriceScale: {
      borderColor: border,
    },
    timeScale: {
      borderColor: border,
      ...(opts.secondary
        ? {
            visible: false,
            borderVisible: false,
            timeVisible: false,
            ticksVisible: false,
          }
        : {
            // Keep date+time on axis / crosshair after theme re-apply
            timeVisible: true,
            secondsVisible: false,
            // Do not clear conflation flags set by heavy setData
            enableConflation: true,
          }),
    },
    crosshair: {
      vertLine: {
        color: cross,
        labelBackgroundColor: labelBg,
      },
      horzLine: {
        color: cross,
        labelBackgroundColor: labelBg,
      },
    },
  };
}

/**
 * Apply tokens to an existing LWC chart instance.
 */
export function applyThemeToChart(
  chart: IChartApi | null | undefined,
  state: ChartThemeState | null | undefined,
  opts: ApplyChartThemeOpts = {},
): void {
  if (!chart || typeof chart.applyOptions !== 'function') return;
  const tokens = resolveTokens(state);
  try {
    chart.applyOptions(buildChartOptionsFromTokens(tokens, opts) as never);
  } catch {
    /* LWC option shape drift — ignore */
  }
  if (opts.applyPriceScale !== false) {
    try {
      const bg = String(tokens['chart.bg_color'] ?? '#030304');
      const panel = String(tokens['chart.panel'] ?? '#0A0B10');
      const chartFg = String(tokens['chart.fg_color'] ?? '#EEEEEE');
      const scaleBorder = String(tokens['scale.border'] ?? '#1C2230');
      const accent = String(tokens['ui.accent'] ?? '#939FFF');
      const border = resolveChromeBorder({
        scaleBorder,
        panel,
        bg,
        fg: chartFg,
        accent,
      }).chartBorder;
      chart.priceScale('right').applyOptions({
        borderColor: border,
        textColor: String(tokens['scale.text'] ?? '#9D9EA3'),
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Candlestick / bar series options from theme tokens.
 */
export function buildCandleSeriesOptions(
  tokens: ThemeTokens,
  opts: ApplySeriesThemeOpts = {},
): Record<string, unknown> {
  const up = String(tokens['bar.up.color'] ?? '#3DDC97');
  const down = String(tokens['bar.down.color'] ?? '#F07178');
  const upBorder = String(tokens['bar.up.border'] ?? up);
  const downBorder = String(tokens['bar.down.border'] ?? down);
  const upWick = String(tokens['bar.up.wick'] ?? up);
  const downWick = String(tokens['bar.down.wick'] ?? down);
  const bodyFill = tokens['bar.body_fill'] !== false;
  const borderVisible = tokens['bar.border_visible'] !== false;
  const chartType = opts.chartType || 'candles';

  if (chartType === 'hollow') {
    return {
      upColor: 'rgba(0,0,0,0)',
      downColor: down,
      borderVisible: true,
      borderUpColor: upBorder,
      borderDownColor: downBorder,
      wickUpColor: upWick,
      wickDownColor: downWick,
    };
  }

  return {
    upColor: bodyFill ? up : 'rgba(0,0,0,0)',
    downColor: down,
    borderVisible,
    borderUpColor: upBorder,
    borderDownColor: downBorder,
    wickUpColor: upWick,
    wickDownColor: downWick,
  };
}

/** OHLC bar series options. */
export function buildBarSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  return {
    upColor: String(tokens['bar.up.color'] ?? '#3DDC97'),
    downColor: String(tokens['bar.down.color'] ?? '#F07178'),
    openVisible: true,
    thinBars: tokens['bar.thin_bars'] !== false,
  };
}

/** Line main-series options. */
export function buildLineSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  const color = String(tokens['line.color'] ?? '#8B9CFF');
  const width = Number(tokens['line.width'] ?? 2);
  const bg = String(tokens['chart.bg_color'] ?? '#07080C');
  return {
    color,
    lineWidth: clampLineWidth(width),
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: color,
  };
}

/** Area main-series options. */
export function buildAreaSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  const line = String(tokens['area.line'] ?? tokens['line.color'] ?? '#8B9CFF');
  const bg = String(tokens['chart.bg_color'] ?? '#07080C');
  return {
    lineColor: line,
    topColor: String(tokens['area.top'] ?? 'rgba(139, 156, 255, 0.28)'),
    bottomColor: String(tokens['area.bottom'] ?? 'rgba(139, 156, 255, 0.02)'),
    lineWidth: clampLineWidth(Number(tokens['line.width'] ?? 2)),
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: line,
  };
}

/** Baseline main-series options. */
export function buildBaselineSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  const bg = String(tokens['chart.bg_color'] ?? '#07080C');
  const accent = String(tokens['ui.accent'] ?? '#8B9CFF');
  return {
    topLineColor: String(tokens['baseline.top_line'] ?? '#3DDC97'),
    topFillColor1: String(tokens['baseline.top_fill1'] ?? 'rgba(61, 220, 151, 0.28)'),
    topFillColor2: String(tokens['baseline.top_fill2'] ?? 'rgba(61, 220, 151, 0.04)'),
    bottomLineColor: String(tokens['baseline.bottom_line'] ?? '#F07178'),
    bottomFillColor1: String(tokens['baseline.bottom_fill1'] ?? 'rgba(240, 113, 120, 0.04)'),
    bottomFillColor2: String(tokens['baseline.bottom_fill2'] ?? 'rgba(240, 113, 120, 0.28)'),
    lineWidth: clampLineWidth(Number(tokens['line.width'] ?? 2)),
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: accent,
  };
}

/**
 * Apply theme to the main price series based on chart type.
 */
export function applyThemeToPriceSeries(
  series: ISeriesApi<SeriesType> | null | undefined,
  state: ChartThemeState | null | undefined,
  opts: ApplySeriesThemeOpts = {},
): void {
  if (!series || typeof series.applyOptions !== 'function') return;
  const tokens = resolveTokens(state);
  const type = opts.chartType || 'candles';
  let options: Record<string, unknown>;
  switch (type) {
    case 'bars':
      options = buildBarSeriesOptions(tokens);
      break;
    case 'line':
      options = buildLineSeriesOptions(tokens);
      break;
    case 'area':
      options = buildAreaSeriesOptions(tokens);
      break;
    case 'baseline':
      options = buildBaselineSeriesOptions(tokens);
      break;
    case 'hollow':
      options = buildCandleSeriesOptions(tokens, { chartType: 'hollow' });
      break;
    default:
      options = buildCandleSeriesOptions(tokens, { chartType: 'candles' });
      break;
  }
  try {
    series.applyOptions(options as never);
  } catch {
    /* ignore */
  }
}

/** Volume bar colors (caller paints per-bar; these are the palette). */
export function volumeColors(state: ChartThemeState | null | undefined): {
  up: string;
  down: string;
} {
  const t = resolveTokens(state);
  return {
    up: String(t['volume.up'] ?? 'rgba(61, 220, 151, 0.45)'),
    down: String(t['volume.down'] ?? 'rgba(240, 113, 120, 0.45)'),
  };
}

/**
 * Palette bridge for series-factory VOID-compatible object.
 * Prefer this over hardcoding when theme state is available.
 */
export function tokensToVoidLike(tokens: ThemeTokens): {
  bg: string;
  panel: string;
  elev: string;
  grid: string;
  text: string;
  textDim: string;
  up: string;
  down: string;
  border: string;
  indigo: string;
  indigoSoft: string;
  green: string;
  orange: string;
} {
  return {
    bg: String(tokens['chart.bg_color'] ?? '#030304'),
    panel: String(tokens['chart.panel'] ?? '#0A0B10'),
    elev: String(tokens['chart.elev'] ?? '#0C0E14'),
    grid: String(tokens['grid.vert'] ?? 'rgba(147, 159, 255, 0.07)'),
    text: String(tokens['chart.fg_color'] ?? '#EEEEEE'),
    textDim: String(tokens['scale.text'] ?? '#9D9EA3'),
    up: String(tokens['bar.up.color'] ?? '#3DDC97'),
    down: String(tokens['bar.down.color'] ?? '#F07178'),
    border: String(tokens['scale.border'] ?? '#1C2230'),
    indigo: String(tokens['ui.accent'] ?? '#939FFF'),
    indigoSoft: String(tokens['crosshair.color'] ?? 'rgba(147, 159, 255, 0.38)'),
    green: String(tokens['ui.up'] ?? tokens['bar.up.color'] ?? '#3DDC97'),
    orange: '#e8a03a',
  };
}

function clampLineWidth(n: number): LineWidth {
  const w = Math.round(Number.isFinite(n) ? n : 2);
  if (w <= 1) return 1;
  if (w === 2) return 2;
  if (w === 3) return 3;
  return 4;
}

/** Pine host color snapshot for engines / run requests. */
export function pineHostColors(state: ChartThemeState | null | undefined): {
  bg_color: string;
  fg_color: string;
  color_background: string;
  color_foreground: string;
} {
  const pine = pineColorMap(resolveTokens(state));
  return {
    bg_color: pine['chart.bg_color']!,
    fg_color: pine['chart.fg_color']!,
    color_background: pine['chart.color_background']!,
    color_foreground: pine['chart.color_foreground']!,
  };
}
