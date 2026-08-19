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
} from 'lightweight-charts';
import { splitOverlayLineSegments } from '../results/plot-visuals';
import { colorWithAlpha } from './series-factory';

export type LineBreakOverlayPoint = { time: number; value?: number };

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

class LineBreakRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly owner: LineBreakPrimitive) {}

  draw(target: unknown, utils?: { setLineStyle: (ctx: CanvasRenderingContext2D, s: LineStyle) => void }): void {
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
      for (const seg of segs) {
        const pts: { x: number; y: number }[] = [];
        for (const p of seg) {
          if (p.time < fromT || p.time > toT) continue;
          const x = ts.timeToCoordinate(p.time as Time);
          const y = series.priceToCoordinate(p.value);
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
          pts.push({ x, y });
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
  private _series: ISeriesApi<any> | null = null;
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

  setPoints(points: ReadonlyArray<LineBreakOverlayPoint>, opts?: Partial<LineBreakPrimitiveOpts>): void {
    const nextOpts = opts ? { ...this._opts, ...opts } : this._opts;
    const last = points.length ? points[points.length - 1] : undefined;
    const sig = `${points.length}|${last?.time ?? ''}|${last?.value ?? ''}|${nextOpts.color}|${nextOpts.lineWidth}|${nextOpts.lineStyle}|${nextOpts.stepped ? 1 : 0}|${nextOpts.area ? 1 : 0}`;
    if (sig === this._pointsSig) return;
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

  series(): ISeriesApi<any> | null {
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
