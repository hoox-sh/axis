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
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
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
  TV,
} from './series-factory';
import type { Bar } from '../store/types';
import { resizePane } from '../store';
import type { TradeMarker } from '../results/events';
import type { ShapeMarkerSpec } from '../results/plot-visuals';

/** Overlay line from indicator runner (plot series or Pine hline). */
export type OverlayLineSpec = {
  name: string;
  data: { time: number; value: number }[];
  color?: string;
  linewidth?: number;
  /** plot (default) | hline — hlines use createPriceLine when possible */
  kind?: 'plot' | 'hline';
  /** Constant price for kind=hline (preferred over sampling data) */
  price?: number;
  linestyle?: string;
};

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
 */
export class PaneManager {
  private panes: Map<string, ManagedPane> = new Map();
  private container: HTMLElement;
  private suppressSync = false;
  /** LWC v5 markers plugin attached to the price candle series */
  private candleMarkers: ISeriesMarkersPluginApi<any> | null = null;
  /** Strategy entry/exit markers (merged with shape markers) */
  private tradeMarkerList: SeriesMarker<UTCTimestamp>[] = [];
  /** plotshape / plotchar markers (merged with trade markers) */
  private shapeMarkerList: SeriesMarker<UTCTimestamp>[] = [];
  /** One-way range sync unsubscribers */
  private timeSyncUnsubs: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;
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
    div.id = `pane-${id}`;
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

    const labelEl = document.createElement('span');
    labelEl.className =
      'absolute top-1 left-2 text-[10px] text-text-dim uppercase tracking-wider z-10 pointer-events-none bg-bg-base/90 px-1.5 py-0.5 border border-border-soft';
    labelEl.textContent = label;
    div.appendChild(labelEl);

    this.container.appendChild(div);

    const chart = createBaseChart(div, {
      timeScale:
        type === 'volume' || type === 'indicator' || type === 'equity'
          ? {
              visible: false,
              borderColor: '#3a3d4a',
              borderVisible: false,
              shiftVisibleRangeOnNewBar: false,
              allowShiftVisibleRangeOnWhitespaceReplacement: false,
            }
          : undefined,
      rightPriceScale: {
        borderColor: TV.border,
        borderVisible: true,
        textColor: TV.textDim,
        minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
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
      chart.priceScale('right').applyOptions({
        minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
        borderVisible: true,
      });
    } catch {
      /* ignore */
    }

    const ro = new ResizeObserver(() => {
      const rect = div.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        chart.applyOptions({ width: rect.width, height: rect.height });
        // Re-assert scale width after resize (LWC may recompute)
        try {
          chart.priceScale('right').applyOptions({ minimumWidth: RIGHT_PRICE_SCALE_WIDTH });
        } catch {
          /* ignore */
        }
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

    return pane;
  }

  /** Force identical right price-scale width on every pane (plot area alignment). */
  alignRightScales() {
    for (const pane of this.getAllPanes()) {
      if (!pane.visible) continue;
      try {
        pane.chart.priceScale('right').applyOptions({
          minimumWidth: RIGHT_PRICE_SCALE_WIDTH,
          borderVisible: true,
          borderColor: TV.border,
          textColor: TV.textDim,
        });
      } catch {
        /* ignore */
      }
    }
  }

  destroyPane(id: string) {
    const pane = this.panes.get(id);
    if (!pane) return;
    // Disconnect ResizeObserver to prevent memory leak
    if (pane.resizeObserver) {
      pane.resizeObserver.disconnect();
    }
    pane.chart.remove();
    const el = document.getElementById(`pane-${id}`);
    el?.remove();
    document.getElementById(`pane-handle-${id}`)?.remove();
    this.panes.delete(id);
  }

  /**
   * Drag handle above `belowId` — resizes the pane above by changing pixel heights.
   */
  private attachPaneResizeHandle(belowId: string) {
    const handle = document.createElement('div');
    handle.id = `pane-handle-${belowId}`;
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
      belowEl = document.getElementById(`pane-${belowId}`);
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
    const el = document.getElementById(`pane-${id}`);
    if (el) el.style.display = visible ? '' : 'none';
    if (visible) {
      const rect = el?.getBoundingClientRect();
      if (rect) pane.chart.applyOptions({ width: rect.width, height: rect.height });
    }
  }

  setLabel(id: string, label: string) {
    const pane = this.panes.get(id);
    if (pane) pane.label = label;
    const el = document.getElementById(`pane-${id}`);
    const labelEl = el?.querySelector('span');
    if (labelEl) labelEl.textContent = label;
  }

  resize(id: string, height: number) {
    const el = document.getElementById(`pane-${id}`);
    if (el) el.style.height = `${height}px`;
    const pane = this.panes.get(id);
    if (pane) {
      const rect = el?.getBoundingClientRect();
      if (rect) pane.chart.applyOptions({ width: rect.width, height: height });
    }
  }

  syncTimeScales() {
    // Clear previous subscriptions (createPane may call this repeatedly)
    for (const u of this.timeSyncUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.timeSyncUnsubs = [];

    // Prefer price as the range source so all sub-panes match its logical range
    const panes = this.getAllPanes().filter((p) => p.visible);
    if (panes.length < 2) return;
    const src = (this.panes.get('price')?.visible ? this.panes.get('price') : panes[0])!.chart;

    for (const pane of panes) {
      if (pane.chart === src) continue;
      const target = pane.chart;
      const handler = (range: { from: number; to: number } | null) => {
        if (this.suppressSync || !range) return;
        this.suppressSync = true;
        try {
          target.timeScale().setVisibleLogicalRange(range);
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
      // Initial align
      try {
        const cur = src.timeScale().getVisibleLogicalRange();
        if (cur) target.timeScale().setVisibleLogicalRange(cur);
      } catch {
        /* ignore */
      }
    }
    this.alignRightScales();
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

  /** Merge trade + shape markers onto the candle series plugin. */
  private applyCandleMarkers() {
    const pricePane = this.panes.get('price');
    const candle = pricePane?.series['candle'];
    if (!candle) return;

    // Prefer unique times: LWC historically collapsed same-time markers;
    // keep last trade, then shapes can share via id when supported.
    const byKey = new Map<string, SeriesMarker<UTCTimestamp>>();
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
      pane.series['equity'] = createAreaSeries(pane.chart, 'Equity', TV.indigo);
      this.syncTimeScales();
    } else {
      this.setVisible('equity', true);
      if (!pane.series['equity']) {
        pane.series['equity'] = createAreaSeries(pane.chart, 'Equity', TV.indigo);
      }
    }

    pane.series['equity'].setData(
      points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );
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

  syncCrosshair(onMove: (data: { time: any; point: { x: number; y: number } | null; seriesData: Map<ISeriesApi<any>, any> }) => void) {
    for (const pane of this.getAllPanes()) {
      pane.chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.point) {
          onMove({ time: null, point: null, seriesData: new Map() });
          return;
        }
        onMove({ time: param.time, point: param.point, seriesData: param.seriesData as Map<ISeriesApi<any>, any> });
      });
    }
  }

  fitContent() {
    const pricePane = this.panes.get('price');
    if (pricePane) pricePane.chart.timeScale().fitContent();
  }

  setData(paneId: string, seriesKey: string, data: any[]) {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    const series = pane.series[seriesKey];
    if (series) series.setData(data);
  }

  appendBar(bar: Bar) {
    const pricePane = this.panes.get('price');
    if (pricePane?.series['candle']) {
      pricePane.series['candle'].update({
        time: bar.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      // Tint last-price line to bar direction
      try {
        const up = bar.close >= bar.open;
        pricePane.series['candle'].applyOptions({
          priceLineColor: up ? 'rgba(94, 207, 138, 0.55)' : 'rgba(232, 93, 76, 0.55)',
        });
      } catch {
        /* ignore */
      }
    }
    const volPane = this.panes.get('volume');
    if (volPane?.series['volume']) {
      volPane.series['volume'].update({
        time: bar.time as UTCTimestamp,
        value: bar.volume ?? 0,
        color: bar.close >= bar.open ? 'rgba(94, 207, 138, 0.45)' : 'rgba(232, 93, 76, 0.45)',
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
      const mapped = line.data.map((d) => ({ time: d.time as UTCTimestamp, value: d.value }));
      const existing = pane.series[key];
      const lw = line.linewidth != null ? Math.max(1, Math.min(4, Math.round(line.linewidth))) : undefined;
      if (existing) {
        existing.setData(mapped);
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
        series.setData(mapped);
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

    if (savedRange) {
      try {
        pane.chart.timeScale().setVisibleLogicalRange(savedRange);
      } catch {
        /* ignore */
      }
    }
    this.alignRightScales();
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
    for (const u of this.timeSyncUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
    this.timeSyncUnsubs = [];
    for (const pane of this.getAllPanes()) {
      this.destroyPane(pane.id);
    }
  }
}
