// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plot-area rectangle inside a Lightweight Charts host (excludes price + time scales).
 *
 * Drawing SVG, scale-control cluster, and volume-profile strip must sit in this
 * rect so geometry does not paint over axis labels.
 *
 * @module chart/plot-rect
 */

/** Duck-typed LWC chart surface used for pane / scale measurement. */
export type PlotRectChart = {
  paneSize?: (index?: number) => { width: number; height: number };
  timeScale?: () => {
    width?: () => number;
    height?: () => number;
  };
  priceScale?: (id: string) => {
    width?: () => number;
  };
};

/** Chart host element (pane div). */
export type PlotRectHost = {
  clientWidth?: number;
  clientHeight?: number;
  getBoundingClientRect?: () => { width: number; height: number };
};

/** Pixel box of the candle/plot pane plus the scale gutters around it. */
export type ChartPlotRect = {
  /** Offset from host left to plot left (left price scale, if any). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Right price-scale gutter (0 when labels are hidden). */
  rightScale: number;
  /** Time-axis height (0 on secondary panes with no time scale). */
  timeScale: number;
};

function finitePx(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function hostBox(host: PlotRectHost | null | undefined): { w: number; h: number } {
  let w = 0;
  let h = 0;
  try {
    const r = host?.getBoundingClientRect?.();
    if (r) {
      w = finitePx(r.width) ?? 0;
      h = finitePx(r.height) ?? 0;
    }
  } catch {
    /* ignore */
  }
  if (w <= 0) w = finitePx(host?.clientWidth) ?? 0;
  if (h <= 0) h = finitePx(host?.clientHeight) ?? 0;
  return { w, h };
}

function scaleWidth(chart: PlotRectChart | null | undefined, id: 'left' | 'right'): number {
  try {
    const w = finitePx(chart?.priceScale?.(id)?.width?.());
    return w ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Measure the plot pane inside `host` so overlays clip to candles, not scales.
 *
 * Prefers LWC `paneSize()` (plot only). Falls back to host size minus
 * `priceScale().width()` / `timeScale().height()` when paneSize is missing.
 */
export function measureChartPlotRect(
  chart: PlotRectChart | null | undefined,
  host: PlotRectHost | null | undefined,
): ChartPlotRect {
  const { w: hostW, h: hostH } = hostBox(host);
  const left = scaleWidth(chart, 'left');
  const rightScale = scaleWidth(chart, 'right');
  let timeScale = 0;
  try {
    timeScale = finitePx(chart?.timeScale?.()?.height?.()) ?? 0;
  } catch {
    timeScale = 0;
  }

  let width = 0;
  let height = 0;
  try {
    const pane = chart?.paneSize?.();
    if (pane) {
      width = finitePx(pane.width) ?? 0;
      height = finitePx(pane.height) ?? 0;
    }
  } catch {
    /* fall through */
  }
  if (width <= 0) {
    try {
      width = finitePx(chart?.timeScale?.()?.width?.()) ?? 0;
    } catch {
      width = 0;
    }
  }
  if (width <= 0) width = Math.max(0, hostW - left - rightScale);
  if (height <= 0) height = Math.max(0, hostH - timeScale);

  if (hostW > 0) width = Math.min(width, Math.max(0, hostW - left));
  if (hostH > 0) height = Math.min(height, hostH);

  return {
    left,
    top: 0,
    width,
    height,
    rightScale,
    timeScale,
  };
}
