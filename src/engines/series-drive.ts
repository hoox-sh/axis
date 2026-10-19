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
 * Engine-series drive for the stream plane (`live_stream`).
 *
 * The stream plane paints the engine's `series` replica: whatever the engine's
 * series holds is what the chart shows. The wire can only **replicate** that
 * series — its client frames are `subscribe` / `resume` / `repair` / `ping`,
 * with no client-side tick — so a subscription that is merely re-read advances
 * nothing on its own. The calculator plane (`engines/chart-data-session.ts`)
 * advances its series with a REST `POST /data/session/{id}/tick` per venue
 * flush; the stream plane had no equivalent.
 *
 * Consequence, observed live on a 1m series: when the engine's own per-tick
 * scheduler stalls (`GET /data/series` `newest` frozen three bars behind the
 * venue) the chart stayed pinned to that frozen tail, because the only mover
 * left was the staleness verdict + repair broker — `ENGINE_SERIES_STALE_STEPS`
 * (3) whole steps behind, `SERIES_REPAIR_COOLDOWN_MS` (60s) apart. On 1m that
 * is a chart that jumps one bar every ~3 minutes and is never live.
 *
 * This module is the missing drive: a throttled chart-session tick that asks
 * the engine to fetch and append its own bars, so the replica the chart paints
 * advances with the venue. It stays engine-owned (the engine still owns the
 * series and its own upstream), and the staleness report + repair broker stays
 * the backstop for engines that cannot be driven (no `data_session`) or whose
 * feed really is dead (the tick envelope's `stale`).
 *
 * @module engines/series-drive
 */

import { tickChartDataSession } from './chart-data-session';
import type { DataSeriesKey } from './data-sessions';

/**
 * Minimum gap between automatic drives for one engine+series (ms).
 *
 * Mirrors the calculator plane's paint throttle
 * (`ENGINE_OWNED_TICK_MIN_MS`): the engine's tick costs it an upstream fetch,
 * so the drive is bounded to one per gap while still landing inside a bar. A
 * **new venue bar** bypasses the gap so a closed bar reaches the replica
 * without waiting it out.
 */
export const SERIES_DRIVE_MIN_MS = 10_000;

/** Outcome of one {@link driveEngineSeries} call. */
export type SeriesDriveResult = 'ticked' | 'skipped' | 'failed' | 'stale';

/** Tick outcome shape (subset of `tickChartDataSession`'s envelope). */
export interface SeriesDriveTick {
  ok: boolean;
  stale?: boolean;
  unchanged?: boolean;
  appended?: number;
  error?: string;
}

export type SeriesDriveTickFn = (
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
) => Promise<SeriesDriveTick>;

export interface SeriesDriveOptions {
  endpoint: string;
  apiKey: string;
  key: DataSeriesKey;
  /** Newest venue trigger bar time (unix sec) the caller just flushed; 0 = unknown. */
  marketNow?: number;
  /** Clock seam (tests). */
  nowMs?: number;
  /** Minimum-gap override (tests). */
  minGapMs?: number;
  /** Tick transport override (tests). */
  tick?: SeriesDriveTickFn;
  /**
   * Series depth the engine session must hold. The chart's window is the
   * default — a session provisioned for a smaller depth cannot serve the
   * window the chart shows.
   */
  historyBars?: number;
}

const driveAt = new Map<string, number>();
const drivenBar = new Map<string, number>();

function memoKey(endpoint: string, key: DataSeriesKey): string {
  return [
    endpoint.replace(/\/+$/, ''),
    key.exchange ?? '',
    key.market ?? 'spot',
    key.symbol ?? '',
    key.interval ?? '',
  ]
    .join('|')
    .toLowerCase();
}

/** @internal test helper — clear the per-series drive throttle. */
export function _resetSeriesDriveForTests(): void {
  driveAt.clear();
  drivenBar.clear();
}

/**
 * Ask the engine to advance the series the chart paints.
 *
 * Never throws and never rejects: a failed drive leaves the engine's series
 * exactly as the staleness report + repair broker found it. Callers get the
 * outcome so a `stale` tick (the engine accepted the request but its own feed
 * advanced nothing) can be reported through that broker.
 */
export async function driveEngineSeries(opts: SeriesDriveOptions): Promise<SeriesDriveResult> {
  const endpoint = String(opts.endpoint || '').trim();
  if (!endpoint) return 'skipped';
  const memo = memoKey(endpoint, opts.key);
  const now = Math.floor(opts.nowMs ?? Date.now());
  const minGap = Math.max(0, Math.floor(opts.minGapMs ?? SERIES_DRIVE_MIN_MS));
  const marketNow = Math.max(0, Math.floor(opts.marketNow ?? 0));

  // A new venue bar always drives; otherwise the gap bounds the cadence.
  const barAdvanced = marketNow > 0 && marketNow > (drivenBar.get(memo) ?? 0);
  if (!barAdvanced && now - (driveAt.get(memo) ?? 0) < minGap) return 'skipped';
  driveAt.set(memo, now);
  if (barAdvanced) drivenBar.set(memo, marketNow);

  const depth = Math.max(1, Math.floor(opts.historyBars ?? 0)) || undefined;
  const tick =
    opts.tick ??
    ((ep: string, apiKey: string, key: DataSeriesKey) =>
      tickChartDataSession(ep, apiKey, key, depth));
  try {
    const t = await tick(endpoint, String(opts.apiKey || ''), opts.key);
    if (!t.ok) return 'failed';
    return t.stale === true ? 'stale' : 'ticked';
  } catch {
    return 'failed';
  }
}
