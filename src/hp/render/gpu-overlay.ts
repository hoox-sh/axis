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
 * GPU candle overlay for the price pane (HP-3 wiring, plan §4 / §14.2).
 *
 * **Stacked-canvas parity mode**: the WebGL2 renderer draws the *same*
 * candles Lightweight Charts is already painting, directly over the price
 * pane's content area — aligned by construction against LWC's own
 * geometry (visible logical range + right-scale coordinates), with no
 * PaneManager surgery. LWC stays the painter and the full fallback;
 * hiding LWC's candle series is the *next* switch, gated on production
 * measurement of this overlay — doing that first is exactly what plan
 * §14.2 forbids.
 *
 * Data source is the ingest hot SAB ring (HP-2) — the same published
 * generation the LWC copy-out sampler paints from — so both painters are
 * fed from one seqlock-verified sample. The fill runs the seqlock
 * discipline (even generations only, torn samples retried then dropped),
 * and `draw()` clears the transparent canvas every frame, so a skipped
 * frame shows the LWC candles underneath, never a stale GL layer.
 *
 * **Explicit rung only**: the overlay engages solely when
 * `axis.engine.hp.gpu` is *forced* to `webgl2`. LWC paints candle bodies
 * translucent (`0.76`) — stacking identical GL bodies on top composites
 * them darker, and no default path may recolor candles the user never
 * asked to change. While LWC still paints the same candles (the
 * hide-LWC-candles switch is gated on production measurement), `auto`,
 * `off`, and the painterless `webgpu` rung all leave this overlay
 * dormant: this is a parity instrument, not yet the production painter.
 *
 * A frame is skipped (canvas cleared) whenever:
 *
 * - the gpu flag is not the forced `webgl2` rung (see above),
 * - the live wire has no hot ring (flag off, not isolated, no wire yet),
 * - the ring and the chart disagree on series length (symbol switch or
 *   snapshot merge in flight),
 * - the visible logical range's left edge leaves the hot window (cold
 *   viewport paging is a later phase — LWC owns cold ranges),
 * - the right price scale is not linear (log/percentage/indexed scales
 *   round-trip differently — LWC owns those), or
 * - the visible bar count is absurd (zoomed out past the sanity cap).
 *
 * @module hp/render/gpu-overlay
 */

import type { IChartApi } from 'lightweight-charts';
import { isolationProbe } from '../capabilities';
import { hpGpuMode } from '../feature-flag';
import type { HotBuffer } from '../memory/hot-buffer';
import {
  allocateVisualAttr,
  fillVisualAttrFromHot,
  type VisualAttrBuffer,
  type VisualPalette,
} from '../paint/visual-attr';
import { probeRendererKind } from './select-renderer';
import type { CandleRenderer, RenderViewport } from './types';
import { createWebgl2Renderer } from './webgl2-renderer';

/** Sanity cap: beyond this the viewport is LWC's problem, not a GL frame. */
export const MAX_OVERLAY_BARS = 10_000;

/** Tolerance (CSS px) for the linear-scale round-trip check. */
const LINEAR_EPSILON_PX = 1.5;

/**
 * The slice of the price candle series the overlay needs, structurally
 * typed so this module stays independent of LWC's generic series types.
 *
 * LWC v5 puts price↔coordinate conversion on the *series* (its coordinate
 * space is the pane content area — exactly the space the overlay fills).
 */
export type GpuCandleSeries = {
  options(): { upColor?: string; downColor?: string };
  priceToCoordinate(price: number): number | null;
  coordinateToPrice(coordinate: number): number | null;
};

export type GpuOverlayDeps = {
  /** Chart-host element the overlay canvas is positioned inside. */
  host: HTMLElement;
  /** The price pane's LWC chart (`null` while the pane rebuilds). */
  getPriceChart: () => IChartApi | null;
  /** The price pane's candle series (geometry + palette source). */
  getCandleSeries: () => GpuCandleSeries | null;
  /** The price pane's DOM element (geometry anchor). */
  getPricePaneEl: () => HTMLElement | null;
  /** Bars the chart currently holds — the ring-alignment guard. */
  getBarsLength: () => number;
  /** The live wire's hot ring (`null` when HP is off / no wire). */
  getHotBuffer: () => HotBuffer | null;
  /** Palette used until the candle series exists (theme fallback). */
  fallbackPalette: VisualPalette;
};

/**
 * Parse a CSS color (`#RGB`, `#RRGGBB`, `rgb()`, `rgba()`) to `0xRRGGBB`.
 * Returns `null` for anything else — callers fall back.
 */
export function parseCssColorToRgb(css: string | undefined | null): number | null {
  if (!css) return null;
  const s = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1] as string;
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    return Number.parseInt(full, 16);
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (fn) {
    const parts = (fn[1] as string).split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const [r, g, b] = parts;
      const n = (v: string): number => Math.min(255, Math.max(0, Math.round(Number(v))));
      const rv = n(r as string);
      const gv = n(g as string);
      const bv = n(b as string);
      if (Number.isFinite(rv) && Number.isFinite(gv) && Number.isFinite(bv)) {
        return (rv << 16) | (gv << 8) | bv;
      }
    }
  }
  return null;
}

/**
 * The GL viewport for one frame of a visible logical range, as LWC-anchored
 * geometry: record `i` must land where LWC puts logical `fromBase + i`.
 *
 * Pure and exported so `tests/hp/gpu-parity.test.ts` can pin the alignment
 * contract without a DOM. `null` = no GL frame for this range (degenerate,
 * non-finite, or past {@link MAX_OVERLAY_BARS}).
 */
export type OverlayGeometry = {
  /** `floor(range.from)` — absolute index of the first record. */
  fromBase: number;
  /** Bars the fill asks for (`ceil(range.to) − fromBase`). */
  visibleCount: number;
  /** CSS px per candle slot — LWC's own bar spacing. */
  barSpacing: number;
  /**
   * Fractional logical index (relative to `fromBase`) parked at the right
   * edge. Record `i` sits `(rightEdgeIndex − i) · barSpacing` from the
   * right edge, which equals LWC's `(to − (fromBase + i)) · barSpacing`
   * for every bar — fractional on purpose, so LWC's right margin and
   * fractional pan offsets never shift a single candle.
   */
  rightEdgeIndex: number;
};

/** Compute {@link OverlayGeometry} for a range over a content width (px). */
export function overlayViewport(
  range: { from: number; to: number } | null | undefined,
  contentWidth: number,
): OverlayGeometry | null {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return null;
  if (!(range.to > range.from)) return null;
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return null;
  const fromBase = Math.floor(range.from);
  const visibleCount = Math.ceil(range.to) - fromBase;
  if (visibleCount <= 0 || visibleCount > MAX_OVERLAY_BARS) return null;
  return {
    fromBase,
    visibleCount,
    barSpacing: contentWidth / (range.to - range.from),
    rightEdgeIndex: range.to - fromBase,
  };
}

/**
 * Start the overlay pump. Returns the disposer; a no-op disposer unless the
 * *forced* `webgl2` rung is available (see the module doc for why `auto`
 * stays dormant: no default path may recolor LWC's translucent candles).
 */
export function startGpuOverlay(deps: GpuOverlayDeps): () => void {
  const mode = hpGpuMode();
  if (mode !== 'webgl2') return () => {};
  if (probeRendererKind(isolationProbe(), mode) !== 'webgl2') return () => {};

  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-axis-gpu-overlay', '1');
  canvas.style.position = 'absolute';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '10'; // above LWC canvases, below the z-16 chrome
  canvas.style.display = 'none'; // shown on the first sized frame
  deps.host.appendChild(canvas);

  const renderer: CandleRenderer | null = createWebgl2Renderer(canvas);
  if (!renderer) {
    canvas.remove();
    return () => {};
  }

  let attr: VisualAttrBuffer | null = null;
  let painted = false;
  let lastBox = '';
  let lastColors = '';
  let palette: VisualPalette = deps.fallbackPalette;
  let lastVp: RenderViewport = { width: 1, height: 1, barSpacing: 1, rightEdgeIndex: 1 };
  let stopped = false;
  let handle = 0;

  const clear = (): void => {
    if (!painted) return;
    renderer.draw(attr ?? ({} as VisualAttrBuffer), 0, lastVp); // draw clears first
    painted = false;
  };

  const resolvePalette = (series: GpuCandleSeries): void => {
    const opts = series.options();
    const key = `${opts.upColor ?? ''}|${opts.downColor ?? ''}`;
    if (key === lastColors) return;
    lastColors = key;
    const up = parseCssColorToRgb(opts.upColor);
    const down = parseCssColorToRgb(opts.downColor);
    palette = {
      up: up ?? deps.fallbackPalette.up,
      down: down ?? deps.fallbackPalette.down,
    };
  };

  const priceScaleLinear = (
    series: GpuCandleSeries,
    h: number,
  ): { yMin: number; yMax: number } | null => {
    const top = series.coordinateToPrice(0);
    const bottom = series.coordinateToPrice(h - 1);
    if (top == null || bottom == null || !(top > bottom)) return null;
    // The renderer's NDC map is linear; verify LWC's current scale is too
    // (log/percentage/indexed scales round-trip off the midpoint).
    const midBack = series.priceToCoordinate((top + bottom) / 2);
    if (midBack == null || Math.abs(midBack - (h - 1) / 2) > LINEAR_EPSILON_PX) return null;
    return { yMin: bottom, yMax: top };
  };

  const drawOnce = (): void => {
    const chart = deps.getPriceChart();
    const paneEl = deps.getPricePaneEl();
    const hot = deps.getHotBuffer();
    const series = deps.getCandleSeries();
    if (!chart || !paneEl || !hot || !series) {
      clear();
      return;
    }

    const control = hot.control;
    const hotFrom = control.hotFromIndex;
    const seriesLen = hotFrom + control.hotCount;
    if (control.hotCount <= 0 || deps.getBarsLength() !== seriesLen) {
      clear();
      return;
    }

    const ps = chart.priceScale('right');
    const paneRect = paneEl.getBoundingClientRect();
    const hostRect = deps.host.getBoundingClientRect();
    const tsHeight = chart.timeScale().height();
    const w = Math.floor(paneRect.width - ps.width());
    const h = Math.floor(paneRect.height - tsHeight);
    if (w < 2 || h < 2) {
      clear();
      return;
    }

    const geom = overlayViewport(chart.timeScale().getVisibleLogicalRange(), w);
    if (!geom) {
      clear();
      return;
    }
    // Left-containment (cold paging unwired): a cold left edge would make
    // the fill's record 0 mean a different bar than the renderer's anchor
    // assumes. Fully past-the-ring views draw nothing — clear, never keep
    // a stale frame. The right edge may stick out into LWC's right margin:
    // those slots hold no bars for either painter, and `rightEdgeIndex`
    // keeps every existing record anchored exactly where LWC puts it.
    if (geom.fromBase < hotFrom || geom.fromBase >= seriesLen) {
      clear();
      return;
    }

    const y = priceScaleLinear(series, h);
    if (!y) {
      clear();
      return;
    }

    if (!attr || attr.capacity < geom.visibleCount) {
      attr = allocateVisualAttr(geom.visibleCount);
      if (!attr) {
        clear();
        return;
      }
    }
    resolvePalette(series);

    const n = fillVisualAttrFromHot(
      hot,
      attr,
      { fromAbs: geom.fromBase, visibleCount: geom.visibleCount, y },
      palette,
    );
    if (n == null || n <= 0) return; // torn sample — keep the previous frame

    lastVp = {
      width: w,
      height: h,
      barSpacing: geom.barSpacing,
      rightEdgeIndex: geom.rightEdgeIndex,
    };

    const dpr = globalThis.devicePixelRatio || 1;
    renderer.resize(w, h, dpr);

    const box = `${Math.round(paneRect.left - hostRect.left)},${Math.round(
      paneRect.top - hostRect.top,
    )},${w},${h}`;
    if (box !== lastBox) {
      lastBox = box;
      const [left, top, gw, gh] = box.split(',').map(Number) as [number, number, number, number];
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      canvas.style.width = `${gw}px`;
      canvas.style.height = `${gh}px`;
      canvas.style.display = 'block';
    }

    renderer.draw(attr, n, lastVp);
    painted = true;
  };

  const tick = (): void => {
    if (stopped) return;
    try {
      drawOnce();
    } catch {
      // The GPU rung is an optimization — a broken frame never breaks the
      // chart; the next frame retries.
    }
    handle = globalThis.requestAnimationFrame(tick);
  };
  handle = globalThis.requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (handle) globalThis.cancelAnimationFrame(handle);
    try {
      renderer.dispose();
    } catch {
      /* dispose must never throw */
    }
    canvas.remove();
  };
}
