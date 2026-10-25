/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * One Lightweight Charts chart per slot (concept §5.1).
 *
 * `axis.chart.layout=single` opts in. The default `multi` keeps today's
 * one-chart-per-pane path. A {@link SlotChart} assigns each logical pane an
 * index on that one chart, so the time scale is shared and nothing syncs it.
 *
 * @module chart/v1/chart-host
 */

import type { IChartApi } from 'lightweight-charts';
import { getItem, removeItem, setItem, storageAvailable } from '../../utils/storage';

export type ChartLayoutMode = 'multi' | 'single';

export const CHART_LAYOUT_KEY = 'axis.chart.layout';

let memory: ChartLayoutMode = 'multi';

/** `single` only when the tab set that value. Anything else is `multi`. */
export function chartLayoutMode(): ChartLayoutMode {
  if (!storageAvailable()) return memory;
  return getItem(CHART_LAYOUT_KEY) === 'single' ? 'single' : 'multi';
}

export function setChartLayoutMode(mode: ChartLayoutMode): void {
  memory = mode === 'single' ? 'single' : 'multi';
  if (!storageAvailable()) return;
  if (memory === 'single') setItem(CHART_LAYOUT_KEY, 'single');
  else removeItem(CHART_LAYOUT_KEY);
}

export function resetChartLayoutMode(): void {
  memory = 'multi';
  removeItem(CHART_LAYOUT_KEY);
}

export function usesSingleChartLayout(): boolean {
  return chartLayoutMode() === 'single';
}

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

export type SlotPaneApi = {
  paneIndex(): number;
  setHeight(height: number): void;
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

  bind(id: string): number {
    const existing = this.ids.get(id);
    if (existing != null) return existing;
    if (this.ids.size === 0) {
      this.ids.set(id, 0);
      return 0;
    }
    const created = this.chart.addPane(true);
    const index = created.paneIndex();
    this.ids.set(id, index);
    return index;
  }

  indexOf(id: string): number | undefined {
    return this.ids.get(id);
  }

  setHeight(id: string, height: number): void {
    const index = this.ids.get(id);
    if (index == null) return;
    this.chart.panes()[index]?.setHeight(height);
  }

  element(id: string): HTMLElement | null {
    const index = this.ids.get(id);
    if (index == null) return null;
    return this.chart.panes()[index]?.getHTMLElement() ?? null;
  }

  /** Chart view fixed to this pane's index. */
  facade(id: string): IChartApi {
    const index = this.ids.get(id) ?? 0;
    const chart = this.chart;
    return new Proxy(chart as object, {
      get(target, prop, receiver) {
        if (prop === 'addSeries') {
          return (definition: unknown, options?: unknown, paneIndex?: number) =>
            chart.addSeries(definition, options, paneIndex ?? index);
        }
        if (prop === 'priceScale') {
          return (scaleId: string, paneIndex?: number) =>
            chart.priceScale(scaleId, paneIndex ?? index);
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

  destroy(): void {
    this.ids.clear();
    try {
      this.chart.remove();
    } catch {
      /* already gone */
    }
  }
}
