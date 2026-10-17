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
 * Stale-engine-series notice + repair glue for the live paint paths.
 *
 * Both engine-owned paint paths (calculator `chart-data-session` paints in
 * `streams/multiplex`, stream `series` snapshots in `streams/stream-live`) can
 * observe the same failure: the engine's series is *behind* the chart tail or
 * the market, so painting it would back-date the chart and re-open the same
 * stale window on every tick. This module is the single place that reports that
 * state (log + engine telemetry + feed status) and asks the engine data broker
 * to repair the series from AXIS' own dataset ({@link repairStaleEngineSeries}).
 *
 * Reporting is throttled to one line per minute per series+reason; the repair
 * itself is cooldown-guarded inside the broker, so callers may invoke this on
 * every venue tick.
 *
 * @module engines/series-repair
 */

import { appendLog, setFeedStatus, setTelemetryState } from '../store';
import type { Bar } from '../store/types';
import { currentSeriesKey } from '../engine/market-identity';
import { FALLBACK_MAJORS } from '../data/symbol-catalog';
import {
  engineWindowBehindChart,
  newestBarTime,
  seriesBehind,
  stepsBehind,
} from './series-freshness';
import {
  repairStaleEngineSeries,
  type DataSeriesKey,
  type SeriesRepairResult,
} from './data-sessions';

/** Minimum gap between "engine series stale" log lines for one series (ms). */
export const ENGINE_STALE_LOG_MIN_MS = 60_000;

let staleLoggedAt = 0;
let staleLoggedSig = '';

/** @internal test helper — clear the log throttle. */
export function _resetEngineStaleNoticeForTests(): void {
  staleLoggedAt = 0;
  staleLoggedSig = '';
}

export interface StaleEngineSeriesNotice {
  /** Venue id (canonical, lowercase) of the chart series. */
  exchange: string;
  /** Chart symbol (load form; the feed key pair-forms it via the catalog). */
  symbol: string;
  interval: string;
  /** Newest bar the engine handed us (null when it reported none). */
  engineNewest: number | null;
  /** Short human reason appended to the log line (e.g. `behind by 6658 bars`). */
  reason: string;
  /** Repair transport — endpoint + key + window to push/ask for. */
  repair: {
    endpoint: string;
    apiKey: string;
    key: DataSeriesKey;
    /** Window to push/ask for. Defaults to the broker's window. */
    historyBars?: number;
    signal?: AbortSignal;
  };
}

/**
 * Classify a hand-off from the engine's series: a short human reason when the
 * window must **not** be painted, or `null` when it is safe.
 *
 * Two independent failures:
 *
 * - **Behind the chart tail** — the engine's window is older than what the chart
 *   already holds (the Data Manager / venue path is fresher). Painting would
 *   back-date the chart and re-open the same window on every tick.
 * - **Behind the market** — with a venue `marketNow` clock (the newest trigger
 *   the caller just flushed), the engine's series stopped advancing while the
 *   venue kept trading. A `marketNow` of `0` means unknown and skips this test
 *   entirely, so session venues (equities / FX holding their last close) are
 *   never accused of being frozen; chart-tail staleness still applies.
 */
export function engineSeriesStale(input: {
  chartBars: readonly Bar[] | null | undefined;
  engineBars: readonly Bar[] | null | undefined;
  interval: string;
  /** Newest venue trigger time (unix sec); `0`/omitted = unknown. */
  marketNow?: number;
}): string | null {
  const behindChart = engineWindowBehindChart(input.chartBars, input.engineBars, input.interval);
  const marketNow = Math.max(0, Math.floor(input.marketNow ?? 0));
  const engineNewest = newestBarTime(input.engineBars);
  const behindMarket =
    marketNow > 0 && seriesBehind(engineNewest, marketNow, input.interval);
  if (!behindChart && !behindMarket) return null;
  const lag = behindChart
    ? stepsBehind(engineNewest, newestBarTime(input.chartBars), input.interval)
    : stepsBehind(engineNewest, marketNow, input.interval);
  return behindChart
    ? `behind the chart tail by ${lag} bars`
    : `behind the market by ${lag} bars`;
}

/**
 * Report a stale engine series and repair it in the background.
 *
 * Never throws and never blocks: the caller keeps whatever the chart already
 * holds (the fresher local series) while the engine's series is re-provisioned;
 * the next snapshot/tick paints the healed window.
 */
export function noteStaleEngineSeries(opts: StaleEngineSeriesNotice): void {
  let seriesKey = '';
  try {
    seriesKey = currentSeriesKey({
      exchange: opts.exchange,
      symbol: opts.symbol,
      interval: opts.interval,
      catalog: FALLBACK_MAJORS,
    });
  } catch {
    seriesKey = `${opts.exchange}|spot|${opts.symbol}|${opts.interval}`;
  }

  const sig = `${seriesKey}|${opts.reason}`;
  const nowMs = Date.now();
  if (sig !== staleLoggedSig || nowMs - staleLoggedAt > ENGINE_STALE_LOG_MIN_MS) {
    staleLoggedSig = sig;
    staleLoggedAt = nowMs;
    const newest = opts.engineNewest
      ? new Date(opts.engineNewest * 1000).toISOString()
      : 'unknown';
    try {
      appendLog(
        'warn',
        `Engine series stale (newest ${newest}, ${opts.reason}) — repairing ${opts.symbol} ${opts.interval} from AXIS data`,
        'engine',
        { toast: false },
      );
      setTelemetryState('engine', 'degraded', {
        detail: `stale series · ${opts.symbol} ${opts.interval}`,
        error: null,
      });
      setFeedStatus(seriesKey, 'degraded', { message: 'engine series stale — repairing' });
    } catch {
      /* telemetry/log is best-effort */
    }
  }

  // No endpoint ⇒ nothing to repair against (engine unconfigured): keep the
  // notice in the log/telemetry, skip the broker call.
  if (!opts.repair.endpoint) return;

  void repairStaleEngineSeries({
    endpoint: opts.repair.endpoint,
    apiKey: opts.repair.apiKey,
    key: opts.repair.key,
    historyBars: opts.repair.historyBars,
    signal: opts.repair.signal,
  })
    .then((result: SeriesRepairResult) => {
      if (!result.repaired) return;
      try {
        appendLog(
          'ok',
          `Engine series repaired (${result.via === 'local' ? `${result.bars} local bars` : 'engine fetch'}) · ${opts.symbol} ${opts.interval}`,
          'engine',
          { toast: false },
        );
        setTelemetryState('engine', 'open', {
          detail: `${opts.symbol} ${opts.interval} · series repaired (${result.via})`,
          error: null,
        });
        setFeedStatus(seriesKey, 'live', { message: 'engine series repaired' });
      } catch {
        /* telemetry/log is best-effort */
      }
    })
    .catch(() => {
      /* repair never rejects; belt-and-braces */
    });
}
