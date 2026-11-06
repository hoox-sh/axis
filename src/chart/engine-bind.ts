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
 * Chart generation engine bind (PR-C) — drop old data/live sessions and the
 * `/ws/live` wire before scripts reapply for generation G. Live resubscribe
 * happens after {@link revealChart} via {@link startLive}.
 *
 * @module chart/engine-bind
 */

import { store } from '../store';
import { pyneMarket } from '../data/provider';
import { exchangeForSource } from '../data/symbol-exchange';
import { getActiveEngineConfig } from '../plugins/active';
import { releaseChartDataSession } from '../engines/chart-data-session';
import { invalidateDataSessions, type DataSeriesKey } from '../engines/data-sessions';
import { invalidateLiveSessionsForSeries } from '../engines/live-sessions';
import {
  chartReadinessStillCurrent,
  priorChartReadinessIdentity,
  setChartReadinessPhase,
} from './readiness';

function seriesKey(symbol: string, interval: string, source: string): DataSeriesKey {
  return {
    exchange: exchangeForSource(source || store.source || 'binance-rest'),
    market: pyneMarket(store.provider?.market),
    symbol: String(symbol || ''),
    interval: String(interval || ''),
  };
}

function sameSeries(
  a: { symbol: string; interval: string },
  b: { symbol: string; interval: string },
): boolean {
  const norm = (s: string) =>
    String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  return norm(a.symbol) === norm(b.symbol) && String(a.interval) === String(b.interval);
}

/**
 * What the binding-engine phase actually did for generation G.
 * Counts are memoized engine sessions dropped for the prior/new series keys.
 */
export interface BindChartEngineResult {
  invalidatedData: number;
  invalidatedLive: number;
  releasedChartSession: boolean;
  stoppedWire: boolean;
}

/**
 * Binding-engine phase for generation G: release the chart data session,
 * invalidate memoized engine sessions for the prior and new series keys, and
 * ensure `/ws/live` is down until reveal + startLive.
 *
 * Never throws. No-op when `generation` is stale.
 */
export async function bindChartEngineForGeneration(
  generation: number,
  identity: { symbol: string; interval: string; source: string },
): Promise<BindChartEngineResult> {
  const empty: BindChartEngineResult = {
    invalidatedData: 0,
    invalidatedLive: 0,
    releasedChartSession: false,
    stoppedWire: false,
  };
  if (!chartReadinessStillCurrent(generation)) return empty;

  setChartReadinessPhase(generation, 'binding-engine');

  let releasedChartSession = false;
  try {
    releaseChartDataSession();
    releasedChartSession = true;
  } catch {
    /* ignore */
  }

  let stoppedWire = false;
  try {
    const { streamStop } = await import('../streams/stream-live');
    streamStop();
    stoppedWire = true;
  } catch {
    /* ignore */
  }

  const cfg = getActiveEngineConfig() || {};
  const endpoint = String(cfg['endpoint'] || store.endpoint || '')
    .trim()
    .replace(/\/$/, '');
  let invalidatedData = 0;
  let invalidatedLive = 0;
  if (endpoint) {
    const keys: DataSeriesKey[] = [seriesKey(identity.symbol, identity.interval, identity.source)];
    const prior = priorChartReadinessIdentity();
    if (prior && (prior.symbol || prior.interval) && !sameSeries(prior, identity)) {
      keys.push(seriesKey(prior.symbol, prior.interval, prior.source || identity.source));
    }
    for (const key of keys) {
      if (!key.symbol || !key.interval) continue;
      try {
        invalidatedData += invalidateDataSessions(endpoint, key);
      } catch {
        /* ignore */
      }
      try {
        invalidatedLive += invalidateLiveSessionsForSeries(endpoint, key.symbol, key.interval);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    invalidatedData,
    invalidatedLive,
    releasedChartSession,
    stoppedWire,
  };
}
