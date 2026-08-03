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
 * ThemeManager — coordinates document CSS, registered charts, and price series.
 *
 * Chart hosts register with {@link ThemeManager.registerChart}; store updates
 * call {@link ThemeManager.setState} which fans out apply.
 *
 * @module theme/manager
 */

import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  applyThemeToChart,
  applyThemeToDocument,
  applyThemeToPriceSeries,
  pineHostColors,
  tokensToVoidLike,
  volumeColors,
} from './apply';
import { pineColorMap } from './catalog';
import {
  defaultChartThemeState,
  getColor,
  getToken,
  resolveTokens,
  serializeTheme,
  withPreset,
  withTokenOverride,
} from './resolve';
import type {
  ApplyChartThemeOpts,
  ChartThemeState,
  ThemeTokenValue,
  ThemeTokens,
} from './types';

export type ThemeListener = (state: ChartThemeState, tokens: ThemeTokens) => void;

interface RegisteredChart {
  chart: IChartApi;
  opts: ApplyChartThemeOpts;
}

interface RegisteredSeries {
  series: ISeriesApi<any>;
  chartType: string;
}

/**
 * Singleton coordinator for chart themes.
 * Does not own the Solid store — store calls `setState` after mutations.
 */
export class ThemeManager {
  private state: ChartThemeState = defaultChartThemeState();
  private charts = new Map<string, RegisteredChart>();
  private series = new Map<string, RegisteredSeries>();
  private listeners = new Set<ThemeListener>();
  private chartSeq = 0;
  private seriesSeq = 0;

  getState(): ChartThemeState {
    return serializeTheme(this.state);
  }

  getTokens(): ThemeTokens {
    return resolveTokens(this.state);
  }

  /** Pine host colors for run payloads / docs. */
  getPineColors(): ReturnType<typeof pineHostColors> {
    return pineHostColors(this.state);
  }

  /** VOID-compatible palette snapshot from current tokens. */
  getVoidLike(): ReturnType<typeof tokensToVoidLike> {
    return tokensToVoidLike(this.getTokens());
  }

  getVolumeColors(): { up: string; down: string } {
    return volumeColors(this.state);
  }

  get(key: string): ThemeTokenValue {
    return getToken(this.state, key);
  }

  getColor(key: string): string {
    return getColor(this.state, key);
  }

  /**
   * Replace full theme state (from store hydration or save).
   * Applies to document + all registered charts/series.
   */
  setState(state: ChartThemeState, opts?: { skipDocument?: boolean }): void {
    this.state = serializeTheme(state);
    if (!opts?.skipDocument) {
      applyThemeToDocument(this.state);
    }
    this.reapplyAll();
    this.emit();
  }

  /** Apply a named preset. */
  applyPreset(presetId: string): ChartThemeState {
    const next = withPreset(presetId);
    this.setState(next);
    return this.getState();
  }

  /** Override one token (supports aliases like chart.color_background). */
  setToken(key: string, value: ThemeTokenValue): ChartThemeState {
    const next = withTokenOverride(this.state, key, value);
    this.setState(next);
    return this.getState();
  }

  /**
   * Register a chart for live theme updates.
   * @returns unregister function
   */
  registerChart(chart: IChartApi, opts: ApplyChartThemeOpts = {}): () => void {
    const id = `c${++this.chartSeq}`;
    this.charts.set(id, { chart, opts });
    applyThemeToChart(chart, this.state, opts);
    return () => {
      this.charts.delete(id);
    };
  }

  /**
   * Register main price series for live theme updates.
   * @returns unregister function
   */
  registerPriceSeries(series: ISeriesApi<any>, chartType: string): () => void {
    const id = `s${++this.seriesSeq}`;
    this.series.set(id, { series, chartType });
    applyThemeToPriceSeries(series, this.state, { chartType });
    return () => {
      this.series.delete(id);
    };
  }

  /** Update chart type for a registered series (after type switch). */
  updateSeriesType(series: ISeriesApi<any>, chartType: string): void {
    for (const [id, reg] of this.series) {
      if (reg.series === series) {
        this.series.set(id, { series, chartType });
        applyThemeToPriceSeries(series, this.state, { chartType });
        return;
      }
    }
  }

  reapplyAll(): void {
    for (const { chart, opts } of this.charts.values()) {
      applyThemeToChart(chart, this.state, opts);
    }
    for (const { series, chartType } of this.series.values()) {
      applyThemeToPriceSeries(series, this.state, { chartType });
    }
  }

  subscribe(fn: ThemeListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    const state = this.getState();
    const tokens = this.getTokens();
    for (const fn of this.listeners) {
      try {
        fn(state, tokens);
      } catch {
        /* listener errors must not break theme apply */
      }
    }
  }
}

let singleton: ThemeManager | null = null;

/** Process-wide ThemeManager (charts register here). */
export function getThemeManager(): ThemeManager {
  if (!singleton) singleton = new ThemeManager();
  return singleton;
}

/** Test helper — drop singleton. */
export function resetThemeManagerForTests(): void {
  singleton = null;
}

// Re-export pine map helper for convenience
export { pineColorMap };
