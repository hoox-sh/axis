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
 * SVG overlay drawing layer on the Lightweight Charts price pane.
 *
 * Hosts two independent content groups under one full-pane SVG:
 * - **User group** (`gDraw` / draft): interactive annotations (trend, hline, fib, …)
 * - **Pine script group** (`gScript`): view-only line/label/box from the last `/run`
 *
 * Pointer coords convert ↔ `(time, price)` via the chart time scale and candle
 * series price scale. Interaction modes (magnet, lock, stay-in-mode, hide, style
 * prefs) are set from the store / toolbar; geometry changes emit via `onChange`.
 *
 * Created by `ensureDrawingLayer` in `manager-access.ts`; exposed to the toolbar
 * through the module singleton {@link getActiveDrawingLayer}.
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import {
  DRAWING_COLORS,
  FIB_LEVELS,
  needsNPoints,
  needsThreePoints,
  needsTwoPoints,
  resolveDrawingStyle,
  toolArity,
  type Drawing,
  type DrawingLineStyle,
  type DrawingToolId,
  type Point,
} from './drawing-types';
import {
  DEFAULT_DRAWING_LIMITS,
  clampTimeToLastBar,
  dedupeScriptLabelsAtSameTime,
  garbageCollectScriptDrawings,
  normalizeScriptDrawings,
  type DrawingLimits,
  type ScriptDrawing,
} from './pyne-drawings';
import { snapToBars, type BarLike, type MagnetMode } from './drawings/snap';
import { strokeDashFor } from './drawings/svg-primitives';
import {
  DRAWING_FUTURE_BARS,
  DRAWING_RIGHT_OFFSET_DEFAULT,
  clampTimeToFutureHorizon,
  logicalIndexToUnixTime,
  unixTimeToLogicalIndex,
} from './drawings/coords';
import {
  getToolHandler,
  type ToolHitCtx,
  type ToolViewCtx,
} from './drawings/tools';
import {
  clampStrokeWidth,
  isFinitePoint,
  sanitizeDrawingText,
  sanitizePoints,
  sanitizeStrokeColor,
} from './drawings/tools/safe';
// Register extended tool handlers (side effects)
import './drawings/tools';

/** True when `n` is a finite number (SVG attrs / LWC coords). */
function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Fired after user drawings change (place, drag end, delete, clear). */
export type DrawingChangeHandler = (drawings: Drawing[]) => void;
/** Fired when hit-test selection changes (including clear). */
export type SelectionChangeHandler = (id: string | null) => void;
/** Fired when the layer changes the tool (e.g. auto-cursor after place). */
export type ToolChangeHandler = (tool: DrawingToolId) => void;

/** Defaults applied to newly placed drawings (mirrors store `drawingPrefs`). */
export type StylePrefs = {
  color: string;
  width: number;
  lineStyle: DrawingLineStyle;
  fillOpacity: number;
};

/**
 * Active layer singleton for toolbar / external callers.
 * Avoids importing ChartHost (Solid) from pure chart modules; set in constructor, cleared in destroy.
 */
let activeLayer: DrawingLayer | null = null;

/** Return the live price-pane drawing layer, if one is mounted. */
export function getActiveDrawingLayer(): DrawingLayer | null {
  return activeLayer;
}

function uid(): string {
  return `dw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** True when two anchors are effectively the same (zero-length segment). */
function anchorsTooClose(a: Point, b: Point): boolean {
  if (!isFinitePoint(a) || !isFinitePoint(b)) return true;
  return a.time === b.time && a.price === b.price;
}

/** Drag handle mode: whole-body move or endpoint resize (`price` reserved). */
type DragMode = 'move' | 'p1' | 'p2' | 'price';

type DragState = {
  id: string;
  start: Point;
  origin: Drawing;
  mode: DragMode;
};

/**
 * Full-pane SVG drawing controller for one LWC chart + price series.
 *
 * Cursor tool: SVG `pointer-events: none` so empty areas pan/zoom LWC; painted
 * shapes opt in. Place tools flip the SVG to `pointer-events: auto` + crosshair.
 */
export class DrawingLayer {
  private host: HTMLElement;
  private chart: IChartApi;
  /** Price series host (candles, bars, line, …) for price ↔ Y conversion. */
  private series: ISeriesApi<any>;
  private svg: SVGSVGElement;
  /** Pine `fill(plot1,plot2)` bands (under script line/label drawings). */
  private gFill: SVGGElement;
  /** View-only Pine drawings (z-order under user group). */
  private gScript: SVGGElement;
  /** Editable user drawings. */
  private gDraw: SVGGElement;
  /** In-progress two-point place preview. */
  private gDraft: SVGGElement;
  private tool: DrawingToolId = 'cursor';
  private drawings: Drawing[] = [];
  private scriptDrawings: ScriptDrawing[] = [];
  /**
   * Pine fill bands: upper/lower price series + color, projected to SVG on redraw.
   * Populated by {@link setPlotFills} from runner after a successful `/run`.
   */
  private plotFills: Array<{
    name: string;
    times: number[];
    upper: (number | null)[];
    lower: (number | null)[];
    colors: (string | null)[];
    color: string;
  }> = [];
  private selectedId: string | null = null;
  /** In-progress multi-click placement (1/2/3/n anchors). */
  private draft: { tool: DrawingToolId; points: Point[] } | null = null;
  private drag: DragState | null = null;
  /** Suppress click-after-drag so a completed move does not re-select/clear. */
  private didDrag = false;
  private onChange: DrawingChangeHandler | null = null;
  private onSelectionChange: SelectionChangeHandler | null = null;
  private onToolChange: ToolChangeHandler | null = null;
  private unsubs: Array<() => void> = [];
  private ro: ResizeObserver | null = null;
  /** OHLCV for magnet snap; typically `() => store.bars`. */
  private barsProvider: (() => readonly BarLike[]) | null = null;
  /**
   * Active chart symbol for anchoring new placements (`meta.symbol`).
   * Typically `() => store.symbol`. Empty/null skips stamping.
   */
  private symbolProvider: (() => string) | null = null;
  private magnet: MagnetMode = 'off';
  /** Keep place tool after each drawing when true; otherwise {@link afterPlace} → cursor. */
  private stayInMode = false;
  /** Blocks all drag/resize and delete when true. */
  private lockAll = false;
  /** Skip painting non-selected user drawings (selected still shown). */
  private hideDrawings = false;
  private stylePrefs: StylePrefs = {
    color: DRAWING_COLORS.default,
    width: 1.5,
    lineStyle: 'solid',
    fillOpacity: 0.15,
  };
  /** Coalesce pan/zoom redraws — avoid thrashing gScript replace on every frame. */
  private redrawRaf = 0;
  /** Skip setScriptDrawings when payload is unchanged (live silent re-runs). */
  private lastScriptSig = '';

  /**
   * @param host - Price pane DOM element (positioning context; gets the SVG child)
   * @param chart - LWC chart API (time scale + crosshair subscriptions)
   * @param series - Price series for price ↔ Y conversion (any main series type)
   */
  constructor(
    host: HTMLElement,
    chart: IChartApi,
    series: ISeriesApi<any>,
  ) {
    this.host = host;
    this.chart = chart;
    this.series = series;
    activeLayer = this;

    // Ensure host is positioning context
    const cs = getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'axis-drawing-layer');
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '4',
      // none: empty areas pass pan/zoom to LWC; shapes set pointer-events
      pointerEvents: 'none',
      overflow: 'hidden',
    } as CSSStyleDeclaration);

    this.gFill = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gFill.setAttribute('class', 'axis-pyne-fills');
    this.gScript = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gScript.setAttribute('class', 'axis-pyne-drawings');
    this.gDraw = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.gDraft = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    // Fills under lines/labels; user drawings on top
    this.svg.appendChild(this.gFill);
    this.svg.appendChild(this.gScript);
    this.svg.appendChild(this.gDraw);
    this.svg.appendChild(this.gDraft);
    host.appendChild(this.svg);

    this.bindEvents();
    // Seed a small empty right margin so place tools can start past the last bar
    try {
      const cur = this.chart.timeScale().options().rightOffset ?? 0;
      if (cur < DRAWING_RIGHT_OFFSET_DEFAULT) {
        this.chart.timeScale().applyOptions({
          rightOffset: DRAWING_RIGHT_OFFSET_DEFAULT,
        });
      }
    } catch {
      /* ignore */
    }
    this.syncSize();
    this.redraw();
  }

  /** Persist / UI callback when the user drawing list changes. */
  setOnChange(cb: DrawingChangeHandler | null) {
    this.onChange = cb;
  }

  /** Store selection for the floating style bar. */
  setOnSelectionChange(cb: SelectionChangeHandler | null) {
    this.onSelectionChange = cb;
  }

  /** Store tool when the layer auto-switches (after place without stay-in-mode). */
  setOnToolChange(cb: ToolChangeHandler | null) {
    this.onToolChange = cb;
  }

  /** Provide bar data for magnet snap in {@link clientToPoint}. */
  setBarsProvider(fn: (() => readonly BarLike[]) | null) {
    this.barsProvider = fn;
  }

  /**
   * Provide the active chart symbol so new placements stamp `meta.symbol`.
   * Drawings are filtered per-symbol in store/layer sync (manager-access).
   */
  setSymbolProvider(fn: (() => string) | null) {
    this.symbolProvider = fn;
  }

  /** Magnet mode: `off` | `weak` (10px) | `strong` (always snap when bars exist). */
  setMagnet(mode: MagnetMode) {
    this.magnet = mode;
  }

  /** When true, remain on the place tool after each successful placement. */
  setStayInMode(on: boolean) {
    this.stayInMode = on;
  }

  /** Global lock — drag start and delete no-op while on. */
  setLockAll(on: boolean) {
    this.lockAll = on;
  }

  /** Hide non-selected user drawings; re-paints the user group immediately. */
  setHideDrawings(on: boolean) {
    if (this.hideDrawings === on) return;
    this.hideDrawings = on;
    this.redrawUser();
  }

  /** Merge defaults used by {@link applyCreateStyle} on next placement. */
  setStylePrefs(prefs: Partial<StylePrefs>) {
    this.stylePrefs = { ...this.stylePrefs, ...prefs };
  }

  /**
   * Swap the price series used for price ↔ Y (e.g. chart type change).
   * Does not recreate the SVG overlay; re-paints with the new scale host.
   */
  setSeries(series: ISeriesApi<any>) {
    this.series = series;
    this.redraw();
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  /** Select a drawing (or null); notifies store and re-paints handles. */
  setSelectedId(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.onSelectionChange?.(id);
    this.redrawUser();
  }

  /**
   * Patch the selected drawing's style/geometry and emit.
   * No-op (returns false) when nothing selected, missing id, lockAll, or per-drawing locked.
   */
  updateSelected(patch: Partial<Drawing>): boolean {
    if (!this.selectedId) return false;
    const idx = this.drawings.findIndex((d) => d.id === this.selectedId);
    if (idx < 0) return false;
    const cur = this.drawings[idx]!;
    if (this.lockAll || resolveDrawingStyle(cur).locked) return false;
    this.drawings[idx] = { ...cur, ...patch } as Drawing;
    this.emit();
    this.redrawUser();
    return true;
  }

  /**
   * Switch tool; clears draft/drag. Place tools capture the full SVG surface;
   * cursor restores `pointer-events: none` so only painted shapes receive hits.
   *
   * **Same-tool re-apply is a no-op** unless `force` is set (preserves
   * in-progress draft). ChartHost / store effects re-push the active tool often;
   * wiping draft there made the second trendline (and other multi-click tools)
   * lose their first anchor mid-placement. Toolbar explicit picks use `force`.
   */
  setTool(tool: DrawingToolId, opts?: { force?: boolean }) {
    if (this.tool === tool && !opts?.force) {
      // Still ensure pointer-events match (e.g. after destroy/recreate race)
      this.svg.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
      this.svg.style.cursor =
        tool === 'cursor' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair';
      return;
    }
    this.tool = tool;
    this.draft = null;
    this.drag = null;
    this.clearDraftDom();
    // Drawing tools capture full surface; cursor only hits painted shapes
    this.svg.style.pointerEvents = tool === 'cursor' ? 'none' : 'auto';
    this.svg.style.cursor =
      tool === 'cursor' ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair';
    // Tool switch does not change scales — only user handles/draft matter
    this.redrawUser();
  }

  getTool(): DrawingToolId {
    return this.tool;
  }

  /** Replace user drawings from store (e.g. after load); does not emit. */
  setDrawings(drawings: Drawing[]) {
    this.drawings = drawings.slice();
    this.redrawUser();
  }

  /**
   * Pine line/label/box from last `/run` (not user-editable).
   * Skips DOM rebuild when the payload signature matches the last apply — live
   * silent re-runs were re-applying the same drawings every tick (hide/show flicker).
   * Pan/zoom still re-projects via {@link scheduleRedraw}.
   *
   * Applies Pine garbage collection using `indicator()` / `strategy()` caps
   * (`max_lines_count`, `max_labels_count`, `max_boxes_count`,
   * `max_polylines_count`; default 50 each).
   *
   * @returns Number of drawings kept after normalize + GC.
   */
  setScriptDrawings(
    raw: unknown[] | undefined | null,
    limits: DrawingLimits = DEFAULT_DRAWING_LIMITS,
  ): number {
    // Normalize → GC caps → collapse same-text label stacks (status labels).
    // Future-time clamp is applied at paint (toXY) so we also dedupe by raw t1
    // here; identical future anchors share one key and collapse to one chip.
    const next = dedupeScriptLabelsAtSameTime(
      garbageCollectScriptDrawings(normalizeScriptDrawings(raw), limits),
    );
    const sig = scriptDrawingsSignature(next);
    if (sig === this.lastScriptSig) return this.scriptDrawings.length;
    this.lastScriptSig = sig;
    this.scriptDrawings = next;
    this.redrawScript();
    return next.length;
  }

  clearScriptDrawings() {
    if (!this.scriptDrawings.length && this.lastScriptSig === '') return;
    this.scriptDrawings = [];
    this.lastScriptSig = '';
    this.redrawScript();
  }

  /**
   * Pine `fill(plot1, plot2, color=…)` bands. Times align with OHLCV bars;
   * upper/lower are price series (null = gap). Empty list clears.
   */
  setPlotFills(
    fills: Array<{
      name: string;
      times: number[];
      upper: (number | null)[];
      lower: (number | null)[];
      colors?: (string | null)[];
      color?: string;
    }>,
  ) {
    this.plotFills = (fills || []).map((f) => ({
      name: f.name,
      times: f.times,
      upper: f.upper,
      lower: f.lower,
      colors: f.colors || [],
      color: f.color || 'rgba(255, 82, 82, 0.2)',
    }));
    this.redrawFills();
  }

  clearPlotFills() {
    if (!this.plotFills.length) return;
    this.plotFills = [];
    this.redrawFills();
  }

  /** Shallow copy of current user drawings. */
  getDrawings(): Drawing[] {
    return this.drawings.slice();
  }

  /** Remove all user drawings, clear selection/draft, emit. */
  clearAll() {
    this.drawings = [];
    this.draft = null;
    this.drag = null;
    this.clearDraftDom();
    this.setSelectedId(null);
    this.emit();
    // setSelectedId may no-op when already null — always clear user group
    this.redrawUser();
  }

  /**
   * Delete the selected user drawing if unlocked.
   * Respects `lockAll` and per-drawing `locked` / `meta.locked`.
   */
  deleteSelected() {
    if (!this.selectedId) return;
    const cur = this.drawings.find((d) => d.id === this.selectedId);
    if (cur && (this.lockAll || resolveDrawingStyle(cur).locked)) return;
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
    this.setSelectedId(null);
    this.emit();
    // Selection clear already re-painted user group
  }

  /**
   * After a successful place: if stay-in-mode is off, switch to cursor and notify store.
   * Does not implement undo/history.
   */
  private afterPlace() {
    if (!this.stayInMode) {
      this.setTool('cursor');
      this.onToolChange?.('cursor');
    }
  }

  private defaultColor(tool: DrawingToolId): string {
    if (tool === 'measure') return DRAWING_COLORS.measure;
    return this.stylePrefs.color || DRAWING_COLORS.default;
  }

  /**
   * Dual-write create: set legacy flat fields (`color`, `lineWidth`, …) and nested
   * `style` so both `resolveDrawingStyle` paths and older consumers work.
   * Also stamps `meta.symbol` from {@link setSymbolProvider} when available.
   */
  private applyCreateStyle<T extends Drawing>(d: T): T {
    const fallback = this.defaultColor(d.kind);
    const color = sanitizeStrokeColor(d.color || fallback, fallback);
    const sym = String(this.symbolProvider?.() || '')
      .trim()
      .toUpperCase();
    const meta: NonNullable<Drawing['meta']> = { ...(d.meta || {}) };
    if (sym) {
      meta.symbol = sym;
    } else if (meta.symbol != null) {
      const s = String(meta.symbol).trim().toUpperCase();
      if (s) meta.symbol = s;
      else delete meta.symbol;
    }
    return {
      ...d,
      id: d.id || uid(),
      color,
      lineWidth: d.lineWidth ?? this.stylePrefs.width,
      lineStyle: d.lineStyle ?? this.stylePrefs.lineStyle,
      fillOpacity: d.fillOpacity ?? this.stylePrefs.fillOpacity,
      style: {
        color,
        width: d.lineWidth ?? this.stylePrefs.width,
        lineStyle: d.lineStyle ?? this.stylePrefs.lineStyle,
        opacity: 1,
      },
      meta: Object.keys(meta).length ? meta : d.meta,
    };
  }

  /** Tear down listeners, SVG, and active singleton if this instance. */
  destroy() {
    if (this.redrawRaf) {
      cancelAnimationFrame(this.redrawRaf);
      this.redrawRaf = 0;
    }
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.ro?.disconnect();
    this.svg.remove();
    if (activeLayer === this) activeLayer = null;
  }

  private emit() {
    this.onChange?.(this.drawings.slice());
  }

  /** Wire pointer/keyboard, range/crosshair re-paint, and host ResizeObserver. */
  private bindEvents() {
    const onClick = (e: MouseEvent) => this.handleClick(e);
    const onMove = (e: MouseEvent) => this.handleMove(e);
    const onDown = (e: PointerEvent) => this.handlePointerDown(e);
    const onUp = (e: PointerEvent) => this.handlePointerUp(e);
    const onKey = (e: KeyboardEvent) => this.handleKey(e);
    const onCtx = (e: Event) => {
      // Right-click cancels an in-progress draft while a place tool is active
      if (this.tool !== 'cursor') {
        e.preventDefault();
        this.draft = null;
        this.clearDraftDom();
      }
    };

    this.svg.addEventListener('click', onClick);
    this.svg.addEventListener('dblclick', this.handleDblClick);
    this.svg.addEventListener('pointerdown', onDown);
    this.svg.addEventListener('pointermove', onMove);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this.svg.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKey);
    this.unsubs.push(() => this.svg.removeEventListener('click', onClick));
    this.unsubs.push(() => this.svg.removeEventListener('dblclick', this.handleDblClick));
    this.unsubs.push(() => this.svg.removeEventListener('pointerdown', onDown));
    this.unsubs.push(() => this.svg.removeEventListener('pointermove', onMove));
    this.unsubs.push(() => window.removeEventListener('pointermove', onMove));
    this.unsubs.push(() => window.removeEventListener('pointerup', onUp));
    this.unsubs.push(() => this.svg.removeEventListener('contextmenu', onCtx));
    this.unsubs.push(() => window.removeEventListener('keydown', onKey));

    // Pan/zoom only — do NOT redraw on crosshair (that rebuilt pine SVG every
    // mousemove and looked like hide/show flicker).
    const subRange = () => this.scheduleRedraw();
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(subRange);
    this.unsubs.push(() => {
      try {
        this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(subRange);
      } catch {
        /* ignore */
      }
    });

    this.ro = new ResizeObserver(() => {
      this.scheduleRedraw();
    });
    this.ro.observe(this.host);
  }

  /** Coalesce high-frequency scale/resize events to one paint per frame. */
  private scheduleRedraw() {
    if (this.redrawRaf) return;
    this.redrawRaf = requestAnimationFrame(() => {
      this.redrawRaf = 0;
      // Skip work while the host is hidden (tab/panel collapsed)
      if (this.host.clientWidth <= 0 || this.host.clientHeight <= 0) return;
      this.redraw();
    });
  }

  /** Drop draft SVG without touching gDraw/gScript (avoids full-layer thrash). */
  private clearDraftDom() {
    try {
      this.gDraft.replaceChildren();
    } catch {
      this.gDraft.innerHTML = '';
    }
  }

  private syncSize() {
    const r = this.host.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    if (!isFiniteNum(w) || !isFiniteNum(h) || w < 0 || h < 0) return;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.svg.setAttribute('width', String(w));
    this.svg.setAttribute('height', String(h));
  }

  /**
   * Map client pointer → series `(time, price)`, then optionally magnet-snap to bars.
   * Returns null outside valid scales. Past the last bar, extrapolates time via
   * logical index (up to {@link DRAWING_FUTURE_BARS}). Strong magnet uses a huge
   * pixel tolerance so snap always applies when bars exist; weak uses 10px.
   */
  private clientToPoint(e: MouseEvent): Point | null {
    try {
      const rect = this.svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
      const price = this.series.coordinateToPrice(y);
      if (price == null || !Number.isFinite(price)) return null;

      let t: number | null = null;
      const rawTime = this.chart.timeScale().coordinateToTime(x);
      if (rawTime != null) {
        t =
          typeof rawTime === 'number'
            ? rawTime
            : (rawTime as { timestamp?: number }).timestamp ?? null;
      }
      // Empty right margin / future: coordinateToTime is null — use logical × period
      const bars = this.barsProvider?.() ?? null;
      if ((t == null || !Number.isFinite(t)) && bars?.length) {
        const logical = this.chart.timeScale().coordinateToLogical(x);
        if (logical != null && Number.isFinite(logical)) {
          this.ensureRightOffsetForLogical(logical, bars.length);
          t = logicalIndexToUnixTime(logical, bars, DRAWING_FUTURE_BARS);
        }
      }
      if (t == null || !Number.isFinite(t)) return null;
      if (bars?.length) t = clampTimeToFutureHorizon(t, bars, DRAWING_FUTURE_BARS);
      if (t == null || !Number.isFinite(t)) return null;

      const raw: Point = { time: t as number, price };
      // Magnet only snaps onto real bars — don't pull future anchors back to last OHLC
      if (this.magnet === 'off' || !bars?.length) return raw;
      const lastT = bars[bars.length - 1]!.time;
      if (raw.time > lastT) return raw;
      const snapped = snapToBars({
        bars,
        raw,
        rawXY: { x, y },
        priceToY: (p) => {
          try {
            return this.series.priceToCoordinate(p);
          } catch {
            return null;
          }
        },
        mode: this.magnet,
        pixelTol: this.magnet === 'strong' ? 9999 : 10,
      });
      return snapped && isFinitePoint(snapped) ? snapped : raw;
    } catch {
      return null;
    }
  }

  /** Last OHLCV bar time from {@link barsProvider}, if available. */
  private lastBarTime(): number | null {
    const bars = this.barsProvider?.();
    if (!bars?.length) return null;
    const t = bars[bars.length - 1]!.time;
    return Number.isFinite(t) ? t : null;
  }

  /**
   * Grow LWC right whitespace so future logical indices stay mappable
   * (up to {@link DRAWING_FUTURE_BARS}).
   */
  private ensureRightOffsetForLogical(logical: number, barCount: number) {
    if (!Number.isFinite(logical) || barCount <= 0) return;
    const lastIdx = barCount - 1;
    if (logical <= lastIdx) return;
    const need = Math.min(
      DRAWING_FUTURE_BARS,
      Math.ceil(logical - lastIdx) + 2,
    );
    try {
      const cur = this.chart.timeScale().options().rightOffset ?? 0;
      if (need > cur) {
        this.chart.timeScale().applyOptions({ rightOffset: need });
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Time → pixel X (unix seconds first, then future logical extrapolation,
   * then bare bar_index). Used by {@link toXY} and vline hit-test.
   */
  private timeToX(time: number, opts?: { clampToLastBar?: boolean }): number | null {
    if (!Number.isFinite(time)) return null;
    try {
      const bars = this.barsProvider?.() ?? null;
      let t = time;
      if (opts?.clampToLastBar) {
        t = clampTimeToLastBar(t, this.lastBarTime());
      }
      if (!Number.isFinite(t)) return null;
      let x: number | null = null;
      try {
        x = this.chart.timeScale().timeToCoordinate(t as UTCTimestamp);
      } catch {
        x = null;
      }
      if (x == null && bars?.length) {
        const logical = unixTimeToLogicalIndex(t, bars, DRAWING_FUTURE_BARS);
        if (logical != null) {
          this.ensureRightOffsetForLogical(logical, bars.length);
          try {
            x = this.chart.timeScale().logicalToCoordinate(logical as never);
          } catch {
            x = null;
          }
        }
      }
      if (x == null) {
        try {
          x = this.chart.timeScale().logicalToCoordinate(t as never);
        } catch {
          x = null;
        }
      }
      return isFiniteNum(x) ? x : null;
    } catch {
      return null;
    }
  }

  /**
   * Map series point → SVG pixel coords.
   * Prefer unix-second time; if unmapped (including future times past last bar),
   * extrapolate via logical index. Compile-mode `bar_index` falls back last.
   *
   * User drawings may sit up to {@link DRAWING_FUTURE_BARS} past series end
   * (default). Pass `clampToLastBar: true` for Pine script paint so `timenow`
   * labels stay on the last bar.
   */
  private toXY(
    p: Point,
    opts?: { clampToLastBar?: boolean },
  ): { x: number; y: number } | null {
    if (!p || !isFinitePoint(p)) return null;
    try {
      const x = this.timeToX(p.time, opts);
      const y = this.series.priceToCoordinate(p.price);
      if (x == null || y == null || !isFiniteNum(x) || !isFiniteNum(y)) return null;
      return { x, y };
    } catch {
      return null;
    }
  }

  /** Escape cancels draft/selection; Delete/Backspace removes selected (not from inputs). */
  private handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.draft = null;
      this.clearDraftDom();
      this.setSelectedId(null);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId) {
      // Don't steal from inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      this.deleteSelected();
    }
  }

  /**
   * Cursor-only drag start. `lockAll` blocks entirely; per-drawing locked still
   * selects but does not begin a drag.
   */
  private handlePointerDown(e: PointerEvent) {
    if (this.tool !== 'cursor') return;
    if (this.lockAll) return;
    const start = this.clientToPoint(e);
    if (!start || !isFinitePoint(start)) return;
    const handle = this.hitTestHandle(e);
    const hit = handle?.id ?? this.hitTest(e);
    if (!hit) return;
    const origin = this.drawings.find((d) => d.id === hit);
    if (!origin) return;
    if (resolveDrawingStyle(origin).locked) {
      this.setSelectedId(hit);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.setSelectedId(hit);
    let cloned: Drawing;
    try {
      cloned = structuredClone(origin) as Drawing;
    } catch {
      cloned = { ...origin } as Drawing;
    }
    this.drag = {
      id: hit,
      start,
      origin: cloned,
      mode: handle?.mode ?? 'move',
    };
    this.didDrag = false;
    this.svg.style.pointerEvents = 'auto';
    try {
      this.svg.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore capture failures */
    }
    // setSelectedId already re-painted user group
  }

  private handlePointerUp(e: PointerEvent) {
    if (!this.drag) return;
    try {
      this.svg.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.didDrag) this.emit();
    this.drag = null;
    this.svg.style.pointerEvents = this.tool === 'cursor' ? 'none' : 'auto';
    // Geometry may have changed; user layer only (scales unchanged)
    this.redrawUser();
  }

  /**
   * Place tools: one-click / multi-click draft / eraser.
   * Cursor: hit-test select. Post-drag clicks are swallowed via `didDrag`.
   */
  private handleClick(e: MouseEvent) {
    if (this.didDrag) {
      this.didDrag = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.tool === 'cursor') {
      // Hit-test select (shapes have pointer-events; empty area doesn't fire)
      const hit = this.hitTest(e);
      this.setSelectedId(hit);
      return;
    }

    if (this.tool === 'eraser') {
      if (this.lockAll) return;
      const hit = this.hitTest(e);
      if (!hit) return;
      const target = this.drawings.find((d) => d.id === hit);
      if (target && resolveDrawingStyle(target).locked) return;
      this.drawings = this.drawings.filter((d) => d.id !== hit);
      if (this.selectedId === hit) this.setSelectedId(null);
      else this.redrawUser();
      this.emit();
      return;
    }

    const pt = this.clientToPoint(e);
    if (!pt || !isFinitePoint(pt)) return;

    if (this.tool === 'hline') {
      this.drawings.push(
        this.applyCreateStyle({
          id: uid(),
          kind: 'hline',
          price: pt.price,
          color: this.defaultColor('hline'),
        }),
      );
      this.emit();
      this.redrawUser();
      this.afterPlace();
      return;
    }

    if (this.tool === 'vline') {
      this.drawings.push(
        this.applyCreateStyle({
          id: uid(),
          kind: 'vline',
          time: pt.time,
          color: this.defaultColor('vline'),
        }),
      );
      this.emit();
      this.redrawUser();
      this.afterPlace();
      return;
    }

    if (this.tool === 'text') {
      const labelText = window.prompt('Label text', 'Note');
      if (labelText == null) return;
      const text = sanitizeDrawingText(labelText);
      if (!text) return;
      this.drawings.push(
        this.applyCreateStyle({
          id: uid(),
          kind: 'text',
          p1: pt,
          text,
          color: this.defaultColor('text'),
        }),
      );
      this.emit();
      this.redrawUser();
      this.afterPlace();
      return;
    }

    // Registered 1-point tools (e.g. priceLabel)
    const handler = getToolHandler(this.tool);
    const arity = toolArity(this.tool);
    if (arity === 1 && handler?.create) {
      const created = handler.create([pt], this.defaultColor(this.tool));
      if (created) {
        created.id = uid();
        this.drawings.push(this.applyCreateStyle(created));
        this.emit();
        this.redrawUser();
        this.afterPlace();
      }
      return;
    }

    // Multi-click tools: 2 / 3 / n
    if (needsTwoPoints(this.tool) || needsThreePoints(this.tool) || needsNPoints(this.tool)) {
      if (!this.draft || this.draft.tool !== this.tool) {
        this.draft = { tool: this.tool, points: [pt] };
        this.renderDraft(pt);
        return;
      }
      // Ignore near-duplicate anchors (double-click bounce / same-pixel re-click)
      // so trend/ray/etc. never commit a zero-length segment as the "second line".
      const prev = this.draft.points[this.draft.points.length - 1];
      if (prev && anchorsTooClose(prev, pt)) {
        this.renderDraft(pt);
        return;
      }
      this.draft.points.push(pt);
      // Drop any non-finite anchors that may have snuck into the draft
      this.draft.points = sanitizePoints(this.draft.points);
      const need = toolArity(this.tool);
      const n = this.draft.points.length;

      // Open-ended: keep collecting until double-click (even when >= minPoints)
      if (need === 'n') {
        this.renderDraft(pt);
        return;
      }

      const target = need === 3 ? 3 : 2;
      if (n < target) {
        this.renderDraft(pt);
        return;
      }

      // Final guard: first vs last must be distinct for 2-pt tools
      if (target === 2 && n >= 2) {
        const a = this.draft.points[0]!;
        const b = this.draft.points[n - 1]!;
        if (anchorsTooClose(a, b)) {
          this.draft.points = [a];
          this.renderDraft(pt);
          return;
        }
      }

      this.commitDraftPoints(this.draft.points);
    }
  }

  /** Finish open-ended polyline/path on double-click. */
  private handleDblClick = (e: MouseEvent) => {
    if (!this.draft || !needsNPoints(this.draft.tool)) return;
    e.preventDefault();
    e.stopPropagation();
    const handler = getToolHandler(this.draft.tool);
    const minPts = Math.max(handler?.minPoints ?? 2, 2);
    const pts = sanitizePoints(this.draft.points);
    if (pts.length < minPts) {
      this.draft = null;
      this.clearDraftDom();
      return;
    }
    this.commitDraftPoints(pts);
  };

  private commitDraftPoints(points: Point[]) {
    // Snapshot tool before clearing draft (double-free safe: draft null once)
    const tool = (this.draft?.tool || this.tool) as DrawingToolId;
    this.draft = null;
    this.clearDraftDom();
    const clean = sanitizePoints(points);
    const handler = getToolHandler(tool);
    const arity = toolArity(tool);
    const minPts =
      handler?.minPoints ??
      (arity === 3 ? 3 : arity === 1 ? 1 : 2);
    if (clean.length < minPts) return;
    // Refuse zero-length 2-pt geometry (would paint as a single handle)
    if (minPts >= 2 && anchorsTooClose(clean[0]!, clean[clean.length - 1]!)) return;

    let drawing: Drawing | null = null;
    if (handler?.create) {
      drawing = handler.create(clean, this.defaultColor(tool));
    } else if (clean.length >= 2 && needsTwoPoints(tool)) {
      const p1 = { time: clean[0]!.time, price: clean[0]!.price };
      const p2 = { time: clean[1]!.time, price: clean[1]!.price };
      // Dual-shape: p1/p2 for legacy paint + points[] for normalize/hydrate
      drawing = {
        id: uid(),
        kind: tool as TwoPointKind,
        p1,
        p2,
        points: [p1, p2],
        color: this.defaultColor(tool),
      } as Drawing;
    }
    // create() may return null for invalid geometry — never push empty shells
    if (!drawing) return;
    drawing.id = drawing.id || uid();
    this.drawings.push(this.applyCreateStyle(drawing));
    this.emit();
    this.redrawUser();
    this.afterPlace();
  }

  /** Drag-move/resize active drawing, or update two-point draft preview. */
  private handleMove(e: MouseEvent) {
    if (this.drag) {
      const pt = this.clientToPoint(e);
      if (!pt || !isFinitePoint(pt)) return;
      const dTime = pt.time - this.drag.start.time;
      const dPrice = pt.price - this.drag.start.price;
      if (!Number.isFinite(dTime) || !Number.isFinite(dPrice)) return;
      if (Math.abs(dTime) > 0 || Math.abs(dPrice) > 1e-12) this.didDrag = true;
      let next: Drawing;
      if (this.drag.mode === 'move') {
        next = shiftDrawing(this.drag.origin, dTime, dPrice);
      } else {
        next = resizeDrawing(this.drag.origin, this.drag.mode, pt);
      }
      const idx = this.drawings.findIndex((d) => d.id === this.drag!.id);
      if (idx >= 0) {
        this.drawings[idx] = next;
        // Drag is user-only; never rebuild script/fills every mousemove
        this.redrawUser();
      }
      return;
    }
    if (!this.draft?.points?.length) return;
    const pt = this.clientToPoint(e);
    if (!pt || !isFinitePoint(pt)) return;
    this.renderDraft(pt);
  }

  private renderDraft(hover: Point) {
    this.clearDraftDom();
    if (!this.draft?.points?.length) return;
    if (!isFinitePoint(hover)) return;
    // Sanitize anchors once for paint (hover appended after)
    const anchors = sanitizePoints(this.draft.points);
    if (!anchors.length) return;
    const points = [...anchors, hover];
    const handler = getToolHandler(this.draft.tool);
    try {
      const ctx = this.makeViewCtx(this.gDraft, DRAWING_COLORS.muted, 1.25, undefined, 0.1, true);
      if (handler?.paintDraft) {
        handler.paintDraft(points, ctx);
        return;
      }
      if (handler?.create && points.length >= (typeof handler.arity === 'number' ? handler.arity : 2)) {
        const d = handler.create(points, DRAWING_COLORS.muted);
        if (d) {
          d.id = 'draft';
          this.paintDrawing(this.gDraft, d, true);
          return;
        }
      }
      // Fallback: two-point line preview
      if (points.length >= 2) {
        const d: Drawing = {
          id: 'draft',
          kind: (needsTwoPoints(this.draft.tool) ? this.draft.tool : 'trend') as TwoPointKind,
          p1: points[0]!,
          p2: points[points.length - 1]!,
          color: DRAWING_COLORS.muted,
        } as Drawing;
        this.paintDrawing(this.gDraft, d, true);
      }
    } catch (err) {
      console.warn('[drawings] renderDraft failed', err);
      this.clearDraftDom();
    }
  }

  /** Build paint helpers bound to a target SVG group. */
  private makeViewCtx(
    g: SVGGElement,
    stroke: string,
    sw: number,
    dash: string | undefined,
    fillOpacity: number,
    selected: boolean,
  ): ToolViewCtx {
    return {
      toXY: (p) => this.toXY(p),
      timeToX: (t) => this.timeToX(t),
      priceToY: (price) => {
        if (!Number.isFinite(price)) return null;
        try {
          const y = this.series.priceToCoordinate(price);
          return isFiniteNum(y) ? y : null;
        } catch {
          return null;
        }
      },
      width: this.host.clientWidth || 0,
      height: this.host.clientHeight || 0,
      el: (name, attrs) => el(g, name, attrs),
      line: (x1, y1, x2, y2, s, w, dsh, pe) => line(g, x1, y1, x2, y2, s, w, dsh, pe),
      circle: (x, y, r, s, filled) => circle(g, x, y, r, s, filled),
      label: (x, y, text, fill, size, anchor) =>
        label(g, x, y, text, fill, size, anchor || 'start'),
      stroke,
      strokeWidth: sw,
      dash,
      fillOpacity,
      selected,
      barIndexApprox: (time) => barIndexApprox(this.chart, time),
    };
  }

  /** Endpoint handle hit for the selected drawing (move uses body hit-test). */
  private hitTestHandle(e: MouseEvent): { id: string; mode: DragMode } | null {
    if (!this.selectedId) return null;
    const d = this.drawings.find((x) => x.id === this.selectedId);
    if (!d) return null;
    try {
      const rect = this.svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
      const tol = 10;
      if (d.kind === 'hline' || d.kind === 'vline') {
        // No endpoint handles beyond body move
        return null;
      }
      if (d.kind === 'text' || d.kind === 'priceLabel') {
        if (!d.p1 || !isFinitePoint(d.p1)) return null;
        const c = this.toXY(d.p1);
        if (c && Math.hypot(x - c.x, y - c.y) <= tol) return { id: d.id, mode: 'p1' };
        return null;
      }
      if ('points' in d && Array.isArray(d.points) && d.points[0] && d.points[1]) {
        const a = isFinitePoint(d.points[0]) ? this.toXY(d.points[0]) : null;
        const b = isFinitePoint(d.points[1]) ? this.toXY(d.points[1]) : null;
        if (a && Math.hypot(x - a.x, y - a.y) <= tol) return { id: d.id, mode: 'p1' };
        if (b && Math.hypot(x - b.x, y - b.y) <= tol) return { id: d.id, mode: 'p2' };
        return null;
      }
      if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return null;
      if (!isFinitePoint(d.p1) || !isFinitePoint(d.p2)) return null;
      const a = this.toXY(d.p1);
      const b = this.toXY(d.p2);
      if (a && Math.hypot(x - a.x, y - a.y) <= tol) return { id: d.id, mode: 'p1' };
      if (b && Math.hypot(x - b.x, y - b.y) <= tol) return { id: d.id, mode: 'p2' };
      return null;
    } catch {
      return null;
    }
  }

  /** Topmost user drawing under the pointer (reverse paint order). */
  private hitTest(e: MouseEvent): string | null {
    try {
      const rect = this.svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!isFiniteNum(x) || !isFiniteNum(y)) return null;
      // Reverse order (topmost last drawn)
      for (let i = this.drawings.length - 1; i >= 0; i--) {
        const d = this.drawings[i]!;
        if (this.nearDrawing(d, x, y, 8)) return d.id;
      }
      return null;
    } catch {
      return null;
    }
  }

  private nearDrawing(d: Drawing, x: number, y: number, tol: number): boolean {
    if (!isFiniteNum(x) || !isFiniteNum(y) || !isFiniteNum(tol)) return false;
    try {
      return this.nearDrawingInner(d, x, y, tol);
    } catch (err) {
      console.warn('[drawings] nearDrawing failed', d?.kind, d?.id, err);
      return false;
    }
  }

  private nearDrawingInner(d: Drawing, x: number, y: number, tol: number): boolean {
    const handler = getToolHandler(d.kind);
    if (handler?.hit) {
      const ctx: ToolHitCtx = {
        x,
        y,
        tol,
        toXY: (p) => this.toXY(p),
        timeToX: (t) => this.timeToX(t),
        priceToY: (price) => this.priceToYSafe(price),
        width: this.host.clientWidth,
        height: this.host.clientHeight,
      };
      return handler.hit(d, ctx);
    }
    if (d.kind === 'hline') {
      if (!Number.isFinite(d.price)) return false;
      const yy = this.priceToYSafe(d.price);
      if (yy == null) return false;
      return Math.abs(y - yy) <= tol;
    }
    if (d.kind === 'vline') {
      // Future vlines: same X projection as paint (logical extrapolation)
      if (!Number.isFinite(d.time)) return false;
      const xx = this.timeToX(d.time);
      if (xx == null) return false;
      return Math.abs(x - xx) <= tol;
    }
    if (d.kind === 'text' || d.kind === 'priceLabel') {
      if (!d.p1 || !isFinitePoint(d.p1)) return false;
      const c = this.toXY(d.p1);
      if (!c) return false;
      return Math.hypot(x - c.x, y - c.y) <= 16;
    }
    if (!('p1' in d) || !('p2' in d) || !d.p1 || !d.p2) return false;
    if (!isFinitePoint(d.p1) || !isFinitePoint(d.p2)) return false;
    const a = this.toXY(d.p1);
    const b = this.toXY(d.p2);
    if (!a || !b) return false;
    if (d.kind === 'rect' || d.kind === 'ellipse') {
      const minX = Math.min(a.x, b.x) - tol;
      const maxX = Math.max(a.x, b.x) + tol;
      const minY = Math.min(a.y, b.y) - tol;
      const maxY = Math.max(a.y, b.y) + tol;
      const inside = x >= minX && x <= maxX && y >= minY && y <= maxY;
      if (d.kind === 'ellipse') {
        // Approximate edge hit via normalized ellipse equation
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rx = Math.max(1, Math.abs(b.x - a.x) / 2);
        const ry = Math.max(1, Math.abs(b.y - a.y) / 2);
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const r2 = nx * nx + ny * ny;
        return Math.abs(r2 - 1) <= tol / Math.min(rx, ry) + 0.15 || (inside && r2 <= 1.05);
      }
      // Edge hit preferred for rect
      const onEdge =
        Math.abs(x - minX) <= tol ||
        Math.abs(x - maxX) <= tol ||
        Math.abs(y - minY) <= tol ||
        Math.abs(y - maxY) <= tol;
      return inside && onEdge;
    }
    if (d.kind === 'ray' || d.kind === 'extend') {
      // Hit full painted ray/extend (not just p1–p2 segment)
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return Math.hypot(x - a.x, y - a.y) <= tol;
      const scale = 5000 / len;
      if (d.kind === 'ray') {
        return distToSegment(x, y, a.x, a.y, a.x + dx * scale, a.y + dy * scale) <= tol;
      }
      return (
        distToSegment(x, y, a.x - dx * scale, a.y - dy * scale, a.x + dx * scale, a.y + dy * scale) <=
        tol
      );
    }
    return distToSegment(x, y, a.x, a.y, b.x, b.y) <= tol;
  }

  private redraw() {
    this.syncSize();
    this.redrawFillsInner();
    this.redrawScriptInner();
    this.redrawUserInner();
  }

  /** Re-paint script group only (after setScriptDrawings). */
  private redrawScript() {
    this.syncSize();
    this.redrawScriptInner();
  }

  private redrawFills() {
    this.syncSize();
    this.redrawFillsInner();
  }

  private redrawUser() {
    this.syncSize();
    this.redrawUserInner();
  }

  private redrawFillsInner() {
    if (!this.plotFills.length) {
      this.gFill.replaceChildren();
      return;
    }
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const fill of this.plotFills) {
      try {
        this.paintPlotFill(tmp, fill);
      } catch (err) {
        console.warn('[drawings] paintPlotFill failed', err);
      }
    }
    this.gFill.replaceChildren(...Array.from(tmp.childNodes));
  }

  private redrawScriptInner() {
    if (!this.scriptDrawings.length) {
      this.gScript.replaceChildren();
      return;
    }
    // Build off-DOM then atomically replace children on the stable <g>.
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const sd of this.scriptDrawings) {
      this.paintScriptDrawing(tmp, sd);
    }
    this.gScript.replaceChildren(...Array.from(tmp.childNodes));
  }

  /**
   * Paint a filled polygon between two plot edges (Pine fill).
   * Walks upper L→R then lower R→L; skips bars where either edge is null.
   */
  private paintPlotFill(
    g: SVGGElement,
    fill: {
      name: string;
      times: number[];
      upper: (number | null)[];
      lower: (number | null)[];
      colors: (string | null)[];
      color: string;
    },
  ) {
    const n = Math.min(fill.times.length, fill.upper.length, fill.lower.length);
    if (n < 2) return;
    // Segment into contiguous runs of finite pairs so na gaps split the band.
    let runStart = -1;
    const flush = (from: number, to: number) => {
      if (to - from < 2) return; // need ≥2 samples (to exclusive)
      const upperPts: { x: number; y: number }[] = [];
      const lowerPts: { x: number; y: number }[] = [];
      for (let i = from; i < to; i++) {
        const t = fill.times[i]!;
        const u = fill.upper[i]!;
        const l = fill.lower[i]!;
        if (!Number.isFinite(u) || !Number.isFinite(l)) continue;
        const a = this.toXY({ time: t, price: u });
        const b = this.toXY({ time: t, price: l });
        if (!a || !b) continue;
        upperPts.push(a);
        lowerPts.push(b);
      }
      if (upperPts.length < 2) return;
      let d = `M ${upperPts[0]!.x} ${upperPts[0]!.y}`;
      for (let i = 1; i < upperPts.length; i++) d += ` L ${upperPts[i]!.x} ${upperPts[i]!.y}`;
      for (let i = lowerPts.length - 1; i >= 0; i--) d += ` L ${lowerPts[i]!.x} ${lowerPts[i]!.y}`;
      d += ' Z';
      const rawC =
        (fill.colors[from] && String(fill.colors[from])) ||
        fill.color ||
        'rgba(255, 82, 82, 0.2)';
      const c = sanitizeStrokeColor(rawC, 'rgba(255, 82, 82, 0.2)');
      el(g, 'path', {
        d,
        fill: c,
        stroke: 'none',
        'pointer-events': 'none',
        'data-fill': String(fill.name || ''),
      });
    };
    for (let i = 0; i < n; i++) {
      const ok =
        fill.upper[i] != null &&
        fill.lower[i] != null &&
        Number.isFinite(fill.times[i]!) &&
        Number.isFinite(fill.upper[i] as number) &&
        Number.isFinite(fill.lower[i] as number);
      if (ok) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        flush(runStart, i);
        runStart = -1;
      }
    }
    if (runStart >= 0) flush(runStart, n);
  }

  private redrawUserInner() {
    if (!this.drawings.length) {
      this.gDraw.replaceChildren();
      return;
    }
    // Hidden mode with nothing selected → empty user group
    if (this.hideDrawings && !this.selectedId) {
      this.gDraw.replaceChildren();
      return;
    }
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const d of this.drawings) {
      this.paintDrawing(tmp, d, d.id === this.selectedId);
    }
    this.gDraw.replaceChildren(...Array.from(tmp.childNodes));
  }

  /** Script (Pine) paint uses last-bar clamp for future wall-clock times. */
  private toXYScript(p: Point): { x: number; y: number } | null {
    return this.toXY(p, { clampToLastBar: true });
  }

  /** Safe price → Y for script paint (guards non-finite + LWC throws). */
  private priceToYSafe(price: number): number | null {
    if (!Number.isFinite(price)) return null;
    try {
      const y = this.series.priceToCoordinate(price);
      return isFiniteNum(y) ? y : null;
    } catch {
      return null;
    }
  }

  /** View-only paint for Pine line/box/label/polyline (`pointer-events: none`). */
  private paintScriptDrawing(g: SVGGElement, d: ScriptDrawing) {
    try {
      this.paintScriptDrawingInner(g, d);
    } catch (err) {
      console.warn('[drawings] paintScriptDrawing failed', d?.type, d?.id, err);
    }
  }

  private paintScriptDrawingInner(g: SVGGElement, d: ScriptDrawing) {
    const pe = 'none'; // script drawings are view-only
    const stroke = sanitizeStrokeColor(d.color, DRAWING_COLORS.default);
    const sw = clampStrokeWidth(d.width, 1.5);
    if (d.type === 'polyline' && d.points?.length) {
      const coords: { x: number; y: number }[] = [];
      for (const p of d.points) {
        if (!p || !Number.isFinite(p.time) || !Number.isFinite(p.price)) continue;
        const c = this.toXYScript({ time: p.time, price: p.price });
        if (c) coords.push(c);
      }
      if (coords.length < 2) return;
      let dPath = `M ${coords[0]!.x} ${coords[0]!.y}`;
      for (let i = 1; i < coords.length; i++) dPath += ` L ${coords[i]!.x} ${coords[i]!.y}`;
      if (d.closed) dPath += ' Z';
      const dash =
        d.style === 'dashed' ? '4 3' : d.style === 'dotted' ? '1 3' : undefined;
      const fill = d.closed
        ? sanitizeStrokeColor(d.bgcolor || 'rgba(147,159,255,0.06)', 'rgba(147,159,255,0.06)')
        : 'none';
      el(g, 'path', {
        d: dPath,
        fill,
        stroke,
        'stroke-width': String(sw),
        'stroke-linejoin': 'round',
        'pointer-events': pe,
        ...(dash ? { 'stroke-dasharray': dash } : {}),
      });
      return;
    }
    if (
      d.type === 'linefill' &&
      d.t2 != null &&
      d.p2 != null &&
      d.t3 != null &&
      d.p3 != null &&
      d.t4 != null &&
      d.p4 != null
    ) {
      // Quad between two lines: line1 (t1,p1→t2,p2) then reverse line2 (t4,p4→t3,p3)
      const corners = [
        { time: d.t1, price: d.p1 },
        { time: d.t2, price: d.p2 },
        { time: d.t4, price: d.p4 },
        { time: d.t3, price: d.p3 },
      ];
      const coords: { x: number; y: number }[] = [];
      for (const p of corners) {
        if (!Number.isFinite(p.time) || !Number.isFinite(p.price)) continue;
        const c = this.toXYScript({ time: p.time, price: p.price });
        if (c) coords.push(c);
      }
      if (coords.length < 3) return;
      let dPath = `M ${coords[0]!.x} ${coords[0]!.y}`;
      for (let i = 1; i < coords.length; i++) dPath += ` L ${coords[i]!.x} ${coords[i]!.y}`;
      dPath += ' Z';
      el(g, 'path', {
        d: dPath,
        fill: sanitizeStrokeColor(
          d.bgcolor || d.color || 'rgba(147,159,255,0.15)',
          'rgba(147,159,255,0.15)',
        ),
        stroke: 'none',
        'pointer-events': pe,
      });
      return;
    }
    if (d.type === 'line' && d.t2 != null && d.p2 != null) {
      if (!Number.isFinite(d.t1) || !Number.isFinite(d.p1) || !Number.isFinite(d.t2) || !Number.isFinite(d.p2)) {
        return;
      }
      const ext = (d.extend || 'none').toLowerCase();
      const dash =
        d.style === 'dashed' ? '4 3' : d.style === 'dotted' ? '1 3' : undefined;
      // Pine hline → full-width price level (matches user hline tool)
      const isHline = d.id.startsWith('pine_hline_') || (d.p1 === d.p2 && ext === 'both');
      if (isHline && d.p1 === d.p2) {
        const y = this.priceToYSafe(d.p1);
        if (y != null) {
          line(g, 0, y, this.host.clientWidth, y, stroke, sw, dash, pe);
          if (d.text != null && d.text !== '') {
            label(g, 6, y - 4, sanitizeDrawingText(d.text), stroke, 10);
          }
          return;
        }
      }
      const a = this.toXYScript({ time: d.t1, price: d.p1 });
      const b = this.toXYScript({ time: d.t2, price: d.p2 });
      // Horizontal + extend with unmapped times → still paint a price level
      if ((!a || !b) && d.p1 === d.p2 && ext !== 'none') {
        const y = this.priceToYSafe(d.p1);
        if (y != null) {
          line(g, 0, y, this.host.clientWidth, y, stroke, sw, dash, pe);
          return;
        }
      }
      if (!a || !b) return;
      const { x1, y1, x2, y2 } = extendSegment(
        a.x,
        a.y,
        b.x,
        b.y,
        ext,
        this.host.clientWidth,
        this.host.clientHeight,
      );
      line(g, x1, y1, x2, y2, stroke, sw, dash, pe);
      return;
    }
    if (d.type === 'box' && d.t2 != null && d.p2 != null) {
      if (!Number.isFinite(d.t1) || !Number.isFinite(d.p1) || !Number.isFinite(d.t2) || !Number.isFinite(d.p2)) {
        return;
      }
      const a = this.toXYScript({ time: d.t1, price: d.p1 });
      const b = this.toXYScript({ time: d.t2, price: d.p2 });
      if (!a || !b) return;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const bw = Math.max(1, Math.abs(b.x - a.x));
      const bh = Math.max(1, Math.abs(b.y - a.y));
      el(g, 'rect', {
        x: String(x),
        y: String(y),
        width: String(bw),
        height: String(bh),
        fill: sanitizeStrokeColor(d.bgcolor || 'rgba(147,159,255,0.08)', 'rgba(147,159,255,0.08)'),
        stroke,
        'stroke-width': String(clampStrokeWidth(d.width, 1)),
        'pointer-events': pe,
      });
      if (d.text != null && d.text !== '') {
        label(g, x + 4, y + 12, sanitizeDrawingText(d.text), stroke, 10);
      }
      return;
    }
    if (d.type === 'label') {
      if (!Number.isFinite(d.t1) || !Number.isFinite(d.p1)) return;
      const c = this.toXYScript({ time: d.t1, price: d.p1 });
      if (!c) return;
      // Bubble
      const text = sanitizeDrawingText(d.text ?? '');
      const pad = 4;
      const tw = Math.max(24, text.length * 6.5 + pad * 2);
      const th = 16;
      el(g, 'rect', {
        x: String(c.x - tw / 2),
        y: String(c.y - th - 6),
        width: String(tw),
        height: String(th),
        rx: '2',
        fill: stroke,
        stroke: '#0a0b10',
        'stroke-width': '1',
        'pointer-events': pe,
      });
      label(
        g,
        c.x,
        c.y - 10,
        text,
        sanitizeStrokeColor(d.textcolor || '#0a0b10', '#0a0b10'),
        10,
        'middle',
      );
      circle(g, c.x, c.y, 2.5, stroke);
    }
  }

  /**
   * Paint one user drawing. When `hideDrawings` is on, non-selected shapes are skipped
   * (selected still renders so the user can find/edit them).
   */
  private paintDrawing(g: SVGGElement, d: Drawing, selected: boolean) {
    try {
      // One <g> per drawing so multi-line paint never shares attrs / hit targets
      const sub = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      if (d?.id) sub.setAttribute('data-drawing-id', String(d.id));
      if (d?.kind) sub.setAttribute('data-drawing-kind', String(d.kind));
      this.paintDrawingInner(sub, d, selected);
      if (sub.childNodes.length) g.appendChild(sub);
    } catch (err) {
      console.warn('[drawings] paintDrawing failed', d?.kind, d?.id, err);
    }
  }

  private paintDrawingInner(g: SVGGElement, d: Drawing, selected: boolean) {
    if (this.hideDrawings && !selected) return;
    // Per-drawing hide from Layers panel (`meta.hidden`)
    if (d.meta?.hidden && !selected) return;
    const st = resolveDrawingStyle(d);
    const stroke = sanitizeStrokeColor(st.color);
    // Selection uses slightly thicker stroke; dash comes from user lineStyle (not selection)
    const baseW = clampStrokeWidth(st.width, 1.5);
    const sw = selected ? baseW + 0.75 : baseW;
    const dash = strokeDashFor(st.lineStyle, false);

    if (d.kind === 'hline') {
      if (!Number.isFinite(d.price)) return;
      const y = this.priceToYSafe(d.price);
      if (y == null) return;
      const w = this.host.clientWidth;
      line(g, 0, y, w, y, stroke, sw, dash, 'stroke');
      label(g, 6, y - 4, d.price.toFixed(2), stroke);
      if (selected) {
        circle(g, w / 2, y, 5, stroke, true);
      }
      return;
    }

    if (d.kind === 'vline') {
      if (!Number.isFinite(d.time)) return;
      const x = this.timeToX(d.time);
      if (x == null) return;
      const h = this.host.clientHeight;
      line(g, x, 0, x, h, stroke, sw, dash, 'stroke');
      if (selected) {
        circle(g, x, h / 2, 5, stroke, true);
      }
      return;
    }

    if (d.kind === 'text') {
      if (!d.p1 || !isFinitePoint(d.p1)) return;
      const c = this.toXY(d.p1);
      if (!c) return;
      const text = sanitizeDrawingText(d.text ?? d.meta?.text ?? '');
      label(g, c.x + 4, c.y - 4, text, stroke, 12);
      circle(g, c.x, c.y, selected ? 5 : 3, stroke, selected);
      return;
    }

    // Extended / multipoint tools (channel, fibext, polyline, long/short, …)
    // Prefer registry paint even when p1/p2 are missing — handler owns geometry.
    {
      const handler = getToolHandler(d.kind);
      if (handler?.paint) {
        const ctx = this.makeViewCtx(g, stroke, sw, dash || undefined, st.fillOpacity, selected);
        handler.paint(d, ctx);
        return;
      }
    }

    const p1 = (d as { p1?: Point }).p1;
    const p2 = (d as { p2?: Point }).p2;
    if (!p1 || !p2 || !isFinitePoint(p1) || !isFinitePoint(p2)) return;
    const a = this.toXY(p1);
    const b = this.toXY(p2);
    if (!a || !b) return;

    if (d.kind === 'trend' || d.kind === 'measure' || d.kind === 'arrow') {
      line(g, a.x, a.y, b.x, b.y, stroke, sw, dash);
      if (d.kind === 'arrow') {
        paintArrowHead(g, a.x, a.y, b.x, b.y, stroke, Math.max(8, sw * 3));
      }
      circle(g, a.x, a.y, selected ? 5 : 3, stroke, selected);
      circle(g, b.x, b.y, selected ? 5 : 3, stroke, selected);
      if (d.kind === 'measure') {
        const bars = Math.abs(
          barIndexApprox(this.chart, p1.time) - barIndexApprox(this.chart, p2.time),
        );
        const dPrice = p2.price - p1.price;
        const pct = p1.price !== 0 ? (dPrice / p1.price) * 100 : 0;
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        label(
          g,
          midX + 6,
          midY - 6,
          `${dPrice >= 0 ? '+' : ''}${dPrice.toFixed(2)} (${pct.toFixed(2)}%) · ${bars} bars`,
          DRAWING_COLORS.measure,
          11,
        );
      }
      return;
    }

    if (d.kind === 'ray' || d.kind === 'extend') {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const w = this.host.clientWidth;
      const h = this.host.clientHeight;
      const len = Math.hypot(dx, dy);
      const scale = len > 0.001 ? 5000 / len : 1;
      let x1 = a.x;
      let y1 = a.y;
      let x2 = b.x;
      let y2 = b.y;
      if (d.kind === 'ray') {
        x2 = a.x + dx * scale;
        y2 = a.y + dy * scale;
      } else {
        // extend both directions through p1→p2
        x1 = a.x - dx * scale;
        y1 = a.y - dy * scale;
        x2 = a.x + dx * scale;
        y2 = a.y + dy * scale;
      }
      x1 = Math.max(-w, Math.min(2 * w, x1));
      y1 = Math.max(-h, Math.min(2 * h, y1));
      x2 = Math.max(-w, Math.min(2 * w, x2));
      y2 = Math.max(-h, Math.min(2 * h, y2));
      line(g, x1, y1, x2, y2, stroke, sw, dash);
      circle(g, a.x, a.y, selected ? 5 : 3, stroke, selected);
      circle(g, b.x, b.y, selected ? 5 : 3, stroke, selected);
      return;
    }

    if (d.kind === 'rect') {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x);
      const rh = Math.abs(b.y - a.y);
      const fo = Math.max(0, Math.min(1, st.fillOpacity));
      el(g, 'rect', {
        x: String(x),
        y: String(y),
        width: String(rw),
        height: String(rh),
        fill: stroke,
        'fill-opacity': String(fo),
        stroke,
        'stroke-width': String(sw),
        'pointer-events': 'all',
        ...(dash ? { 'stroke-dasharray': dash } : {}),
      });
      if (selected) {
        circle(g, a.x, a.y, 5, stroke, true);
        circle(g, b.x, b.y, 5, stroke, true);
      }
      return;
    }

    if (d.kind === 'ellipse') {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.max(1, Math.abs(b.x - a.x) / 2);
      const ry = Math.max(1, Math.abs(b.y - a.y) / 2);
      const fo = Math.max(0, Math.min(1, st.fillOpacity));
      el(g, 'ellipse', {
        cx: String(cx),
        cy: String(cy),
        rx: String(rx),
        ry: String(ry),
        fill: stroke,
        'fill-opacity': String(fo),
        stroke,
        'stroke-width': String(sw),
        'pointer-events': 'stroke',
        ...(dash ? { 'stroke-dasharray': dash } : {}),
      });
      if (selected) {
        circle(g, a.x, a.y, 5, stroke, true);
        circle(g, b.x, b.y, 5, stroke, true);
      }
      return;
    }

    if (d.kind === 'fib') {
      const lo = Math.min(p1.price, p2.price);
      const hi = Math.max(p1.price, p2.price);
      const span = hi - lo || 1;
      const x1 = Math.min(a.x, b.x);
      const x2 = Math.max(a.x, b.x);
      const right = Math.max(x2, this.host.clientWidth - 8);
      for (const lvl of FIB_LEVELS) {
        const price =
          p1.price >= p2.price
            ? p1.price - span * lvl
            : p1.price + span * lvl;
        const y = this.priceToYSafe(price);
        if (y == null) continue;
        line(g, x1, y, right, y, stroke, Math.max(1, sw - 0.5), lvl === 0.5 ? undefined : '3 3');
        label(g, right - 4, y - 3, `${(lvl * 100).toFixed(1)}%  ${price.toFixed(2)}`, stroke, 10, 'end');
      }
      line(g, a.x, a.y, b.x, b.y, DRAWING_COLORS.muted, 1, '2 2');
      if (selected) {
        circle(g, a.x, a.y, 5, stroke, true);
        circle(g, b.x, b.y, 5, stroke, true);
      }
    }
  }
}

type TwoPointKind =
  | 'trend'
  | 'ray'
  | 'extend'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'fib'
  | 'measure';

/** Create an SVG element in the SVG namespace and append to `parent`. */
function el(
  parent: SVGElement,
  name: string,
  attrs: Record<string, string>,
): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, v);
  }
  parent.appendChild(node);
  return node;
}

/**
 * Stroke with an invisible wide hit-line under a visible stroke (hit vs paint split).
 * Default `pointer-events: stroke` so empty space still pans LWC under cursor tool.
 */
function line(
  g: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  sw: number,
  dash?: string,
  pointerEvents = 'stroke',
) {
  if (!isFiniteNum(x1) || !isFiniteNum(y1) || !isFiniteNum(x2) || !isFiniteNum(y2)) return;
  const width = clampStrokeWidth(sw, 1.5);
  const safeStroke = sanitizeStrokeColor(stroke);
  el(g, 'line', {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    stroke: safeStroke,
    'stroke-width': String(Math.max(width, 8)), // wider hit area
    'stroke-opacity': '0.01',
    'pointer-events': pointerEvents,
    'stroke-linecap': 'round',
  });
  // visible stroke on top
  el(g, 'line', {
    x1: String(x1),
    y1: String(y1),
    x2: String(x2),
    y2: String(y2),
    stroke: safeStroke,
    'stroke-width': String(width),
    'stroke-linecap': 'round',
    'pointer-events': 'none',
    ...(dash ? { 'stroke-dasharray': dash } : {}),
  });
}

function circle(
  g: SVGElement,
  cx: number,
  cy: number,
  r: number,
  stroke: string,
  handle = false,
) {
  if (!isFiniteNum(cx) || !isFiniteNum(cy) || !isFiniteNum(r) || r <= 0) return;
  const safeStroke = sanitizeStrokeColor(stroke);
  el(g, 'circle', {
    cx: String(cx),
    cy: String(cy),
    r: String(r),
    fill: handle ? '#0a0b10' : safeStroke,
    stroke: handle ? safeStroke : '#0a0b10',
    'stroke-width': handle ? '2' : '1',
    'pointer-events': 'auto',
    ...(handle ? { cursor: 'nwse-resize' } : {}),
  });
}

function extendSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  extend: string,
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const scale = Math.max(w, h) * 4 / len;
  let x1 = ax;
  let y1 = ay;
  let x2 = bx;
  let y2 = by;
  if (extend === 'right' || extend === 'both') {
    x2 = bx + dx * scale;
    y2 = by + dy * scale;
  }
  if (extend === 'left' || extend === 'both') {
    x1 = ax - dx * scale;
    y1 = ay - dy * scale;
  }
  return { x1, y1, x2, y2 };
}

function resizeDrawing(origin: Drawing, mode: DragMode, pt: Point): Drawing {
  if (!isFinitePoint(pt)) return origin;
  if (origin.kind === 'hline') {
    return { ...origin, price: pt.price };
  }
  if (origin.kind === 'vline') {
    return { ...origin, time: pt.time };
  }
  if (origin.kind === 'text' || origin.kind === 'priceLabel') {
    return { ...origin, p1: { ...pt } } as Drawing;
  }
  if ('points' in origin && Array.isArray(origin.points) && origin.points.length) {
    const points = origin.points.slice();
    if (mode === 'p1' && points[0]) points[0] = { ...pt };
    else if (mode === 'p2' && points[1]) points[1] = { ...pt };
    return {
      ...origin,
      points,
      p1: points[0],
      p2: points[1] ?? points[0],
      p3: points[2],
    } as Drawing;
  }
  if (mode === 'p1' && 'p1' in origin) {
    return { ...origin, p1: { ...pt } } as Drawing;
  }
  if (mode === 'p2' && 'p2' in origin) {
    return { ...origin, p2: { ...pt } } as Drawing;
  }
  return origin;
}

function label(
  g: SVGElement,
  x: number,
  y: number,
  text: string | null | undefined,
  fill: string,
  size = 11,
  anchor: 'start' | 'end' | 'middle' = 'start',
) {
  if (!isFiniteNum(x) || !isFiniteNum(y)) return;
  const t = el(g, 'text', {
    x: String(x),
    y: String(y),
    fill: sanitizeStrokeColor(fill),
    'font-size': String(isFiniteNum(size) ? size : 11),
    'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
    'text-anchor': anchor,
    'pointer-events': 'none',
  });
  t.textContent = text == null ? '' : String(text);
}

function shiftDrawing(d: Drawing, dTime: number, dPrice: number): Drawing {
  if (!Number.isFinite(dTime) || !Number.isFinite(dPrice)) return d;
  if (d.kind === 'hline') {
    if (!Number.isFinite(d.price)) return d;
    return { ...d, price: d.price + dPrice };
  }
  if (d.kind === 'vline') {
    if (!Number.isFinite(d.time)) return d;
    return { ...d, time: d.time + dTime };
  }
  if (d.kind === 'text' || d.kind === 'priceLabel') {
    if (!d.p1 || !isFinitePoint(d.p1)) return d;
    return {
      ...d,
      p1: { time: d.p1.time + dTime, price: d.p1.price + dPrice },
    };
  }
  if ('points' in d && Array.isArray(d.points) && d.points.length) {
    const points = d.points.map((p) =>
      isFinitePoint(p)
        ? { time: p.time + dTime, price: p.price + dPrice }
        : p,
    );
    return {
      ...d,
      points,
      p1: points[0],
      p2: points[1] ?? points[0],
      p3: points[2],
    } as Drawing;
  }
  if ('p1' in d && 'p2' in d && d.p1 && d.p2) {
    if (!isFinitePoint(d.p1) || !isFinitePoint(d.p2)) return d;
    return {
      ...d,
      p1: { time: d.p1.time + dTime, price: d.p1.price + dPrice },
      p2: { time: d.p2.time + dTime, price: d.p2.price + dPrice },
    } as Drawing;
  }
  return d;
}

/** Triangle arrow head at (x2,y2) pointing from (x1,y1). */
function paintArrowHead(
  g: SVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  fill: string,
  size: number,
) {
  if (!isFiniteNum(x1) || !isFiniteNum(y1) || !isFiniteNum(x2) || !isFiniteNum(y2)) return;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = Math.max(6, isFiniteNum(size) ? size : 8);
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  const p1x = x2 + Math.cos(a1) * s;
  const p1y = y2 + Math.sin(a1) * s;
  const p2x = x2 + Math.cos(a2) * s;
  const p2y = y2 + Math.sin(a2) * s;
  if (!isFiniteNum(p1x) || !isFiniteNum(p1y) || !isFiniteNum(p2x) || !isFiniteNum(p2y)) return;
  const safe = sanitizeStrokeColor(fill);
  el(g, 'polygon', {
    points: `${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`,
    fill: safe,
    stroke: safe,
    'stroke-width': '1',
    'pointer-events': 'none',
  });
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (
    !isFiniteNum(px) ||
    !isFiniteNum(py) ||
    !isFiniteNum(x1) ||
    !isFiniteNum(y1) ||
    !isFiniteNum(x2) ||
    !isFiniteNum(y2)
  ) {
    return Infinity;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function barIndexApprox(chart: IChartApi, time: number): number {
  if (!Number.isFinite(time)) return 0;
  try {
    const c = chart.timeScale().timeToCoordinate(time as UTCTimestamp);
    if (c == null || !isFiniteNum(c)) return 0;
    const logical = chart.timeScale().coordinateToLogical(c);
    return isFiniteNum(logical) ? logical : 0;
  } catch {
    return 0;
  }
}

/**
 * Pure helper for tests: Fibonacci level prices between two endpoints.
 * Direction follows high→low when `p1 >= p2`, else low→high.
 */
export function fibPrices(p1: number, p2: number): number[] {
  const lo = Math.min(p1, p2);
  const hi = Math.max(p1, p2);
  const span = hi - lo || 1;
  const fromHigh = p1 >= p2;
  return FIB_LEVELS.map((lvl) => (fromHigh ? p1 - span * lvl : p1 + span * lvl));
}

/** Stable signature for script drawing payloads (skip no-op live re-applies). */
function scriptDrawingsSignature(list: ScriptDrawing[]): string {
  if (!list.length) return '';
  try {
    return JSON.stringify(
      list.map((d) => ({
        t: d.type,
        id: d.id,
        t1: d.t1,
        p1: d.p1,
        t2: d.t2,
        p2: d.p2,
        c: d.color,
        n: d.points?.length,
        tx: d.text,
        ext: d.extend,
        st: d.style,
      })),
    );
  } catch {
    return String(list.length);
  }
}
