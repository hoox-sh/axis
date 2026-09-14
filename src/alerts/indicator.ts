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
 * Last / previous numeric samples from applied indicator plot series.
 * Used by `pine_condition` alerts (no engine import — keeps alerts pure).
 *
 * @module alerts/indicator
 */

export type PlotSampleLike = number | string | null | undefined;

export type IndicatorSeriesLike = {
  name?: string;
  series?: Record<string, PlotSampleLike[]>;
  titles?: Record<string, string>;
};

/** Compare operators offered in the Alerts panel for plot conditions. */
export const PINE_COMPARE_OPS = ['>', '>=', '<', '<=', '==', '!=', 'cross'] as const;
export type PineCompareOp = (typeof PINE_COMPARE_OPS)[number];

function coerceNumeric(v: PlotSampleLike): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    if (
      lower === 'na' ||
      lower === 'nan' ||
      lower === 'null' ||
      lower === 'none' ||
      lower === 'infinity' ||
      lower === '+infinity' ||
      lower === '-infinity'
    ) {
      return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Last finite numeric sample in a plot series (skips `na` / non-numeric).
 */
export function lastNumericSample(
  series: readonly PlotSampleLike[] | null | undefined,
): number | null {
  if (!Array.isArray(series) || series.length === 0) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    const n = coerceNumeric(series[i]);
    if (n != null) return n;
  }
  return null;
}

/**
 * Previous finite numeric sample (the one before {@link lastNumericSample}).
 */
export function prevNumericSample(
  series: readonly PlotSampleLike[] | null | undefined,
): number | null {
  if (!Array.isArray(series) || series.length < 2) return null;
  let foundLast = false;
  for (let i = series.length - 1; i >= 0; i--) {
    const n = coerceNumeric(series[i]);
    if (n == null) continue;
    if (!foundLast) {
      foundLast = true;
      continue;
    }
    return n;
  }
  return null;
}

/** Stable key for {@link EvaluateContext}.plotSamples. */
export function plotSampleKey(indicatorId: string, plotKey: string): string {
  return `${indicatorId}:${plotKey}`;
}

/**
 * Build `indicatorId:plotKey` → last/prev samples from the series cache.
 */
export function plotSamplesFromCache(
  cache: Record<string, IndicatorSeriesLike> | null | undefined,
): Record<string, { value: number; prevValue?: number }> {
  const out: Record<string, { value: number; prevValue?: number }> = {};
  if (!cache || typeof cache !== 'object') return out;
  for (const [indId, entry] of Object.entries(cache)) {
    if (!indId || !entry?.series) continue;
    for (const [plotKey, series] of Object.entries(entry.series)) {
      const value = lastNumericSample(series);
      if (value == null) continue;
      const prev = prevNumericSample(series);
      const sample: { value: number; prevValue?: number } = { value };
      if (prev != null) sample.prevValue = prev;
      out[plotSampleKey(indId, plotKey)] = sample;
    }
  }
  return out;
}

/** Plot keys available for an applied indicator (cache first, then plot map). */
export function listPlotKeys(
  indicatorId: string,
  cache: Record<string, IndicatorSeriesLike> | null | undefined,
  plots?: Record<string, unknown> | null,
): { key: string; title: string }[] {
  const titles = cache?.[indicatorId]?.titles || {};
  const seriesKeys = Object.keys(cache?.[indicatorId]?.series || {});
  const plotKeys = plots && typeof plots === 'object' ? Object.keys(plots) : [];
  const seen = new Set<string>();
  const out: { key: string; title: string }[] = [];
  for (const key of [...seriesKeys, ...plotKeys]) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: titles[key] || key });
  }
  return out;
}
