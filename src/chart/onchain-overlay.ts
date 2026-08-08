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
 * On-chain scalar overlays on the price pane.
 *
 * Series keys use {@link ONCHAIN_SERIES_PREFIX} so indicator
 * `syncOverlayLines` (which only manages `overlay_*`) and compare
 * (`compare` / `compare_main_pct`) will not wipe them. Shares the left
 * price scale with compare so main OHLC keeps the right scale range.
 *
 * Reserved: {@link ONCHAIN_EVENTS_SERIES_KEY} (`onchain_events`) is the
 * event-marker host from `onchain-events` — never created or removed here.
 *
 * Pure apply/clear against {@link PaneManager} — ChartHost passes data;
 * this module does not import the on-chain store.
 *
 * @module chart/onchain-overlay
 */

import type { ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { PaneManager } from './pane-manager';
import { createLineSeries, PLOT_PALETTE, VOID } from './series-factory';
import { store } from '../store';
import { ONCHAIN_EVENTS_SERIES_KEY } from './onchain-events';

/** Line series key prefix for on-chain scalars (not under `overlay_`). */
export const ONCHAIN_SERIES_PREFIX = 'onchain_';

/** True for scalar overlay keys (excludes the event-marker host series). */
function isOnchainScalarKey(key: string): boolean {
  return (
    key.startsWith(ONCHAIN_SERIES_PREFIX) && key !== ONCHAIN_EVENTS_SERIES_KEY
  );
}

/**
 * Built-in left price scale so main OHLC on the right keeps its price range.
 * Shared with compare overlays when both are active.
 */
export const ONCHAIN_PRICE_SCALE_ID = 'left';

/** Hard cap — ignore additional lines for chart safety. */
const MAX_ONCHAIN_LINES = 8;

export type OnchainLineSpec = {
  /** Must be `onchain_*` (normalized if missing prefix). */
  key: string;
  title: string;
  color: string;
  points: Array<{ time: number; value: number }>;
  visible?: boolean;
};

function normalizeKey(key: string): string {
  const k = (key || '').trim();
  if (!k) return '';
  return k.startsWith(ONCHAIN_SERIES_PREFIX) ? k : `${ONCHAIN_SERIES_PREFIX}${k}`;
}

function lastValueLabelsOn(): boolean {
  try {
    return store.lastValueLabelsVisible !== false;
  } catch {
    return true;
  }
}

function ensureOnchainLine(
  pane: NonNullable<ReturnType<PaneManager['getPane']>>,
  key: string,
  title: string,
  color: string,
  priceScaleId: string,
): ISeriesApi<'Line'> {
  const lastValueVisible = lastValueLabelsOn();
  const existing = pane.series[key] as ISeriesApi<'Line'> | undefined;
  if (existing) {
    try {
      existing.applyOptions({
        color,
        title,
        priceScaleId,
        lastValueVisible,
        priceLineVisible: false,
      });
    } catch {
      /* ignore */
    }
    return existing;
  }
  const series = createLineSeries(pane.chart, title, color, undefined, 2);
  try {
    series.applyOptions({
      priceScaleId,
      lastValueVisible,
      priceLineVisible: false,
      title,
      color,
    });
  } catch {
    /* ignore */
  }
  pane.series[key] = series;
  return series;
}

function configureOnchainScale(
  pane: NonNullable<ReturnType<PaneManager['getPane']>>,
  scaleId: string,
): void {
  try {
    pane.chart.priceScale(scaleId).applyOptions({
      visible: true,
      borderVisible: true,
      borderColor: VOID.border,
      textColor: VOID.textDim,
      scaleMargins: { top: 0.08, bottom: 0.12 },
      entireTextOnly: false,
      minimumWidth: 72,
    });
  } catch {
    /* ignore */
  }
}

/**
 * Remove all price-pane **scalar** series under {@link ONCHAIN_SERIES_PREFIX}.
 * Skips {@link ONCHAIN_EVENTS_SERIES_KEY} (event-marker host — owned by
 * onchain-events). Does not hide the left scale (compare may still own it).
 */
export function clearOnchainOverlays(
  manager: PaneManager | undefined | null,
): void {
  if (!manager) return;
  const pane = manager.getPane('price');
  if (!pane) return;
  const keys = Object.keys(pane.series).filter(isOnchainScalarKey);
  for (const key of keys) {
    const series = pane.series[key];
    if (!series) continue;
    try {
      pane.chart.removeSeries(series);
    } catch {
      /* ignore */
    }
    delete pane.series[key];
  }
}

/**
 * Create/update on-chain line series on the price pane.
 * Diffs by key: ensures listed series, removes stale `onchain_*` keys.
 * Caps at 8 lines. Call {@link clearOnchainOverlays} when none remain.
 */
export function applyOnchainOverlays(
  manager: PaneManager | undefined | null,
  lines: OnchainLineSpec[],
): void {
  if (!manager) return;
  const pane = manager.getPane('price');
  if (!pane) return;

  const specs: OnchainLineSpec[] = [];
  const seen = new Set<string>();
  for (const raw of lines || []) {
    if (specs.length >= MAX_ONCHAIN_LINES) break;
    if (raw.visible === false) continue;
    const key = normalizeKey(raw.key);
    if (!key || seen.has(key)) continue;
    const pts = raw.points;
    if (!pts?.length) continue;
    seen.add(key);
    specs.push({
      key,
      title: (raw.title || key).trim() || key,
      color:
        (raw.color && String(raw.color).trim()) ||
        PLOT_PALETTE[specs.length % PLOT_PALETTE.length] ||
        VOID.indigo,
      points: pts,
      visible: true,
    });
  }

  if (!specs.length) {
    clearOnchainOverlays(manager);
    return;
  }

  const want = new Set(specs.map((s) => s.key));
  // Remove scalar series no longer in the desired set (keep event-marker host)
  for (const key of Object.keys(pane.series)) {
    if (!isOnchainScalarKey(key)) continue;
    if (want.has(key)) continue;
    const series = pane.series[key];
    if (!series) {
      delete pane.series[key];
      continue;
    }
    try {
      pane.chart.removeSeries(series);
    } catch {
      /* ignore */
    }
    delete pane.series[key];
  }

  const scaleId = ONCHAIN_PRICE_SCALE_ID;

  for (const spec of specs) {
    const series = ensureOnchainLine(
      pane,
      spec.key,
      spec.title,
      spec.color,
      scaleId,
    );
    // Finite-only line data — LWC rejects NaN/Infinity
    const data = spec.points
      .filter((d) => Number.isFinite(d.time) && Number.isFinite(d.value))
      .map((d) => ({ time: d.time as UTCTimestamp, value: d.value }));
    try {
      series.setData(data);
      if (spec.visible === false) {
        series.applyOptions({ visible: false });
      } else {
        series.applyOptions({ visible: true });
      }
    } catch {
      /* disposed / thrash */
    }
  }

  configureOnchainScale(pane, scaleId);
}
