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
 * On-chain **event markers** on the price pane.
 *
 * Strategy / plotshape / debug-pin markers live on the candle series via
 * {@link PaneManager.setTradeMarkers} / `setShapeMarkers` / `setDebugPinMarkers`
 * (merged in one `createSeriesMarkers` plugin). That path has **no** dedicated
 * owner slot for on-chain events — calling `setSeriesMarkers` on the candle
 * would wipe strategy markers.
 *
 * This module therefore attaches markers to a **dedicated invisible line
 * series** (`{@link ONCHAIN_EVENTS_SERIES_KEY}`) on the price pane. Strategy
 * trade markers and on-chain event markers coexist without sharing plugin
 * state.
 *
 * Note: the series key is under `onchain_*`. {@link clearOnchainOverlays} /
 * {@link applyOnchainOverlays} must skip this key (see onchain-overlay) so
 * scalar-line diffs do not destroy the events host series.
 *
 * @module chart/onchain-events
 */

import {
  createSeriesMarkers,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { PaneManager } from './pane-manager';
import { createLineSeries, VOID } from './series-factory';
import { store } from '../store';

/**
 * Price-pane series key for the invisible marker host.
 * Prefixed `onchain_` for discoverability; reserved — not a scalar overlay.
 */
export const ONCHAIN_EVENTS_SERIES_KEY = 'onchain_events';

/** Hard cap — newest events win when over limit. */
const MAX_ONCHAIN_EVENT_MARKERS = 200;

export type OnchainEventMarker = {
  time: number;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'circle' | 'arrowUp' | 'arrowDown' | 'square';
  text?: string;
};

/** Loose event row from manager / dataset (sibling agent may refine). */
export type OnchainEventInput = {
  time: number;
  type?: string;
  title?: string;
  severity?: string;
  price?: number;
};

type HostState = {
  series: ISeriesApi<'Line'>;
  markers: ISeriesMarkersPluginApi<any>;
};

/** Per-manager host series + markers plugin (not on the candle). */
const hostByManager = new WeakMap<object, HostState>();

const SEVERITY_COLOR: Record<string, string> = {
  critical: VOID.down,
  warn: '#e8a03a',
  warning: '#e8a03a',
  info: VOID.indigo,
};

function colorForEvent(ev: OnchainEventInput): string {
  const sev = String(ev.severity || '').toLowerCase();
  if (sev && SEVERITY_COLOR[sev]) return SEVERITY_COLOR[sev]!;
  const t = String(ev.type || '').toLowerCase();
  if (t.includes('liq') || t.includes('hack') || t.includes('exploit')) {
    return VOID.down;
  }
  if (t.includes('mint') || t.includes('deposit') || t.includes('inflow')) {
    return VOID.up;
  }
  if (t.includes('burn') || t.includes('withdraw') || t.includes('outflow')) {
    return '#e8a03a';
  }
  return VOID.indigo;
}

function shapeForEvent(
  ev: OnchainEventInput,
): OnchainEventMarker['shape'] {
  const t = String(ev.type || '').toLowerCase();
  if (
    t.includes('liq') ||
    t.includes('burn') ||
    t.includes('withdraw') ||
    t.includes('outflow') ||
    t.includes('short')
  ) {
    return 'arrowDown';
  }
  if (
    t.includes('mint') ||
    t.includes('deposit') ||
    t.includes('inflow') ||
    t.includes('long')
  ) {
    return 'arrowUp';
  }
  if (t.includes('transfer') || t.includes('swap')) {
    return 'square';
  }
  return 'circle';
}

function positionForEvent(
  ev: OnchainEventInput,
  shape: OnchainEventMarker['shape'],
): OnchainEventMarker['position'] {
  const sev = String(ev.severity || '').toLowerCase();
  if (sev === 'critical' || shape === 'arrowDown') return 'belowBar';
  if (shape === 'arrowUp') return 'aboveBar';
  return 'aboveBar';
}

function labelForEvent(ev: OnchainEventInput): string | undefined {
  const title = (ev.title && String(ev.title).trim()) || '';
  if (title) return title.length > 24 ? `${title.slice(0, 23)}…` : title;
  const type = (ev.type && String(ev.type).trim()) || '';
  return type || undefined;
}

/**
 * Map raw on-chain events to LWC-compatible marker specs.
 * Caps at {@link MAX_ONCHAIN_EVENT_MARKERS} (newest kept).
 */
export function eventsToMarkers(
  events: OnchainEventInput[],
): OnchainEventMarker[] {
  if (!events?.length) return [];

  const valid: OnchainEventInput[] = [];
  for (const ev of events) {
    if (!ev || !Number.isFinite(ev.time)) continue;
    valid.push(ev);
  }
  if (!valid.length) return [];

  // Ascending by time; when over cap keep the newest slice
  valid.sort((a, b) => a.time - b.time || 0);
  const slice =
    valid.length > MAX_ONCHAIN_EVENT_MARKERS
      ? valid.slice(valid.length - MAX_ONCHAIN_EVENT_MARKERS)
      : valid;

  const out: OnchainEventMarker[] = [];
  for (const ev of slice) {
    const shape = shapeForEvent(ev);
    out.push({
      time: ev.time,
      position: positionForEvent(ev, shape),
      color: colorForEvent(ev),
      shape,
      text: labelForEvent(ev),
    });
  }
  return out;
}

function closeByTime(): Map<number, number> {
  const map = new Map<number, number>();
  try {
    const bars = store.bars;
    if (!Array.isArray(bars)) return map;
    for (const b of bars) {
      if (!b || !Number.isFinite(b.time) || !Number.isFinite(b.close)) continue;
      map.set(b.time as number, b.close as number);
    }
  } catch {
    /* store optional in unit tests */
  }
  return map;
}

function ensureHostSeries(
  manager: PaneManager,
): { pane: NonNullable<ReturnType<PaneManager['getPane']>>; series: ISeriesApi<'Line'> } | null {
  const pane = manager.getPane('price');
  if (!pane) return null;

  const existing = pane.series[ONCHAIN_EVENTS_SERIES_KEY] as
    | ISeriesApi<'Line'>
    | undefined;
  if (existing) {
    return { pane, series: existing };
  }

  const series = createLineSeries(
    pane.chart,
    '',
    'rgba(0,0,0,0)',
    undefined,
    1,
  );
  try {
    series.applyOptions({
      color: 'rgba(0,0,0,0)',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      title: '',
      // Sit on the main right scale so markers align with OHLC vertically
      priceScaleId: 'right',
    });
  } catch {
    /* ignore */
  }
  pane.series[ONCHAIN_EVENTS_SERIES_KEY] = series;
  // Stale plugin if series was recreated
  hostByManager.delete(manager);
  return { pane, series };
}

/**
 * Apply on-chain event markers on a dedicated invisible line series.
 * Does **not** touch candle trade / shape / debug-pin marker lists.
 */
export function applyOnchainEventMarkers(
  manager: PaneManager | undefined | null,
  events: OnchainEventInput[] | null | undefined,
): void {
  if (!manager) return;
  if (!events?.length) {
    clearOnchainEventMarkers(manager);
    return;
  }

  const markers = eventsToMarkers(events);
  if (!markers.length) {
    clearOnchainEventMarkers(manager);
    return;
  }

  const host = ensureHostSeries(manager);
  if (!host) return;
  const { series } = host;

  // Host line needs a value at each marker time (markers anchor to series points)
  const closes = closeByTime();
  const byTime = new Map<number, number>();
  for (const ev of events) {
    if (!ev || !Number.isFinite(ev.time)) continue;
    if (Number.isFinite(ev.price as number)) {
      byTime.set(ev.time, ev.price as number);
      continue;
    }
    if (!byTime.has(ev.time)) {
      const c = closes.get(ev.time);
      byTime.set(ev.time, c !== undefined ? c : 0);
    }
  }
  // Ensure every marker time has a point
  for (const m of markers) {
    if (!byTime.has(m.time)) {
      const c = closes.get(m.time);
      byTime.set(m.time, c !== undefined ? c : 0);
    }
  }

  const data = Array.from(byTime.entries())
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));

  try {
    series.setData(data);
  } catch {
    /* disposed / thrash */
    hostByManager.delete(manager);
    return;
  }

  const seriesMarkers: SeriesMarker<UTCTimestamp>[] = markers.map((m, i) => ({
    time: m.time as UTCTimestamp,
    position: m.position,
    color: m.color,
    shape: m.shape,
    text: m.text || '',
    id: `onchain_ev_${m.time}_${i}`,
  }));

  let state = hostByManager.get(manager);
  try {
    if (!state || state.series !== series) {
      const plugin = createSeriesMarkers(series, seriesMarkers);
      state = { series, markers: plugin };
      hostByManager.set(manager, state);
    } else {
      state.markers.setMarkers(seriesMarkers);
    }
  } catch {
    // Series may have been removed mid-swap
    hostByManager.delete(manager);
    try {
      const plugin = createSeriesMarkers(series, seriesMarkers);
      hostByManager.set(manager, { series, markers: plugin });
    } catch {
      /* give up this frame */
    }
  }
}

/**
 * Remove on-chain event marker host series + plugin from the price pane.
 * Safe no-op when missing. Does not clear strategy / plotshape markers.
 */
export function clearOnchainEventMarkers(
  manager: PaneManager | undefined | null,
): void {
  if (!manager) return;
  hostByManager.delete(manager);

  const pane = manager.getPane('price');
  if (!pane) return;

  const series = pane.series[ONCHAIN_EVENTS_SERIES_KEY];
  if (!series) return;
  try {
    pane.chart.removeSeries(series);
  } catch {
    /* ignore */
  }
  delete pane.series[ONCHAIN_EVENTS_SERIES_KEY];
}
