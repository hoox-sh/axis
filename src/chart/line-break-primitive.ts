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
 * LWC series primitive that strokes Pine `plot.style_*br` segments.
 *
 * Lightweight Charts Line/Area series drop `{ time }` whitespace and connect
 * the remaining samples — that matches `plot.style_line` (span `na`) but not
 * `style_linebr` / `steplinebr` / `areabr`. This primitive walks the original
 * overlay points (whitespace kept) and `moveTo` after each `na` gap.
 *
 * @module chart/line-break-primitive
 */

import {
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type SeriesAttachedParameter,
  type Time,
  type SeriesType,
} from 'lightweight-charts';
import { splitOverlayLineSegments } from '../results/plot-visuals';
import { colorWithAlpha } from './series-factory';

/** One overlay sample: UTC seconds + value. Missing `value` is Pine `na` and breaks the stroke. */
export type LineBreakOverlayPoint = { time: number; value?: number };

/**
 * Shortest internal `na` run treated as **missing data** when the run shipped no
 * bar axis to compare against. Shorter runs are Pine conditions and keep
 * spanning (`plot.style_line`).
 */
export const MIN_DATA_HOLE_BARS = 10;

/** Stroke style for the primitive plus the `*br` variant flags it must emulate. */
export type LineBreakPrimitiveOpts = {
  color: string;
  lineWidth: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  /** `plot.style_steplinebr` — horizontal then vertical. */
  stepped?: boolean;
  /** `plot.style_areabr` — fill each finite run to the pane bottom. */
  area?: boolean;
};

type MediaScope = {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
};

type MediaTarget = {
  useMediaCoordinateSpace: (fn: (scope: MediaScope) => void) => void;
};

const DEFAULT_OPTS: LineBreakPrimitiveOpts = {
  color: '#939fff',
  lineWidth: 2,
  lineStyle: 'solid',
};

function pineLineStyleToLwc(style: LineBreakPrimitiveOpts['lineStyle']): LineStyle {
  if (style === 'dashed') return LineStyle.Dashed;
  if (style === 'dotted') return LineStyle.Dotted;
  return LineStyle.Solid;
}

/**
 * Change signature for overlay points + style. Samples head/mid/tail plus a
 * sparse hash so mid-history rewrites (same length + same tip) still repaint.
 * O(~16) samples — negligible vs segment split on 10k+ points.
 */
export function lineBreakPointsSig(
  points: ReadonlyArray<LineBreakOverlayPoint>,
  opts: LineBreakPrimitiveOpts,
): string {
  const n = points.length;
  if (!n) {
    return `0|||${opts.color}|${opts.lineWidth}|${opts.lineStyle}|${opts.stepped ? 1 : 0}|${opts.area ? 1 : 0}`;
  }
  const first = points[0]!;
  const mid = points[Math.floor(n / 2)]!;
  const last = points[n - 1]!;
  let hash = 0;
  const step = Math.max(1, Math.floor(n / 16));
  for (let i = 0; i < n; i += step) {
    const p = points[i]!;
    const t = Number(p.time) || 0;
    const v = Number(p.value);
    const q = Number.isFinite(v) ? Math.round(v * 1e6) : 0;
    hash = (hash * 31 + (t % 2147483647) + q) | 0;
  }
  return `${n}|${first.time}:${first.value ?? ''}|${mid.time}:${mid.value ?? ''}|${last.time}:${last.value ?? ''}|${hash}|${opts.color}|${opts.lineWidth}|${opts.lineStyle}|${opts.stepped ? 1 : 0}|${opts.area ? 1 : 0}`;
}

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  stepped: boolean,
): void {
  if (pts.length === 0) return;
  const first = pts[0]!;
  if (pts.length === 1) {
    // Isolated sample: short tick so a one-bar island is visible
    ctx.moveTo(first.x - 2, first.y);
    ctx.lineTo(first.x + 2, first.y);
    return;
  }
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (stepped) {
      ctx.lineTo(p.x, pts[i - 1]!.y);
      ctx.lineTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
}

/**
 * Internal `na` runs long enough to be **missing data**, not an inactive
 * condition.
 *
 * When the engine ships no bar axis there is nothing to compare the chart
 * against, yet the series can still carry a long blank stretch (the engine's
 * own bar series lost minutes). A short `na` run is a normal Pine condition
 * (`cond ? value : na`) and must keep spanning; a long one is a hole and must
 * break. Only runs **bounded by finite values on both sides** count — warmup
 * and a not-yet-evaluated tail need no break.
 *
 * @param points overlay samples in candle-axis order
 * @param minRun shortest run treated as missing data (default {@link MIN_DATA_HOLE_BARS})
 */
export function dataHoleTimes(
  points: ReadonlyArray<LineBreakOverlayPoint>,
  minRun = MIN_DATA_HOLE_BARS,
): number[] {
  const n = points.length;
  if (n < minRun + 2) return [];
  const out: number[] = [];
  const finiteAt = (i: number): boolean => {
    const v = Number(points[i]?.value);
    return Number.isFinite(v);
  };
  let i = 0;
  while (i < n) {
    if (finiteAt(i)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !finiteAt(j)) j += 1;
    if (j - i >= minRun && i > 0 && j < n) {
      for (let k = i; k < j; k++) {
        const t = Number(points[k]?.time);
        if (Number.isFinite(t)) out.push(t);
      }
    }
    i = j;
  }
  return out;
}

/**
 * Break points for a line that must not be drawn across **missing data**.
 *
 * The apply pipeline emits a Pine `na` row for every chart bar the engine's own
 * axis skipped, and Lightweight Charts spans those rows with a straight
 * connector — a diagonal drawn through bars the script never evaluated. This
 * turns each such gap into a real break.
 *
 * `plot.style_line` *does* span script-produced `na` (only `style_*br` breaks),
 * so the `na` inside a finite run is linearly interpolated: the primitive then
 * strokes the same straight segment the library would, without bridging a hole.
 *
 * @param points overlay samples in candle-axis order (whitespace = `na`)
 * @param gapTimes chart times the engine axis skipped
 * @returns break-aware points, or `[]` when this series has no gap to break
 */
export function gapAwareLineBreakPoints(
  points: ReadonlyArray<LineBreakOverlayPoint>,
  gapTimes: ReadonlySet<number>,
): LineBreakOverlayPoint[] {
  const n = points.length;
  if (!n || !gapTimes.size) return [];
  const gap: boolean[] = new Array(n);
  let gaps = 0;
  for (let i = 0; i < n; i++) {
    const t = Number(points[i]?.time);
    gap[i] = Number.isFinite(t) && gapTimes.has(t);
    if (gap[i]) gaps += 1;
  }
  if (!gaps) return [];
  const out: LineBreakOverlayPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const v = Number(p.value);
    out[i] = gap[i] || !Number.isFinite(v) ? { time: p.time } : { time: p.time, value: v };
  }
  const finite = (p: LineBreakOverlayPoint | undefined): boolean =>
    p != null && p.value != null && Number.isFinite(Number(p.value));
  // Interpolate script `na` inside a finite run (never across a gap).
  let i = 0;
  while (i < n) {
    if (gap[i] || finite(out[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !gap[j] && !finite(out[j])) j += 1;
    const prev = i > 0 && !gap[i - 1] ? out[i - 1] : undefined;
    const next = j < n && !gap[j] ? out[j] : undefined;
    if (finite(prev) && finite(next)) {
      const a = Number(prev!.value);
      const b = Number(next!.value);
      const span = j - (i - 1);
      for (let k = i; k < j; k++) {
        const w = (k - (i - 1)) / span;
        out[k] = { time: out[k]!.time, value: a + (b - a) * w };
      }
    }
    i = j;
  }
  return out;
}

class LineBreakRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly owner: LineBreakPrimitive) {}

  draw(
    target: unknown,
    utils?: { setLineStyle: (ctx: CanvasRenderingContext2D, s: LineStyle) => void },
  ): void {
    const media = target as MediaTarget | null;
    if (!media || typeof media.useMediaCoordinateSpace !== 'function') return;
    const chart = this.owner.chart();
    const series = this.owner.series();
    if (!chart || !series) return;
    const segs = this.owner.segments();
    if (!segs.length) return;
    const opts = this.owner.options();

    media.useMediaCoordinateSpace(({ context: ctx, mediaSize }: MediaScope) => {
      const ts = chart.timeScale();
      let fromT = Number.NEGATIVE_INFINITY;
      let toT = Number.POSITIVE_INFINITY;
      try {
        const vr = ts.getVisibleRange?.();
        if (vr && vr.from != null && vr.to != null) {
          const pad = (Number(vr.to) - Number(vr.from)) * 0.05 || 0;
          fromT = Number(vr.from) - pad;
          toT = Number(vr.to) + pad;
        }
      } catch {
        /* mock / disposed */
      }
      const mapped: { x: number; y: number }[][] = [];
      const maxPts = Math.max(64, Math.floor((mediaSize?.width || 800) * 2));
      for (const seg of segs) {
        if (!seg.length) continue;
        const head = seg[0]!;
        const tail = seg[seg.length - 1]!;
        if (tail.time < fromT || head.time > toT) continue;
        const step = seg.length > maxPts ? Math.ceil(seg.length / maxPts) : 1;
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < seg.length; i += step) {
          const p = seg[i]!;
          if (p.time < fromT || p.time > toT) continue;
          const x = ts.timeToCoordinate(p.time as Time);
          const y = series.priceToCoordinate(p.value);
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x, y });
        }
        if (step > 1) {
          const last = seg[seg.length - 1]!;
          if (last.time >= fromT && last.time <= toT) {
            const x = ts.timeToCoordinate(last.time as Time);
            const y = series.priceToCoordinate(last.value);
            if (
              x != null &&
              y != null &&
              Number.isFinite(x) &&
              Number.isFinite(y) &&
              (pts.length === 0 || pts[pts.length - 1]!.x !== x)
            ) {
              pts.push({ x, y });
            }
          }
        }
        if (pts.length) mapped.push(pts);
      }
      if (!mapped.length) return;

      if (opts.area) {
        const fill = colorWithAlpha(opts.color, 0.22);
        const bottom = mediaSize.height;
        ctx.save();
        ctx.fillStyle = fill;
        for (const pts of mapped) {
          if (pts.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0]!.x, bottom);
          ctx.lineTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < pts.length; i++) {
            const p = pts[i]!;
            if (opts.stepped) {
              ctx.lineTo(p.x, pts[i - 1]!.y);
              ctx.lineTo(p.x, p.y);
            } else {
              ctx.lineTo(p.x, p.y);
            }
          }
          ctx.lineTo(pts[pts.length - 1]!.x, bottom);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = opts.color;
      ctx.lineWidth = Math.max(1, opts.lineWidth);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (utils?.setLineStyle) {
        utils.setLineStyle(ctx, pineLineStyleToLwc(opts.lineStyle));
      } else if (opts.lineStyle === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else if (opts.lineStyle === 'dotted') {
        ctx.setLineDash([2, 3]);
      }
      for (const pts of mapped) strokeSegment(ctx, pts, !!opts.stepped);
      ctx.stroke();
      ctx.restore();
    });
  }
}

class LineBreakPaneView implements IPrimitivePaneView {
  private readonly _renderer: LineBreakRenderer;

  constructor(owner: LineBreakPrimitive) {
    this._renderer = new LineBreakRenderer(owner);
  }

  zOrder(): 'normal' {
    return 'normal';
  }

  renderer(): IPrimitivePaneRenderer {
    return this._renderer;
  }
}

/**
 * Series primitive: hide the LWC connector (`lineVisible: false`) and draw
 * finite runs from the original overlay points (whitespace = `na` break).
 */
export class LineBreakPrimitive implements ISeriesPrimitive<Time> {
  private _points: LineBreakOverlayPoint[] = [];
  private _opts: LineBreakPrimitiveOpts = { ...DEFAULT_OPTS };
  private _segments: { time: number; value: number }[][] = [];
  private _pointsSig = '';
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _requestUpdate: (() => void) | null = null;
  private readonly _paneViews: IPrimitivePaneView[];

  constructor() {
    this._paneViews = [new LineBreakPaneView(this)];
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart as IChartApi;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setPoints(
    points: ReadonlyArray<LineBreakOverlayPoint>,
    opts?: Partial<LineBreakPrimitiveOpts>,
    force = false,
  ): void {
    const nextOpts = opts ? { ...this._opts, ...opts } : this._opts;
    const sig = lineBreakPointsSig(points, nextOpts);
    if (!force && sig === this._pointsSig) return;
    this._pointsSig = sig;
    this._points = points.slice();
    this._opts = nextOpts;
    this._segments = splitOverlayLineSegments(this._points);
    try {
      this._requestUpdate?.();
    } catch {
      /* disposed */
    }
  }

  chart(): IChartApi | null {
    return this._chart;
  }

  series(): ISeriesApi<SeriesType> | null {
    return this._series;
  }

  options(): LineBreakPrimitiveOpts {
    return this._opts;
  }

  /** Finite runs used by the renderer (and tests). */
  segments(): { time: number; value: number }[][] {
    return this._segments;
  }
}
