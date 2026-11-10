/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One Lightweight Charts chart per slot (concept §5.1).
 *
 * A {@link SlotChart} assigns each logical pane an index on that one
 * chart, so the time scale is shared and nothing syncs it. The old
 * `axis.chart.layout=multi` rollback (one chart per pane) is gone; a
 * stored value is ignored, like `axis.engine.hp.*`.
 *
 * @module chart/v1/chart-host
 */

import type { IChartApi } from 'lightweight-charts';

/** The slice of IChartApi this host needs. Tests pass a fake. */
export type SlotChartApi = {
  addPane(preserveEmptyPane?: boolean): SlotPaneApi;
  panes(): SlotPaneApi[];
  addSeries(definition: unknown, options?: unknown, paneIndex?: number): unknown;
  removePane(index: number): void;
  remove(): void;
  priceScale(id: string, paneIndex?: number): unknown;
  timeScale(): unknown;
};

/** The slice of LWC pane API this host needs (height, stretch, element). */
export type SlotPaneApi = {
  paneIndex(): number;
  setHeight(height: number): void;
  getHeight(): number;
  setStretchFactor(stretchFactor: number): void;
  getHTMLElement(): HTMLElement | null;
};

/**
 * Pane registry for one chart. Index 0 is the chart's default pane.
 * Later ids call `addPane`. `facade` sends `addSeries` and `priceScale`
 * to that index. `remove` on the facade does nothing — {@link release}
 * decides whether the chart or one pane goes away.
 */
export class SlotChart {
  private readonly ids = new Map<string, number>();

  constructor(private readonly chart: SlotChartApi) {}

  get size(): number {
    return this.ids.size;
  }

  /** The one time scale. Every pane reads this object. */
  timeScale(): unknown {
    return this.chart.timeScale();
  }

  /**
   * Bind a logical pane id to a pane index, creating a pane when needed.
   *
   * @param id logical pane id (`price`, `volume`, `ind_*`)
   * @returns the pane index; the first id bound always takes index 0
   */
  bind(id: string): number {
    const existing = this.ids.get(id);
    if (existing != null) return existing;
    if (this.ids.size === 0) {
      // Pane 0 is the candle pane. An indicator that binds first (remount
      // racing price creation) must not own it — RSI would draw on the price
      // chart and the later price series would share that pane.
      if (id !== 'price') {
        this.ids.set('price', 0);
        const created = this.chart.addPane(true);
        const index = created.paneIndex();
        this.ids.set(id, index);
        return index;
      }
      this.ids.set(id, 0);
      return 0;
    }
    const created = this.chart.addPane(true);
    const index = created.paneIndex();
    this.ids.set(id, index);
    return index;
  }

  /** @returns the pane index bound to `id`, or `undefined` when unbound. */
  indexOf(id: string): number | undefined {
    return this.ids.get(id);
  }

  /**
   * Set one pane's height.
   *
   * @param id logical pane id; unknown ids no-op
   * @param height CSS pixels
   */
  setHeight(id: string, height: number): void {
    const index = this.ids.get(id);
    if (index == null) return;
    this.chart.panes()[index]?.setHeight(height);
  }

  /** @returns pane height in CSS px, or 0 when unbound or not yet measured. */
  getHeight(id: string): number {
    const index = this.ids.get(id);
    if (index == null) return 0;
    const pane = this.chart.panes()[index];
    const height = pane?.getHeight?.() ?? 0;
    return Number.isFinite(height) ? height : 0;
  }

  /**
   * Set one pane's relative stretch factor.
   *
   * @param id logical pane id; unknown ids no-op
   * @param stretchFactor flex weight against the other panes
   */
  setStretchFactor(id: string, stretchFactor: number): void {
    const index = this.ids.get(id);
    if (index == null) return;
    this.chart.panes()[index]?.setStretchFactor(stretchFactor);
  }

  /** @returns the pane's DOM element, or `null` when unbound or not rendered. */
  element(id: string): HTMLElement | null {
    const index = this.ids.get(id);
    if (index == null) return null;
    return this.chart.panes()[index]?.getHTMLElement() ?? null;
  }

  /**
   * Chart view for this pane.
   *
   * The index is read when `addSeries` / `priceScale` run, not when the
   * facade is created. `release` shifts later panes down; a captured index
   * kept painting the removed slot, and an out-of-range index landed on
   * pane 0 (the price chart). An unbound id does not fall back to 0.
   */
  facade(id: string): IChartApi {
    const chart = this.chart;
    const ids = this.ids;
    const resolve = (explicit: number | undefined): number | undefined => {
      if (explicit != null) return explicit;
      const index = ids.get(id);
      if (index == null) return undefined;
      const panes = chart.panes();
      if (index < 0 || index >= panes.length) return undefined;
      return index;
    };
    return new Proxy(chart as object, {
      get(target, prop, receiver) {
        if (prop === 'addSeries') {
          return (definition: unknown, options?: unknown, paneIndex?: number) => {
            const index = resolve(paneIndex);
            if (index == null) return undefined;
            return chart.addSeries(definition, options, index);
          };
        }
        if (prop === 'priceScale') {
          return (scaleId: string, paneIndex?: number) => {
            const index = resolve(paneIndex);
            if (index == null) return undefined;
            return chart.priceScale(scaleId, paneIndex ?? index);
          };
        }
        if (prop === 'remove') return () => {};
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as IChartApi;
  }

  /**
   * Drop a logical pane.
   * The pane at index 0 owns the chart: the caller must {@link destroy}.
   * Any other pane is `removePane`, and higher indexes shift down.
   */
  release(id: string): 'chart' | 'pane' | 'missing' {
    const index = this.ids.get(id);
    if (index == null) return 'missing';
    this.ids.delete(id);
    if (index === 0) {
      this.ids.clear();
      return 'chart';
    }
    try {
      this.chart.removePane(index);
    } catch {
      /* already gone */
    }
    for (const [key, value] of this.ids) {
      if (value > index) this.ids.set(key, value - 1);
    }
    return 'pane';
  }

  /** Remove the underlying chart and forget every pane binding. */
  destroy(): void {
    this.ids.clear();
    try {
      this.chart.remove();
    } catch {
      /* already gone */
    }
  }
}
