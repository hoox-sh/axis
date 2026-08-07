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
 * Cross-indicator plot sources for `input.source`.
 *
 * AXIS hosts can expose another indicator’s plot as a selectable source.
 * Values are stored as stable refs (`plot:<indicatorId>:<plotKey>`) in
 * input overrides; {@link resolveInputSourceValues} expands them to full
 * series arrays before the engine run.
 *
 * @module results/plot-sources
 */

import { store } from '../store';
import { DEFAULT_SOURCE_OPTIONS } from './script-inputs';

/** Stable prefix for cross-indicator plot refs (not a built-in OHLC name). */
export const PLOT_SOURCE_PREFIX = 'plot:';

export type IndicatorSeriesCache = Record<
  string,
  {
    name: string;
    series: Record<string, (number | null)[]>;
    /** Optional display titles from plot_meta */
    titles?: Record<string, string>;
  }
>;

export type PlotSourceOption = {
  /** Value stored in input overrides / select option */
  value: string;
  /** Human label for the dropdown */
  label: string;
  indicatorId: string;
  plotKey: string;
};

/** `plot:<indicatorId>:<plotKey>` */
export function formatPlotSourceId(indicatorId: string, plotKey: string): string {
  return `${PLOT_SOURCE_PREFIX}${indicatorId}:${plotKey}`;
}

/** Parse a plot source ref; returns null for built-in OHLC names. */
export function parsePlotSourceId(
  value: unknown,
): { indicatorId: string; plotKey: string } | null {
  if (typeof value !== 'string' || !value.startsWith(PLOT_SOURCE_PREFIX)) return null;
  const rest = value.slice(PLOT_SOURCE_PREFIX.length);
  const colon = rest.indexOf(':');
  if (colon <= 0 || colon >= rest.length - 1) return null;
  return {
    indicatorId: rest.slice(0, colon),
    plotKey: rest.slice(colon + 1),
  };
}

export function isPlotSourceRef(value: unknown): boolean {
  return parsePlotSourceId(value) != null;
}

/**
 * List plot sources from the series cache, optionally excluding one indicator
 * (the script being configured — avoids self-reference).
 */
export function listPlotSourceOptions(
  cache: IndicatorSeriesCache | undefined | null,
  excludeIndicatorId?: string | null,
): PlotSourceOption[] {
  if (!cache) return [];
  const out: PlotSourceOption[] = [];
  for (const [indId, entry] of Object.entries(cache)) {
    if (!entry || excludeIndicatorId && indId === excludeIndicatorId) continue;
    const keys = Object.keys(entry.series || {});
    for (const plotKey of keys) {
      const title = entry.titles?.[plotKey] || plotKey;
      const indName = entry.name || indId;
      out.push({
        value: formatPlotSourceId(indId, plotKey),
        label: `${indName} · ${title}`,
        indicatorId: indId,
        plotKey,
      });
    }
  }
  // Stable order: indicator name then plot key
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/**
 * Merge built-in OHLC options with cross-indicator plots for a source input.
 * Returns the option *values* (for ScriptInputDef.options) plus a label map.
 */
export function sourceOptionsWithPlots(
  cache: IndicatorSeriesCache | undefined | null,
  excludeIndicatorId?: string | null,
  base: readonly string[] = DEFAULT_SOURCE_OPTIONS,
): { options: string[]; labels: Record<string, string> } {
  const labels: Record<string, string> = {};
  for (const b of base) labels[b] = b;
  const plots = listPlotSourceOptions(cache, excludeIndicatorId);
  for (const p of plots) labels[p.value] = p.label;
  return {
    options: [...base, ...plots.map((p) => p.value)],
    labels,
  };
}

/**
 * Expand plot refs in an inputs map to full series arrays for the engine.
 * Built-in names (`close`, `hlc3`, …) pass through as strings.
 */
export function resolveInputSourceValues(
  inputs: Record<string, unknown> | undefined | null,
  cache: IndicatorSeriesCache | undefined | null,
): Record<string, unknown> | undefined {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return undefined;
  }
  const keys = Object.keys(inputs);
  if (!keys.length) return undefined;
  let changed = false;
  const out: Record<string, unknown> = { ...inputs };
  for (const [k, v] of Object.entries(inputs)) {
    const ref = parsePlotSourceId(v);
    if (!ref) continue;
    const series = cache?.[ref.indicatorId]?.series?.[ref.plotKey];
    if (!series || !Array.isArray(series)) {
      // Leave ref as-is; engine cannot resolve it — better a soft miss than crash
      continue;
    }
    // Coerce non-finite samples so the engine never sees NaN/Infinity from a
    // stale cache entry (chart-side garbage must not poison the next run).
    out[k] = series.map((sample) =>
      typeof sample === 'number' && Number.isFinite(sample) ? sample : null,
    );
    changed = true;
  }
  return changed ? out : inputs;
}

/**
 * Order indicators so producers of plot sources run before consumers.
 * Falls back to original order when no edges / cycles.
 */
export function orderIndicatorsByPlotDeps<
  T extends { id: string; inputValues?: Record<string, unknown> },
>(indicators: T[]): T[] {
  if (indicators.length <= 1) return indicators;
  const byId = new Map(indicators.map((i) => [i.id, i]));
  const ids = indicators.map((i) => i.id);
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const edges = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const ind of indicators) {
    const vals = ind.inputValues || {};
    for (const v of Object.values(vals)) {
      const ref = parsePlotSourceId(v);
      if (!ref || !byId.has(ref.indicatorId) || ref.indicatorId === ind.id) continue;
      // edge: producer → consumer
      const list = edges.get(ref.indicatorId)!;
      if (!list.includes(ind.id)) {
        list.push(ind.id);
        indeg.set(ind.id, (indeg.get(ind.id) || 0) + 1);
      }
    }
  }

  const queue = ids.filter((id) => (indeg.get(id) || 0) === 0);
  const ordered: T[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) ordered.push(node);
    for (const next of edges.get(id) || []) {
      const d = (indeg.get(next) || 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  // Cycle / orphan: append remaining in original order
  if (ordered.length < indicators.length) {
    const seen = new Set(ordered.map((i) => i.id));
    for (const ind of indicators) {
      if (!seen.has(ind.id)) ordered.push(ind);
    }
  }
  return ordered;
}

/** Convenience: list plot options from the live store cache. */
export function listStorePlotSourceOptions(excludeIndicatorId?: string | null): PlotSourceOption[] {
  return listPlotSourceOptions(store.indicatorSeries, excludeIndicatorId);
}
