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
 * **PaneManager** — multi-pane Lightweight Charts orchestrator for AXIS.
 *
 * Owns one LWC chart per pane (`price`, `volume`, indicator sub-panes, equity).
 * Syncs time scales and crosshair across panes; applies candle data, overlay
 * lines, bgcolor bands, trade/shape markers, and equity curve.
 *
 * Primary consumer: {@link indicators/runner} via `getManager()` from
 * `manager-access`. ChartHost creates the instance and registers it.
 *
 * ## Key methods
 *
 * - `createPane` / `destroyPane` / `getPane`
 * - `setBars` / `appendBar` — OHLCV on price pane
 * - `syncOverlayLines` / `syncBgcolorBands` — indicator apply (update-in-place)
 * - `setTradeMarkers` / `setShapeMarkers` / `setEquityCurve`
 * - `syncTimeScales` / `syncCrosshair`
 *
 * @module chart/pane-manager
 */

import {
  createSeriesMarkers,
  LineStyle,
  MismatchDirection,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  createBaseChart,
  createLineSeries,
  createAreaSeries,
  createBgcolorSeries,
  PLOT_PALETTE,
  RIGHT_PRICE_SCALE_WIDTH,
  VOID,
} from './series-factory';
import {
  mapBarUpdate,
  lastBarDirection,
  normalizeChartType,
  type ChartType,
  DEFAULT_CHART_TYPE,
} from './chart-type';
import type { Bar } from '../store/types';
import { resizePane, store } from '../store';
import type { TradeMarker } from '../results/events';
import type { ShapeMarkerSpec } from '../results/plot-visuals';
import { mountPaneBadge, refreshPaneBadge, setPaneBadgeLabel } from './pane-badge';
import { reportUiError } from '../ui/boot-errors';

/**
 * One plot sample. Omit `value` (or leave undefined) for LWC whitespace so the
 * point still occupies a time-scale slot — required for multi-pane logical
 * range alignment when Pine returns leading `na` (indicator warmup).
 */
export type OverlayPoint = { time: number; value?: number };

/** Overlay line from indicator runner (plot series or Pine hline). */
export type OverlayLineSpec = {
  name: string;
  data: OverlayPoint[];
  color?: string;
  linewidth?: number;
  /** plot (default) | hline — hlines use createPriceLine when possible */
  kind?: 'plot' | 'hline';
  /** Constant price for kind=hline (preferred over sampling data) */
  price?: number;
  linestyle?: string;
};

/** Map overlay points to LWC LineData | WhitespaceData. */
export function toLwcLineData(
  data: OverlayPoint[],
): Array<{ time: UTCTimestamp; value: number } | { time: UTCTimestamp }> {
  return data.map((d) => {
    const time = d.time as UTCTimestamp;
    if (d.value != null && Number.isFinite(d.value)) {
      return { time, value: d.value };
    }
    return { time };
  });
}

/** One managed LWC chart + series map. */
export interface ManagedPane {
  id: string;
  type: string;
  chart: IChartApi;
  series: Record<string, ISeriesApi<any>>;
  /** Pine hline() price lines keyed by name (attached to a host series) */
  priceLines: Record<string, { line: IPriceLine; host: ISeriesApi<any> }>;
  visible: boolean;
  label: string;
  resizeObserver: ResizeObserver | null;
}

function mapLineStyle(linestyle?: string): LineStyle {
  const s = (linestyle || '').toLowerCase();
  if (s.includes('dash')) return LineStyle.Dashed;
  if (s.includes('dot')) return LineStyle.Dotted;
  return LineStyle.Solid;
}

/**
 * Multi-pane chart controller. Construct with the host element that will
 * receive pane DOM nodes (typically ChartHost’s panes container).
 *
 * @param hostKey - Unique prefix for multi-chart layouts so DOM ids
 *   (`pane-{hostKey}-price`) do not collide across slots.
 */
export class PaneManager {
  private panes: Map<string, ManagedPane> = new Map();
  private container: HTMLElement;
  /** Slot / host id for unique pane DOM ids (empty = legacy `pane-price`). */
  private hostKey: string;
  private suppressSync = false;
  /** LWC v5 markers plugin attached to the price candle series */
  private candleMarkers: ISeriesMarkersPluginApi<any> | null = null;
  /** Strategy entry/exit markers (merged with shape markers) */
  private tradeMarkerList: SeriesMarker<UTCTimestamp>[] = [];
  /** plotshape / plotchar markers (merged with trade markers) */
  private shapeMarkerList: SeriesMarker<UTCTimestamp>[] = [];
  /** Inline-debug / Pine log bar pins (merged with trade + shape markers) */
  private debugPinMarkerList: SeriesMarker<UTCTimestamp>[] = [];
  /** Time-range sync unsubscribers (all panes ↔ all panes) */
  private timeSyncUnsubs: Array<() => void> = [];
  /** Crosshair multi-pane sync unsubscribers */
  private crosshairUnsubs: Array<() => void> = [];
  /** Host callback for Data Window / store (set via {@link syncCrosshair}) */
  private crosshairOnMove:
    | ((data: {
        time: any;
        point: { x: number; y: number } | null;
        seriesData: Map<ISeriesApi<any>, any>;
      }) => void)
    | null = null;
  /** Guard re-entrant crosshair setCrosshairPosition loops */
  private suppressCrosshair = false;
  /** Active main price series style (tracks LWC series kind under key `candle`) */
  private priceChartType: ChartType = DEFAULT_CHART_TYPE;
  /** Price pane right-scale toggles (UI [A]/[L]/[$]) */
  private priceAutoScale = true;
  private priceLogScale = false;
  /** Right price-scale labels/axis visible (UI [$]). Default on. */
  private priceScaleLabelsVisible = true;

  constructor(container: HTMLElement, hostKey = '') {
    this.container = container;
    this.hostKey = hostKey || '';
  }

  /** DOM id for a pane element (multi-chart safe). */
  paneDomId(paneId: string): string {
    return this.hostKey ? `pane-${this.hostKey}-${paneId}` : `pane-${paneId}`;
  }

  private handleDomId(belowId: string): string {
    return this.hostKey ? `pane-handle-${this.hostKey}-${belowId}` : `pane-handle-${belowId}`;
  }

  /** Prefer main geometry series on a pane for crosshair anchoring. */
  private primarySeries(pane: ManagedPane): ISeriesApi<any> | null {
    const prefer = ['candle', 'volume', 'equity'] as const;
    for (const k of prefer) {
      if (pane.series[k]) return pane.series[k]!;
    }
    for (const [k, s] of Object.entries(pane.series)) {
      if (k.startsWith('bgcolor')) continue;
      if (s) return s;
    }
    const first = Object.values(pane.series)[0];
    return first ?? null;
  }

  /** Extract a Y price from a candle/line/histogram data point. */
  private static seriesPointPrice(data: unknown): number | null {
    if (data == null || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    for (const k of ['value', 'close', 'high', 'low', 'open'] as const) {
      const v = d[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return null;
  }

  isPriceAutoScale(): boolean {
    return this.priceAutoScale;
  }

  isPriceLogScale(): boolean {
    return this.priceLogScale;
  }

  getPriceChartType(): ChartType {
    return this.priceChartType;
  }

  setPriceChartType(type: ChartType) {
    this.priceChartType = normalizeChartType(type);
  }

  /** Drop markers plugin handle before removing the host series (chart type switch). */
  detachPriceMarkers() {
    this.candleMarkers = null;
  }

  /** Re-bind markers after a new price series is created. */
  reapplyPriceMarkers() {
    this.applyCandleMarkers();
  }

  getPane(id: string): ManagedPane | undefined {
    return this.panes.get(id);
  }

  getAllPanes(): ManagedPane[] {
    return Array.from(this.panes.values());
  }

  createPane(id: string, type: string, label: string, height?: number): ManagedPane {
    // Horizontal resize handle above this pane (except first)
    if (this.panes.size > 0) {
      this.attachPaneResizeHandle(id);
    }

    const div = document.createElement('div');
    div.id = this.paneDomId(id);
    div.className = 'relative';
    div.dataset.paneId = id;
    if (height) {
      div.style.height = `${height}px`;
      div.style.flex = '0 0 auto';
    } else {
      div.style.flex = '1 1 auto';
    }
    div.style.minHeight = type === 'volume' ? '72px' : '48px';
    div.style.background = '#0a0b10';
    div.dataset.paneType = type;

    // Name badge + script action icons (settings / eye / re-run / remove)
    mountPaneBadge(div, id, type, label);

    this.container.appendChild(div);

    const isSecondary = type !== 'price';
    const chart = createBaseChart(div, {
      // Secondary panes: no time axis / scrollbar; time range follows the price pane.
      timeScale: isSecondary
        ? {
            visible: false,
            borderVisible: false,
            borderColor: VOID.border,
            timeVisible: false,
            ticksVisible: false,
            minimumHeight: 0,
            shiftVisibleRangeOnNewBar: false,
            allowShiftVisibleRangeOnWhitespaceReplacement: false,
            rightBarStaysOnScroll: true,
          }
        : undefined,
      // Lock horz scroll/zoom on volume/indicator/equity — price pane is the driver.
      handleScroll: isSecondary
        ? {
            mouseWheel: false,
            pressedMouseMove: false,
            horzTouchDrag: false,
            vertTouchDrag: false,
          }
        : { vertTouchDrag: true },
      handleScale: isSecondary
        ? {
            mouseWheel: false,
            pinch: false,
            axisPressedMouseMove: { time: false, price: true },
            axisDoubleClickReset: { time: false, price: true },
          }
        : undefined,
      rightPriceScale: {
        borderColor: VOID.border,
        borderVisible: this.priceScaleLabelsVisible,
        textColor: VOID.textDim,
        visible: this.priceScaleLabelsVisible,
        minimumWidth: this.priceScaleLabelsVisible ? RIGHT_PRICE_SCALE_WIDTH : 0,
        scaleMargins:
          type === 'volume'
            ? { top: 0.12, bottom: 0.02 }
            : type === 'equity'
              ? { top: 0.1, bottom: 0.05 }
              : type === 'indicator'
                ? { top: 0.08, bottom: 0.08 }
                : { top: 0.06, bottom: 0.06 },
      },
    });

    // Lock right scale width so all pane plot areas share the same right edge
    try {
      chart.priceScale('right').applyOptions(this.rightScaleLayoutOptions());
    } catch {
      /* ignore */
    }

    const ro = new ResizeObserver(() => {
      const rect = div.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        chart.applyOptions({ width: rect.width, height: rect.height });
        // Re-assert scale width / visibility after resize (LWC may recompute)
        try {
          chart.priceScale('right').applyOptions(this.rightScaleLayoutOptions());
        } catch {
          /* ignore */
        }
        // Keep secondary panes aligned after layout thrash
        if (isSecondary) this.alignTimeRangesFromPrice();
      }
    });
    ro.observe(div);

    const pane: ManagedPane = {
      id,
      type,
      chart,
      series: {},
      priceLines: {},
      visible: true,
      label,
      resizeObserver: ro,
    };
    this.panes.set(id, pane);
    this.alignRightScales();
    // Wire range + crosshair for every new pane (equity / indicator created late)
    this.syncTimeScales();
    this.rewireCrosshair();

    return pane;
  }

  /** Shared right-scale width/visibility options (labels on = fixed gutter). */
  private rightScaleLayoutOptions(): {
    visible: boolean;
    minimumWidth: number;
    borderVisible: boolean;
    borderColor: string;
    textColor: string;
  } {
    const labels = this.priceScaleLabelsVisible;
    return {
      visible: labels,
      // Hidden: free the gutter so plot area uses full width
      minimumWidth: labels ? RIGHT_PRICE_SCALE_WIDTH : 0,
      borderVisible: labels,
      borderColor: VOID.border,
      textColor: VOID.textDim,
    };
  }

  /** Force identical right price-scale width on every pane (plot area alignment). */
  alignRightScales() {
    const opts = this.rightScaleLayoutOptions();
    for (const pane of this.getAllPanes()) {
      if (!pane.visible) continue;
      try {
        pane.chart.priceScale('right').applyOptions(opts);
      } catch {
        /* ignore */
      }
    }
  }

  destroyPane(id: string, opts?: { rewire?: boolean }) {
    const pane = this.panes.get(id);
    if (!pane) return;
    // Disconnect ResizeObserver to prevent memory leak
    if (pane.resizeObserver) {
      pane.resizeObserver.disconnect();
    }
    try {
      pane.chart.remove();
    } catch {
      /* ignore */
    }
    const el = document.getElementById(this.paneDomId(id));
    el?.remove();
    document.getElementById(this.handleDomId(id))?.remove();
    this.panes.delete(id);
    // Re-wire remaining panes so sync handlers don't point at removed charts
    if (opts?.rewire !== false) {
      this.syncTimeScales();
      this.rewireCrosshair();
    }
  }

  /**
   * Drag handle above `belowId` — resizes the pane above by changing pixel heights.
   */
  private attachPaneResizeHandle(belowId: string) {
    const handle = document.createElement('div');
    handle.id = this.handleDomId(belowId);
    handle.className = 'sc-pane-resize-handle';
    handle.title = 'Drag to resize panes';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');

    let dragging = false;
    let startY = 0;
    let aboveStart = 0;
    let belowStart = 0;
    let aboveEl: HTMLElement | null = null;
    let belowEl: HTMLElement | null = null;

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      belowEl = document.getElementById(this.paneDomId(belowId));
      // Previous sibling pane element (skip handles)
      let prev = handle.previousElementSibling as HTMLElement | null;
      while (prev && !prev.id?.startsWith('pane-')) {
        prev = prev.previousElementSibling as HTMLElement | null;
      }
      aboveEl = prev;
      if (!aboveEl || !belowEl) return;
      dragging = true;
      startY = e.clientY;
      aboveStart = aboveEl.getBoundingClientRect().height;
      belowStart = belowEl.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging || !aboveEl || !belowEl) return;
      const dy = e.clientY - startY;
      const minAbove = 48;
      const minBelow = belowEl.dataset.paneId === 'volume' ? 72 : 48;
      let newAbove = aboveStart + dy;
      let newBelow = belowStart - dy;
      if (newAbove < minAbove) {
        newBelow -= minAbove - newAbove;
        newAbove = minAbove;
      }
      if (newBelow < minBelow) {
        newAbove -= minBelow - newBelow;
        newBelow = minBelow;
      }
      if (newAbove < minAbove || newBelow < minBelow) return;

      aboveEl.style.flex = '0 0 auto';
      belowEl.style.flex = '0 0 auto';
      aboveEl.style.height = `${newAbove}px`;
      belowEl.style.height = `${newBelow}px`;

      const aboveId = aboveEl.id.replace(/^pane-/, '');
      this.resize(aboveId, newAbove);
      this.resize(belowId, newBelow);
    });

    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist heights into store
      if (aboveEl && belowEl) {
        const aboveId = aboveEl.id.replace(/^pane-/, '');
        const ah = aboveEl.getBoundingClientRect().height;
        const bh = belowEl.getBoundingClientRect().height;
        resizePane(aboveId, Math.round(ah));
        resizePane(belowId, Math.round(bh));
      }
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);

    this.container.appendChild(handle);
  }

  setVisible(id: string, visible: boolean) {
    const pane = this.panes.get(id);
    if (!pane) return;
    pane.visible = visible;
    const el = document.getElementById(this.paneDomId(id));
    if (el) el.style.display = visible ? '' : 'none';
    if (visible) {
      const rect = el?.getBoundingClientRect();
      if (rect) pane.chart.applyOptions({ width: rect.width, height: rect.height });
      this.alignTimeRangesFromPrice();
    }
    this.syncTimeScales();
    this.rewireCrosshair();
  }

  setLabel(id: string, label: string) {
    const pane = this.panes.get(id);
    if (pane) pane.label = label;
    setPaneBadgeLabel(id, label);
  }

  /** Rebuild script-action badges (after apply / toggle / remove). */
  refreshBadges(paneId?: string) {
    if (paneId) refreshPaneBadge(paneId);
    else {
      for (const id of this.panes.keys()) refreshPaneBadge(id);
    }
  }

  resize(id: string, height: number) {
    const el = document.getElementById(this.paneDomId(id));
    if (el) el.style.height = `${height}px`;
    const pane = this.panes.get(id);
    if (pane) {
      const rect = el?.getBoundingClientRect();
      if (rect) pane.chart.applyOptions({ width: rect.width, height: height });
    }
  }

  /**
   * Keep every pane on the same visible logical range.
   * Price pane is the preferred driver (sub-panes have horz scroll disabled),
   * but any pane that does emit a range change still propagates to the rest.
   */
  syncTimeScales() {
    for (const u of this.timeSyncUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.timeSyncUnsubs = [];

    const panes = this.getAllPanes().filter((p) => p.visible);
    if (panes.length < 2) {
      this.alignRightScales();
      return;
    }

    for (const srcPane of panes) {
      const src = srcPane.chart;
      const handler = (range: { from: number; to: number } | null) => {
        if (this.suppressSync || !range) return;
        this.suppressSync = true;
        try {
          for (const pane of this.getAllPanes()) {
            if (!pane.visible || pane.chart === src) continue;
            try {
              pane.chart.timeScale().setVisibleLogicalRange(range);
            } catch {
              /* ignore per-pane */
            }
          }
        } finally {
          this.suppressSync = false;
        }
      };
      src.timeScale().subscribeVisibleLogicalRangeChange(handler);
      this.timeSyncUnsubs.push(() => {
        try {
          src.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
        } catch {
          /* ignore */
        }
      });
    }

    this.alignTimeRangesFromPrice();
    this.alignRightScales();
  }

  /** Push the price pane logical range onto all other visible panes. */
  alignTimeRangesFromPrice() {
    const price =
      this.panes.get('price')?.visible !== false ? this.panes.get('price') : null;
    const src = price ?? this.getAllPanes().find((p) => p.visible);
    if (!src) return;
    let range: { from: number; to: number } | null = null;
    try {
      range = src.chart.timeScale().getVisibleLogicalRange();
    } catch {
      range = null;
    }
    if (!range) return;
    this.suppressSync = true;
    try {
      for (const pane of this.getAllPanes()) {
        if (!pane.visible || pane.chart === src.chart) continue;
        try {
          pane.chart.timeScale().setVisibleLogicalRange(range);
        } catch {
          /* ignore */
        }
      }
    } finally {
      this.suppressSync = false;
    }
  }

  /**
   * Attach or update entry/exit markers on the price candle series (LWC v5).
   * Merges with plotshape markers so neither path wipes the other.
   */
  setTradeMarkers(markers: TradeMarker[]) {
    this.tradeMarkerList = markers.map((m) => ({
      time: m.time as UTCTimestamp,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text,
      id: `trade_${m.time}_${m.text || ''}`,
    }));
    this.applyCandleMarkers();
  }

  /**
   * plotshape / plotchar markers — stored separately and merged with strategy markers.
   */
  setShapeMarkers(markers: ShapeMarkerSpec[] | TradeMarker[]) {
    this.shapeMarkerList = markers.map((m, i) => ({
      time: m.time as UTCTimestamp,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text,
      id: ('id' in m && m.id) || `shape_${m.time}_${i}`,
    }));
    this.applyCandleMarkers();
  }

  clearTradeMarkers() {
    this.tradeMarkerList = [];
    this.applyCandleMarkers();
  }

  clearShapeMarkers() {
    this.shapeMarkerList = [];
    this.applyCandleMarkers();
  }

  /**
   * Debug pins from Pine logs / inline-debug chips — stored separately so
   * strategy / plotshape updates do not wipe them.
   */
  setDebugPinMarkers(markers: ShapeMarkerSpec[] | TradeMarker[]) {
    this.debugPinMarkerList = markers.map((m, i) => ({
      time: m.time as UTCTimestamp,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: m.text,
      id: ('id' in m && m.id) || `debug_${m.time}_${i}`,
    }));
    this.applyCandleMarkers();
  }

  clearDebugPinMarkers() {
    this.debugPinMarkerList = [];
    this.applyCandleMarkers();
  }

  /** Merge trade + shape + debug-pin markers onto the candle series plugin. */
  private applyCandleMarkers() {
    const pricePane = this.panes.get('price');
    const candle = pricePane?.series['candle'];
    if (!candle) return;

    // Prefer unique times: LWC historically collapsed same-time markers;
    // keep last trade, then shapes can share via id when supported.
    const byKey = new Map<string, SeriesMarker<UTCTimestamp>>();
    for (const m of this.debugPinMarkerList) {
      const key = m.id || `d:${m.time}:${m.text || ''}`;
      byKey.set(key, m);
    }
    for (const m of this.shapeMarkerList) {
      const key = m.id || `s:${m.time}:${m.position}:${m.shape}`;
      byKey.set(key, m);
    }
    for (const m of this.tradeMarkerList) {
      // Trades win on exact same id collision; use time+text key
      const key = m.id || `t:${m.time}:${m.text || ''}`;
      byKey.set(key, m);
    }
    const seriesMarkers = Array.from(byKey.values()).sort(
      (a, b) => (a.time as number) - (b.time as number),
    );

    if (!this.candleMarkers) {
      this.candleMarkers = createSeriesMarkers(candle, seriesMarkers);
    } else {
      this.candleMarkers.setMarkers(seriesMarkers);
    }
  }

  /**
   * Center all panes on a bar time (unix seconds). Used when clicking a trade row.
   */
  scrollToTime(time: number, halfWindow = 40) {
    if (!Number.isFinite(time)) return;
    const t = time as UTCTimestamp;
    for (const pane of this.getAllPanes()) {
      if (!pane.visible) continue;
      try {
        const ts = pane.chart.timeScale();
        const coord = ts.timeToCoordinate(t);
        if (coord == null) {
          // Time outside current data — try a tight visible range
          ts.setVisibleRange({
            from: (time - 86400 * 14) as UTCTimestamp,
            to: (time + 86400 * 14) as UTCTimestamp,
          });
          continue;
        }
        const logical = ts.coordinateToLogical(coord);
        if (logical == null) continue;
        this.suppressSync = true;
        try {
          ts.setVisibleLogicalRange({
            from: logical - halfWindow,
            to: logical + halfWindow,
          });
        } finally {
          this.suppressSync = false;
        }
      } catch {
        /* ignore per-pane failures */
      }
    }
  }

  /**
   * Show / hide equity pane and set area series data.
   * Creates the pane on first use (height 100px).
   */
  setEquityCurve(points: { time: number; value: number }[]) {
    if (!points.length) {
      this.hideEquityPane();
      return;
    }

    let pane = this.panes.get('equity');
    if (!pane) {
      pane = this.createPane('equity', 'equity', 'Equity', 100);
      pane.series['equity'] = createAreaSeries(pane.chart, 'Equity', VOID.indigo);
      this.syncTimeScales();
    } else {
      this.setVisible('equity', true);
      if (!pane.series['equity']) {
        pane.series['equity'] = createAreaSeries(pane.chart, 'Equity', VOID.indigo);
      }
    }

    pane.series['equity'].setData(
      points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
    this.alignTimeRangesFromPrice();
  }

  hideEquityPane() {
    const pane = this.panes.get('equity');
    if (!pane) return;
    if (pane.series['equity']) {
      try {
        pane.series['equity'].setData([]);
      } catch {
        /* ignore */
      }
    }
    this.setVisible('equity', false);
  }

  /**
   * Wire crosshair → Data Window callback and mirror the crosshair (vertical +
   * horizontal) onto every other pane via {@link IChartApi.setCrosshairPosition}.
   */
  syncCrosshair(
    onMove: (data: {
      time: any;
      point: { x: number; y: number } | null;
      seriesData: Map<ISeriesApi<any>, any>;
    }) => void,
  ) {
    this.crosshairOnMove = onMove;
    this.rewireCrosshair();
  }

  private rewireCrosshair() {
    for (const u of this.crosshairUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.crosshairUnsubs = [];
    if (!this.crosshairOnMove) return;

    for (const pane of this.getAllPanes()) {
      const handler = (param: MouseEventParams) => {
        if (this.suppressCrosshair) return;

        if (!param.time || !param.point) {
          this.suppressCrosshair = true;
          try {
            for (const other of this.getAllPanes()) {
              if (other.chart === pane.chart) continue;
              try {
                other.chart.clearCrosshairPosition();
              } catch {
                /* ignore */
              }
            }
          } finally {
            this.suppressCrosshair = false;
          }
          this.crosshairOnMove?.({ time: null, point: null, seriesData: new Map() });
          return;
        }

        // Mirror onto all other panes
        this.suppressCrosshair = true;
        try {
          for (const other of this.getAllPanes()) {
            if (!other.visible || other.chart === pane.chart) continue;
            this.applyCrosshairToPane(other, param);
          }
        } finally {
          this.suppressCrosshair = false;
        }

        this.crosshairOnMove?.({
          time: param.time,
          point: param.point,
          seriesData: param.seriesData as Map<ISeriesApi<any>, any>,
        });
      };

      pane.chart.subscribeCrosshairMove(handler);
      this.crosshairUnsubs.push(() => {
        try {
          pane.chart.unsubscribeCrosshairMove(handler);
        } catch {
          /* ignore */
        }
      });
    }
  }

  /**
   * Place the crosshair on `target` at the same time as `param`, using a local
   * series value for the horizontal arm when available.
   */
  private applyCrosshairToPane(target: ManagedPane, param: MouseEventParams) {
    const series = this.primarySeries(target);
    if (!series || param.time == null) return;

    let price = PaneManager.seriesPointPrice(param.seriesData?.get(series));

    if (price == null) {
      try {
        let logical: number | null = null;
        if (param.point) {
          logical = target.chart.timeScale().coordinateToLogical(param.point.x);
        }
        if (logical != null && typeof series.dataByIndex === 'function') {
          const d = series.dataByIndex(
            Math.round(logical),
            MismatchDirection.NearestLeft,
          );
          price = PaneManager.seriesPointPrice(d);
        }
      } catch {
        /* ignore */
      }
    }

    if (price == null) {
      // Still show the vertical line: anchor to mid-plot or last known value
      try {
        const h =
          typeof target.chart.paneSize === 'function'
            ? target.chart.paneSize().height
            : 0;
        if (h > 0 && typeof series.coordinateToPrice === 'function') {
          const mid = series.coordinateToPrice(h / 2);
          if (typeof mid === 'number' && Number.isFinite(mid)) price = mid;
        }
      } catch {
        /* ignore */
      }
    }
    if (price == null || !Number.isFinite(price)) price = 0;

    try {
      target.chart.setCrosshairPosition(price, param.time as UTCTimestamp, series);
    } catch {
      /* ignore */
    }
  }

  fitContent() {
    const pricePane = this.panes.get('price');
    if (pricePane) pricePane.chart.timeScale().fitContent();
    // Sub-panes must inherit the fitted range (they do not fit independently)
    this.alignTimeRangesFromPrice();
  }

  /**
   * Force every visible pane to measure its host div and re-apply LWC size.
   * Call after symbol/history reloads so a layout thrash (empty overlay, flex)
   * does not leave a stale canvas size.
   */
  resizeAll() {
    for (const pane of this.getAllPanes()) {
      if (!pane.visible) continue;
      const el = document.getElementById(this.paneDomId(pane.id));
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        try {
          pane.chart.applyOptions({ width: rect.width, height: rect.height });
          pane.chart.priceScale('right').applyOptions(this.rightScaleLayoutOptions());
        } catch {
          /* ignore */
        }
      }
    }
    this.alignRightScales();
  }

  /** Apply auto / log mode to the main price pane right scale. */
  applyPriceScaleOptions(opts: { autoScale?: boolean; logScale?: boolean }) {
    if (opts.autoScale != null) this.priceAutoScale = !!opts.autoScale;
    if (opts.logScale != null) this.priceLogScale = !!opts.logScale;
    const pricePane = this.panes.get('price');
    if (!pricePane) return;
    try {
      pricePane.chart.priceScale('right').applyOptions({
        autoScale: this.priceAutoScale,
        mode: this.priceLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        ...this.rightScaleLayoutOptions(),
      });
    } catch {
      /* ignore */
    }
  }

  /** Toggle auto-scale on the price pane ([A]). Re-enabling also fits content. */
  togglePriceAutoScale(): boolean {
    this.applyPriceScaleOptions({ autoScale: !this.priceAutoScale });
    if (this.priceAutoScale) {
      this.fitContent();
    }
    return this.priceAutoScale;
  }

  /** Toggle logarithmic price scale ([L]). */
  togglePriceLogScale(): boolean {
    this.applyPriceScaleOptions({ logScale: !this.priceLogScale });
    return this.priceLogScale;
  }

  isPriceScaleLabelsVisible(): boolean {
    return this.priceScaleLabelsVisible;
  }

  /**
   * Show/hide right price-scale labels (and the scale gutter) on every pane.
   * Used by chart [$] control and Settings.
   */
  setPriceScaleLabelsVisible(visible: boolean): boolean {
    this.priceScaleLabelsVisible = !!visible;
    this.alignRightScales();
    return this.priceScaleLabelsVisible;
  }

  /** Toggle right price-scale labels ([$]). */
  togglePriceScaleLabelsVisible(): boolean {
    return this.setPriceScaleLabelsVisible(!this.priceScaleLabelsVisible);
  }

  /**
   * Apply a user color override to an overlay plot or hline on a pane.
   * Returns true when a series/price-line was found and updated.
   */
  setOverlayLineColor(paneId: string, plotName: string, color: string): boolean {
    const pane = this.panes.get(paneId);
    if (!pane || !color) return false;
    let ok = false;
    const key = `overlay_${plotName}`;
    const series = pane.series[key];
    if (series) {
      try {
        series.applyOptions({ color });
        ok = true;
      } catch {
        /* ignore */
      }
    }
    const pl = pane.priceLines[plotName];
    if (pl?.line) {
      try {
        pl.line.applyOptions({ color });
        ok = true;
      } catch {
        /* ignore */
      }
    }
    return ok;
  }

  /**
   * After a full history replace (symbol / interval load): resize panes, re-enable
   * auto-scale, fit time range, keep current log mode.
   */
  afterDataReload() {
    this.resizeAll();
    this.applyPriceScaleOptions({ autoScale: true });
    this.fitContent();
    this.alignTimeRangesFromPrice();
    // Second pass after layout settles (empty-state flip / flex reflow)
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
    raf(() => {
      this.resizeAll();
      this.fitContent();
      this.applyPriceScaleOptions({ autoScale: true });
      this.alignTimeRangesFromPrice();
    });
  }

  setData(paneId: string, seriesKey: string, data: any[]) {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const series = pane.series[seriesKey];
    if (series) series.setData(data);
  }

  /**
   * Live bar update on price + volume panes.
   * Uses `store.bars` (already updated by store.appendBar) for Heikin-Ashi /
   * line styles that need prior bars. Falls back to the single `bar` when
   * the store is empty (unit tests).
   */
  appendBar(bar: Bar) {
    try {
      const pricePane = this.panes.get('price');
      const chartType = normalizeChartType(store.chartType ?? this.priceChartType);
      if (pricePane?.series['candle']) {
        const bars =
          store.bars?.length && store.bars[store.bars.length - 1]?.time === bar.time
            ? store.bars
            : store.bars?.length
              ? [...store.bars.filter((b) => b.time !== bar.time), bar].sort(
                  (a, c) => a.time - c.time,
                )
              : [bar];
        const point = mapBarUpdate(bars, chartType);
        if (point) {
          pricePane.series['candle'].update({
            ...point,
            time: point.time as UTCTimestamp,
          } as never);
        }
        // Tint last-price line to bar direction
        try {
          const dir = lastBarDirection(bars, chartType);
          if (dir) {
            pricePane.series['candle'].applyOptions({
              priceLineColor:
                dir === 'up' ? 'rgba(94, 207, 138, 0.55)' : 'rgba(232, 93, 76, 0.55)',
            });
          }
        } catch {
          /* price line tint optional */
        }
      }
      const volPane = this.panes.get('volume');
      if (volPane?.series['volume']) {
        volPane.series['volume'].update({
          time: bar.time as UTCTimestamp,
          value: bar.volume ?? 0,
          color:
            bar.close >= bar.open
              ? 'rgba(94, 207, 138, 0.45)'
              : 'rgba(232, 93, 76, 0.45)',
        });
      }
    } catch (err: unknown) {
      // Live ticks must not tear down the Solid tree or flood the status bar
      reportUiError(err, {
        source: 'chart',
        context: 'Live bar update failed',
        status: true,
        throttleMs: 4000,
      });
    }
  }

  removeOverlays(paneId: string) {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const overlays = Object.keys(pane.series).filter(
      (k) => k.startsWith('overlay_') || k.startsWith('bgcolor_'),
    );
    for (const k of overlays) {
      try { pane.chart.removeSeries(pane.series[k]); } catch {}
      delete pane.series[k];
    }
    for (const name of Object.keys(pane.priceLines)) {
      const pl = pane.priceLines[name];
      try {
        pl.host.removePriceLine(pl.line);
      } catch {
        /* ignore */
      }
      delete pane.priceLines[name];
    }
  }

  /** Prefer candle, else first non-overlay series, else any series (for createPriceLine host). */
  private priceLineHost(pane: ManagedPane): ISeriesApi<any> | null {
    if (pane.series['candle']) return pane.series['candle'];
    for (const [k, s] of Object.entries(pane.series)) {
      if (!k.startsWith('overlay_')) return s;
    }
    const first = Object.values(pane.series)[0];
    return first ?? null;
  }

  /**
   * Update overlay lines in place when keys match — avoids destroy/recreate flash
   * during live re-runs. Removes only stale keys; creates missing ones.
   * kind=hline → createPriceLine on host series (or constant line series fallback).
   */
  syncOverlayLines(paneId: string, lines: OverlayLineSpec[]) {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    // Preserve viewport — setData must not auto-reposition on live re-runs
    let savedRange: { from: number; to: number } | null = null;
    try {
      savedRange = pane.chart.timeScale().getVisibleLogicalRange();
    } catch {
      savedRange = null;
    }

    const plotLines = lines.filter((l) => l.kind !== 'hline');
    const hLines = lines.filter((l) => l.kind === 'hline');

    // Plot series keys we want to keep (hline may fall back to series too)
    const wantSeries = new Set(plotLines.map((l) => `overlay_${l.name}`));
    const wantPrice = new Set(hLines.map((l) => l.name));

    for (const k of Object.keys(pane.series)) {
      if (!k.startsWith('overlay_')) continue;
      const name = k.slice('overlay_'.length);
      // Keep overlay series if still wanted as plot or as hline fallback
      if (!wantSeries.has(k) && !wantPrice.has(name)) {
        try {
          pane.chart.removeSeries(pane.series[k]);
        } catch {
          /* ignore */
        }
        delete pane.series[k];
      }
    }

    for (const name of Object.keys(pane.priceLines)) {
      if (!wantPrice.has(name)) {
        const pl = pane.priceLines[name];
        try {
          pl.host.removePriceLine(pl.line);
        } catch {
          /* ignore */
        }
        delete pane.priceLines[name];
      }
    }

    let colorIdx = 0;
    for (const line of plotLines) {
      const key = `overlay_${line.name}`;
      // Whitespace for na keeps logical indices aligned with the price pane
      const mapped = toLwcLineData(line.data);
      const existing = pane.series[key];
      const lw = line.linewidth != null ? Math.max(1, Math.min(4, Math.round(line.linewidth))) : undefined;
      if (existing) {
        existing.setData(mapped as never);
        try {
          const opts: Record<string, unknown> = {};
          if (line.color) opts.color = line.color;
          if (lw != null) opts.lineWidth = lw;
          if (Object.keys(opts).length) existing.applyOptions(opts);
        } catch {
          /* ignore */
        }
      } else {
        const c = line.color || PLOT_PALETTE[colorIdx % PLOT_PALETTE.length];
        const series = createLineSeries(pane.chart, line.name, c, undefined, lw ?? 2);
        series.setData(mapped as never);
        pane.series[key] = series;
      }
      colorIdx += 1;
    }

    // hlines after plots so a host series exists on indicator panes
    for (const line of hLines) {
      let price = line.price;
      if (price == null || !Number.isFinite(price)) {
        const sample = line.data.find((d) => d != null && Number.isFinite(d.value));
        price = sample?.value;
      }
      if (price == null || !Number.isFinite(price)) continue;

      const c = line.color || PLOT_PALETTE[colorIdx % PLOT_PALETTE.length];
      const lw = Math.max(1, Math.min(4, Math.round(line.linewidth ?? 1))) as 1 | 2 | 3 | 4;
      const host = this.priceLineHost(pane);
      const existingPl = pane.priceLines[line.name];

      if (host) {
        // Drop any previous constant-line fallback series for this hline
        const fallbackKey = `overlay_${line.name}`;
        if (pane.series[fallbackKey]) {
          try {
            pane.chart.removeSeries(pane.series[fallbackKey]);
          } catch {
            /* ignore */
          }
          delete pane.series[fallbackKey];
        }

        const opts = {
          price,
          color: c,
          lineWidth: lw,
          lineStyle: mapLineStyle(line.linestyle),
          axisLabelVisible: true,
          title: line.name,
        };
        if (existingPl && existingPl.host === host) {
          try {
            existingPl.line.applyOptions(opts);
          } catch {
            /* ignore */
          }
        } else {
          if (existingPl) {
            try {
              existingPl.host.removePriceLine(existingPl.line);
            } catch {
              /* ignore */
            }
          }
          try {
            const pl = host.createPriceLine(opts);
            pane.priceLines[line.name] = { line: pl, host };
          } catch {
            // Fall through to constant series if createPriceLine unavailable (tests/mocks)
            this._hlineAsSeries(pane, line, price, c, lw);
          }
        }
      } else {
        this._hlineAsSeries(pane, line, price, c, lw);
      }
      colorIdx += 1;
    }

    if (paneId === 'price' && savedRange) {
      // Preserve price viewport on live re-runs, then push to sub-panes
      try {
        pane.chart.timeScale().setVisibleLogicalRange(savedRange);
      } catch {
        /* ignore */
      }
    }
    // Secondary panes always follow price — requires whitespace-padded series
    // so logical indices match (leading Pine `na` must not shrink the series).
    this.alignTimeRangesFromPrice();
    this.alignRightScales();

    // Indicator / equity panes: ensure auto-scale + layout after first paint.
    // Without this, a newly created sub-pane can stay blank (0 visible range /
    // stale scale) even though setData succeeded.
    if (paneId !== 'price' && paneId !== 'volume') {
      try {
        pane.chart.priceScale('right').applyOptions({ autoScale: true });
      } catch {
        /* ignore */
      }
      try {
        const host = document.getElementById(this.paneDomId(paneId));
        const rect = host?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          pane.chart.applyOptions({ width: rect.width, height: rect.height });
        }
      } catch {
        /* ignore */
      }
      // If price range could not be copied yet, fit this pane so lines appear
      if (paneId !== 'price') {
        try {
          const pr = this.panes.get('price')?.chart.timeScale().getVisibleLogicalRange();
          if (!pr) {
            pane.chart.timeScale().fitContent();
          }
        } catch {
          try {
            pane.chart.timeScale().fitContent();
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  /** Fallback: render hline as a constant-value line series when no price-line host. */
  private _hlineAsSeries(
    pane: ManagedPane,
    line: OverlayLineSpec,
    price: number,
    color: string,
    lineWidth: number,
  ) {
    const key = `overlay_${line.name}`;
    const mapped =
      line.data.length > 0
        ? line.data.map((d) => ({ time: d.time as UTCTimestamp, value: price }))
        : [];
    const existing = pane.series[key];
    if (existing) {
      if (mapped.length) existing.setData(mapped);
      try {
        existing.applyOptions({ color, lineWidth });
      } catch {
        /* ignore */
      }
    } else if (mapped.length) {
      const series = createLineSeries(pane.chart, line.name, color, undefined, lineWidth);
      series.setData(mapped);
      pane.series[key] = series;
    }
  }

  addOverlayLine(paneId: string, name: string, data: { time: number; value: number }[], color?: string) {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const overlayCount = Object.keys(pane.series).filter((k) => k.startsWith('overlay_')).length;
    const c = color || PLOT_PALETTE[overlayCount % PLOT_PALETTE.length];
    const series = createLineSeries(pane.chart, name, c);
    series.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.value })));
    pane.series[`overlay_${name}`] = series;
    return series;
  }

  /**
   * Sync Pine bgcolor histogram bands on the price pane (behind candles).
   * Empty list removes all bgcolor_* series.
   */
  syncBgcolorBands(
    bands: Array<{ name: string; data: { time: number; value: number; color: string }[] }>,
  ) {
    const pane = this.panes.get('price');
    if (!pane) return;

    let savedRange: { from: number; to: number } | null = null;
    try {
      savedRange = pane.chart.timeScale().getVisibleLogicalRange();
    } catch {
      savedRange = null;
    }

    const want = new Set(bands.map((b) => `bgcolor_${b.name}`));
    for (const k of Object.keys(pane.series)) {
      if (!k.startsWith('bgcolor_')) continue;
      if (!want.has(k)) {
        try {
          pane.chart.removeSeries(pane.series[k]);
        } catch {
          /* ignore */
        }
        delete pane.series[k];
      }
    }

    for (const band of bands) {
      const key = `bgcolor_${band.name}`;
      const mapped = band.data.map((d) => ({
        time: d.time as UTCTimestamp,
        value: d.value,
        color: d.color,
      }));
      const existing = pane.series[key];
      if (existing) {
        existing.setData(mapped);
      } else {
        const series = createBgcolorSeries(pane.chart);
        series.setData(mapped);
        pane.series[key] = series;
        try {
          series.setSeriesOrder(0);
        } catch {
          /* ignore */
        }
      }
    }

    const candle = pane.series['candle'];
    if (candle) {
      try {
        const order = candle.seriesOrder?.() ?? 1;
        if (order < 1) candle.setSeriesOrder?.(1);
      } catch {
        /* ignore */
      }
    }

    if (savedRange) {
      try {
        pane.chart.timeScale().setVisibleLogicalRange(savedRange);
      } catch {
        /* ignore */
      }
    }
  }

  dispose() {
    this.candleMarkers = null;
    this.tradeMarkerList = [];
    this.shapeMarkerList = [];
    this.crosshairOnMove = null;
    for (const u of this.crosshairUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.crosshairUnsubs = [];
    for (const u of this.timeSyncUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.timeSyncUnsubs = [];
    for (const id of [...this.panes.keys()]) {
      this.destroyPane(id, { rewire: false });
    }
  }
}
