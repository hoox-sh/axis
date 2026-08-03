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
 * Apply resolved theme tokens to DOM (CSS vars) and Lightweight Charts APIs.
 *
 * @module theme/apply
 */

import { ColorType, type IChartApi, type ISeriesApi, type LineWidth } from 'lightweight-charts';
import { pineColorMap } from './catalog';
import { resolveTokens } from './resolve';
import type {
  ApplyChartThemeOpts,
  ApplySeriesThemeOpts,
  ChartThemeState,
  ThemeTokens,
} from './types';

/** CSS custom properties written for chart + chrome bridge. */
const CSS_VAR_MAP: Record<string, string> = {
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

/**
 * Write theme CSS variables + `data-theme` on `<html>`.
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
  for (const [tokenKey, cssVar] of Object.entries(CSS_VAR_MAP)) {
    const v = tokens[tokenKey];
    if (v == null) continue;
    try {
      root.style.setProperty(cssVar, String(v));
    } catch {
      /* ignore */
    }
  }
  // Pine aliases as data attributes for tooling / pyne host bridge
  try {
    const pine = pineColorMap(tokens);
    root.dataset.chartBgColor = pine['chart.bg_color'];
    root.dataset.chartFgColor = pine['chart.fg_color'];
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
  const bg = String(tokens['chart.bg_color'] ?? '#0a0b10');
  const fg = String(tokens['scale.text'] ?? tokens['chart.fg_color'] ?? '#8b8e9c');
  const border = String(tokens['scale.border'] ?? '#3a3d4a');
  const cross = String(tokens['crosshair.color'] ?? 'rgba(147, 159, 255, 0.38)');
  const labelBg = String(tokens['crosshair.label_bg'] ?? tokens['chart.elev'] ?? '#171821');

  return {
    layout: {
      background: { type: ColorType.Solid, color: bg },
      textColor: fg,
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
        : {}),
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
      chart.priceScale('right').applyOptions({
        borderColor: String(tokens['scale.border'] ?? '#3a3d4a'),
        textColor: String(tokens['scale.text'] ?? '#8b8e9c'),
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
  const up = String(tokens['bar.up.color'] ?? '#5ecf8a');
  const down = String(tokens['bar.down.color'] ?? '#e85d4c');
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
    upColor: String(tokens['bar.up.color'] ?? '#5ecf8a'),
    downColor: String(tokens['bar.down.color'] ?? '#e85d4c'),
    openVisible: true,
    thinBars: tokens['bar.thin_bars'] !== false,
  };
}

/** Line main-series options. */
export function buildLineSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  const color = String(tokens['line.color'] ?? '#939fff');
  const width = Number(tokens['line.width'] ?? 2);
  const bg = String(tokens['chart.bg_color'] ?? '#0a0b10');
  return {
    color,
    lineWidth: clampLineWidth(width),
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: color,
  };
}

/** Area main-series options. */
export function buildAreaSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  const line = String(tokens['area.line'] ?? tokens['line.color'] ?? '#939fff');
  const bg = String(tokens['chart.bg_color'] ?? '#0a0b10');
  return {
    lineColor: line,
    topColor: String(tokens['area.top'] ?? 'rgba(147, 159, 255, 0.28)'),
    bottomColor: String(tokens['area.bottom'] ?? 'rgba(147, 159, 255, 0.02)'),
    lineWidth: clampLineWidth(Number(tokens['line.width'] ?? 2)),
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: line,
  };
}

/** Baseline main-series options. */
export function buildBaselineSeriesOptions(tokens: ThemeTokens): Record<string, unknown> {
  const bg = String(tokens['chart.bg_color'] ?? '#0a0b10');
  const accent = String(tokens['ui.accent'] ?? '#939fff');
  return {
    topLineColor: String(tokens['baseline.top_line'] ?? '#5ecf8a'),
    topFillColor1: String(tokens['baseline.top_fill1'] ?? 'rgba(94, 207, 138, 0.28)'),
    topFillColor2: String(tokens['baseline.top_fill2'] ?? 'rgba(94, 207, 138, 0.04)'),
    bottomLineColor: String(tokens['baseline.bottom_line'] ?? '#e85d4c'),
    bottomFillColor1: String(tokens['baseline.bottom_fill1'] ?? 'rgba(232, 93, 76, 0.04)'),
    bottomFillColor2: String(tokens['baseline.bottom_fill2'] ?? 'rgba(232, 93, 76, 0.28)'),
    lineWidth: clampLineWidth(Number(tokens['line.width'] ?? 2)),
    crosshairMarkerBorderColor: bg,
    crosshairMarkerBackgroundColor: accent,
  };
}

/**
 * Apply theme to the main price series based on chart type.
 */
export function applyThemeToPriceSeries(
  series: ISeriesApi<any> | null | undefined,
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
    case 'heikinashi':
    case 'candles':
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
    up: String(t['volume.up'] ?? 'rgba(94, 207, 138, 0.45)'),
    down: String(t['volume.down'] ?? 'rgba(232, 93, 76, 0.45)'),
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
    bg: String(tokens['chart.bg_color'] ?? '#0a0b10'),
    panel: String(tokens['chart.panel'] ?? '#111218'),
    elev: String(tokens['chart.elev'] ?? '#171821'),
    grid: String(tokens['grid.vert'] ?? 'rgba(140, 130, 180, 0.07)'),
    text: String(tokens['chart.fg_color'] ?? '#c8cad4'),
    textDim: String(tokens['scale.text'] ?? '#8b8e9c'),
    up: String(tokens['bar.up.color'] ?? '#5ecf8a'),
    down: String(tokens['bar.down.color'] ?? '#e85d4c'),
    border: String(tokens['scale.border'] ?? '#3a3d4a'),
    indigo: String(tokens['ui.accent'] ?? '#939fff'),
    indigoSoft: String(tokens['crosshair.color'] ?? 'rgba(147, 159, 255, 0.38)'),
    green: String(tokens['ui.up'] ?? tokens['bar.up.color'] ?? '#5ecf8a'),
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
