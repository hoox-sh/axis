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
import type { PlotSample } from '../plugins/types';

/** Stable prefix for cross-indicator plot refs (not a built-in OHLC name). */
export const PLOT_SOURCE_PREFIX = 'plot:';

export type IndicatorSeriesCache = Record<
  string,
  {
    name: string;
    series: Record<string, PlotSample[]>;
    /** Optional display titles from plot_meta */
    titles?: Record<string, string>;
    /**
     * Bar times the cached series was aligned to when it was written.
     *
     * The chart window slides (it drops its head on every new bar), so a
     * cached series is one bar behind the window it was written for. The
     * times make the re-alignment by **time** possible instead of the index
     * zip, which would shift every value.
     */
    times?: number[];
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
 *
 * `chartTimes` is the bar axis the consumer's engine will zip the series
 * against. A cached series carries the times it was written for; the chart
 * window slides, so the cached series is one bar behind and has to be
 * re-joined **by time** — an index zip would shift every value by the
 * slide.
 */
export function resolveInputSourceValues(
  inputs: Record<string, unknown> | undefined | null,
  cache: IndicatorSeriesCache | undefined | null,
  chartTimes?: readonly number[] | null,
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
    const entry = cache?.[ref.indicatorId];
    const series = entry?.series?.[ref.plotKey];
    if (!series || !Array.isArray(series)) {
      // Leave ref as-is; engine cannot resolve it — better a soft miss than crash
      continue;
    }
    // Coerce non-finite samples so the engine never sees NaN/Infinity from a
    // stale cache entry (chart-side garbage must not poison the next run).
    const clean = series.map((sample) =>
      typeof sample === 'number' && Number.isFinite(sample) ? sample : null,
    );
    // Re-join by time when both axes are known: the cached series was written
    // for an older window (the chart slides), so the index positions moved.
    const cachedTimes = entry?.times;
    if (cachedTimes?.length && chartTimes?.length) {
      out[k] = rejoinByTime(clean, cachedTimes, chartTimes);
    } else {
      out[k] = clean;
    }
    changed = true;
  }
  return changed ? out : inputs;
}

/**
 * Re-join a cached series onto the chart's bar axis by **time**.
 *
 * Values whose bar time is no longer in the window are dropped; bars the
 * cached series does not cover yet become `null` (Pine `na`).
 */
function rejoinByTime(
  values: (number | null)[],
  cachedTimes: readonly number[],
  chartTimes: readonly number[],
): (number | null)[] {
  const byTime = new Map<number, number | null>();
  for (let i = 0; i < cachedTimes.length; i++) {
    const t = cachedTimes[i];
    if (typeof t !== 'number' || !Number.isFinite(t)) continue;
    byTime.set(t, values[i] ?? null);
  }
  const out: (number | null)[] = [];
  for (const t of chartTimes) {
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      out.push(null);
      continue;
    }
    out.push(byTime.has(t) ? (byTime.get(t) ?? null) : null);
  }
  return out;
}

/**
 * Group indicators into dependency levels so producers of plot sources run
 * before consumers while independent scripts in the same level can run
 * together. Level 0 holds scripts with no plot-source deps on the group;
 * each higher level depends only on strictly lower levels, so levels run in
 * ascending order (sequentially) with bounded concurrency *within* a level.
 * Original order is preserved inside a level. Cycles fall back to level 0
 * for the cyclic members (same spirit as {@link orderIndicatorsByPlotDeps}).
 */
export function groupIndicatorsByPlotDepLevel<
  T extends { id: string; inputValues?: Record<string, unknown> },
>(indicators: T[]): T[][] {
  if (!indicators.length) return [];
  if (indicators.length === 1) return [indicators.slice()];
  const byId = new Map(indicators.map((i) => [i.id, i]));
  const depth = new Map<string, number>();
  const visit = (id: string, stack: Set<string>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const ind = byId.get(id);
    if (!ind || stack.has(id)) return 0;
    stack.add(id);
    let d = 0;
    const vals = ind.inputValues || {};
    for (const v of Object.values(vals)) {
      const ref = parsePlotSourceId(v);
      if (!ref || ref.indicatorId === id || !byId.has(ref.indicatorId)) continue;
      d = Math.max(d, visit(ref.indicatorId, stack) + 1);
    }
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const ind of indicators) visit(ind.id, new Set());
  const levels = new Map<number, T[]>();
  for (const ind of indicators) {
    const d = depth.get(ind.id) ?? 0;
    const list = levels.get(d);
    if (list) list.push(ind);
    else levels.set(d, [ind]);
  }
  return [...levels.keys()]
    .sort((a, b) => a - b)
    .map((k) => levels.get(k)!);
}

/**
 * Map `items` through `fn` in bounded-concurrency chunks (order-preserving).
 * A middle ground between serial `for await` (N round-trips of latency) and
 * unbounded `Promise.all` (N sockets at once): each chunk of `limit` runs
 * together, chunks run sequentially. `fn` should not reject — wrap fallible
 * work inside it, because a rejection aborts the remaining chunks (already
 * resolved chunk results are still returned by the caller).
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = Math.max(1, Math.floor(limit) || 1);
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += n) {
    const chunk = items.slice(i, i + n);
    const results = await Promise.all(chunk.map((item, j) => fn(item, i + j)));
    for (let j = 0; j < results.length; j++) out[i + j] = results[j]!;
  }
  return out;
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
