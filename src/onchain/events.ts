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
 * On-chain **events** plane helpers (Phase 3 light).
 *
 * Phase 1.5 practical sources (no paid APIs):
 * 1. **Synthetic / derived** events from attached TVL series via
 *    {@link buildTvlSpikeEvents} (day-over-day |pct| threshold).
 * 2. DefiLlama raises / token unlocks require **Pro** endpoints
 *    (`pro-api.llama.fi`) — not implemented here; skip network and use
 *    synthetic spikes or {@link setOnchainEvents} with external data.
 *
 * @module onchain/events
 */

import type { EventPoint, TimePoint } from './types';

/** Default |day-over-day % change| threshold for TVL spike/drop events. */
export const DEFAULT_TVL_SPIKE_THRESHOLD_PCT = 10;

/** Event type for a positive TVL day-over-day jump. */
export const EVENT_TYPE_TVL_SPIKE = 'tvl_spike' as const;

/** Event type for a negative TVL day-over-day drop. */
export const EVENT_TYPE_TVL_DROP = 'tvl_drop' as const;

export type TvlSpikeEventType =
  | typeof EVENT_TYPE_TVL_SPIKE
  | typeof EVENT_TYPE_TVL_DROP;

export interface BuildTvlSpikeEventsOpts {
  /**
   * Minimum absolute day-over-day percent change to emit an event.
   * Default {@link DEFAULT_TVL_SPIKE_THRESHOLD_PCT} (10).
   */
  thresholdPct?: number;
  /**
   * Absolute |pct| at/above which severity is `critical`.
   * Default `max(thresholdPct * 2.5, 25)`.
   */
  criticalPct?: number;
  /** Optional protocol / series label for event titles. */
  protocolLabel?: string;
}

/**
 * Sort events by time ascending; stable for equal times.
 */
export function sortEventPoints(events: EventPoint[] | null | undefined): EventPoint[] {
  if (!Array.isArray(events) || !events.length) return [];
  return events
    .slice()
    .sort((a, b) => {
      const ta = Number(a?.time);
      const tb = Number(b?.time);
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return ta - tb;
    });
}

/**
 * Keep finite-time events, coerce types, drop empties, sort by time.
 */
export function normalizeEventPoints(
  events: EventPoint[] | null | undefined,
): EventPoint[] {
  if (!Array.isArray(events) || !events.length) return [];
  const out: EventPoint[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const time = Number(e.time);
    if (!Number.isFinite(time)) continue;
    const type = String(e.type || '').trim();
    if (!type) continue;
    const next: EventPoint = { time, type };
    if (e.title != null && String(e.title)) next.title = String(e.title);
    if (
      e.severity === 'info' ||
      e.severity === 'warn' ||
      e.severity === 'critical'
    ) {
      next.severity = e.severity;
    }
    if (e.price != null && Number.isFinite(Number(e.price))) {
      next.price = Number(e.price);
    }
    if (e.payload && typeof e.payload === 'object') {
      next.payload = e.payload;
    }
    out.push(next);
  }
  return sortEventPoints(out);
}

function formatPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  const abs = Math.abs(pct);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * Derive TVL spike / drop events from a scalar time series.
 *
 * For each consecutive pair of points (sorted by time), computes
 * day-over-day percent change `(curr - prev) / |prev| * 100`. When
 * `|pct| >= thresholdPct`, emits an {@link EventPoint}:
 * - `type`: `tvl_spike` (gain) or `tvl_drop` (loss)
 * - `severity`: `warn` below `criticalPct`, else `critical`
 * - `price`: current TVL value (metric scale, not price chart)
 * - `payload`: `{ pctChange, prevValue, value, absPct }`
 *
 * Skips non-finite values and zero previous values (undefined %).
 */
export function buildTvlSpikeEvents(
  points: TimePoint[] | null | undefined,
  opts?: BuildTvlSpikeEventsOpts,
): EventPoint[] {
  if (!Array.isArray(points) || points.length < 2) return [];

  const thresholdPct =
    opts?.thresholdPct != null && Number.isFinite(Number(opts.thresholdPct))
      ? Math.abs(Number(opts.thresholdPct))
      : DEFAULT_TVL_SPIKE_THRESHOLD_PCT;

  const criticalPct =
    opts?.criticalPct != null && Number.isFinite(Number(opts.criticalPct))
      ? Math.abs(Number(opts.criticalPct))
      : Math.max(thresholdPct * 2.5, 25);

  const label =
    opts?.protocolLabel != null && String(opts.protocolLabel).trim()
      ? String(opts.protocolLabel).trim()
      : '';

  const sorted = points
    .filter(
      (p) =>
        p &&
        Number.isFinite(Number(p.time)) &&
        Number.isFinite(Number(p.value)),
    )
    .map((p) => ({ time: Number(p.time), value: Number(p.value) }))
    .sort((a, b) => a.time - b.time);

  // Dedup same time — last write wins
  const series: { time: number; value: number }[] = [];
  for (const p of sorted) {
    const last = series[series.length - 1];
    if (last && last.time === p.time) {
      last.value = p.value;
    } else {
      series.push({ ...p });
    }
  }

  if (series.length < 2) return [];

  const events: EventPoint[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const curr = series[i]!;
    const denom = Math.abs(prev.value);
    if (!(denom > 0)) continue;

    const pctChange = ((curr.value - prev.value) / denom) * 100;
    if (!Number.isFinite(pctChange)) continue;
    const absPct = Math.abs(pctChange);
    if (absPct < thresholdPct) continue;

    const type: TvlSpikeEventType =
      pctChange >= 0 ? EVENT_TYPE_TVL_SPIKE : EVENT_TYPE_TVL_DROP;
    const severity: EventPoint['severity'] =
      absPct >= criticalPct ? 'critical' : 'warn';
    const pctStr = formatPct(pctChange);
    const title = label
      ? `${label} TVL ${pctStr}`
      : type === EVENT_TYPE_TVL_SPIKE
        ? `TVL spike ${pctStr}`
        : `TVL drop ${pctStr}`;

    events.push({
      time: curr.time,
      type,
      title,
      severity,
      price: curr.value,
      payload: {
        pctChange,
        absPct,
        prevValue: prev.value,
        value: curr.value,
        thresholdPct,
        criticalPct,
      },
    });
  }

  return events;
}

/**
 * Human label for synthetic TVL-spike events on an attachment.
 * e.g. `"aave TVL spikes"` or `"TVL spikes"`.
 */
export function tvlSpikeEventSourceLabel(
  protocolOrLabel?: string | null,
): string {
  const raw = protocolOrLabel != null ? String(protocolOrLabel).trim() : '';
  if (!raw) return 'TVL spikes';
  // Prefer short protocol id when label is "Foo TVL"
  const stripped = raw.replace(/\s+TVL\s*$/i, '').trim() || raw;
  return `${stripped} TVL spikes`;
}

/**
 * Note: DefiLlama **raises** and **token unlocks** are Pro API categories
 * (not free `api.llama.fi`). Phase 1.5 does not fetch them over the network.
 * Callers may inject pre-fetched points via the manager's
 * `setOnchainEvents`.
 */
export const DEFILLAMA_RAISES_UNLOCKS_NOTE =
  'DefiLlama raises/unlocks require Pro API (pro-api.llama.fi); not fetched in Phase 1.5. Use setOnchainEvents with external data or buildTvlSpikeEvents from attached TVL.';
