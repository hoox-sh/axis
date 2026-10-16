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
 * Chart-level engine-owned data session.
 *
 * In every-tick Pro mode the chart must render the engine's series, not the
 * raw venue stream, so candles and indicator calculations stay aligned (the
 * script evaluates the same bars the user sees). The venue WS remains only a
 * *trigger*: each flush ticks this session, which advances the engine's store,
 * and the chart then re-reads the engine's bars.
 *
 * This is a bars-only session (minimal script) — separate from the
 * per-indicator sessions the runner ticks. Both are bound to the same engine
 * series, so the engine's store is the single source of truth.
 *
 * Bars for this session are re-read via `getDataSeriesBars`, which normalizes
 * engine rows through the same venue pipeline (`normalizeHistoricalBars`:
 * ms→seconds, `sanitizeBar`, dedupe last-wins, sort ascending) before they
 * reach `setBarsQuiet` / `setDataToChart`.
 *
 * @module engines/chart-data-session
 */

import {
  ensureDataSession,
  tickDataSession,
  releaseDataSession,
  type DataSeriesKey,
} from './data-sessions';

/** Minimal script: the session exists to advance the series, not to plot. */
const CHART_SCRIPT = '//@version=6\nindicator("chart-data-session")\n';

/** Default series depth requested when creating the chart session. */
const DEFAULT_HISTORY_BARS = 5_000;

interface ChartSession {
  endpoint: string;
  apiKey: string;
  key: DataSeriesKey;
  sessionId: string;
}

let current: ChartSession | null = null;

function sameKey(a: DataSeriesKey, b: DataSeriesKey): boolean {
  return (
    a.exchange === b.exchange &&
    (a.market ?? 'spot') === (b.market ?? 'spot') &&
    a.symbol === b.symbol &&
    a.interval === b.interval
  );
}

/**
 * Return the live chart session id, creating it when absent or when the
 * endpoint/identity changed. Returns null when the engine cannot provide the
 * series (the caller keeps the venue-stream paint as a fallback).
 */
export async function ensureChartDataSession(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
  historyBars: number = DEFAULT_HISTORY_BARS,
): Promise<string | null> {
  if (
    current &&
    current.endpoint === endpoint &&
    current.apiKey === apiKey &&
    sameKey(current.key, key)
  ) {
    return current.sessionId;
  }
  releaseChartDataSession();
  try {
    const handle = await ensureDataSession({
      endpoint,
      apiKey,
      key,
      historyBars,
      script: CHART_SCRIPT,
      symbol: key.symbol,
    });
    current = { endpoint, apiKey, key, sessionId: handle.sessionId };
    return handle.sessionId;
  } catch {
    current = null;
    return null;
  }
}

/**
 * Advance the engine's store for the chart series. On an expired session the
 * session is dropped so the next call recreates it; the caller may retry once.
 *
 * The tick outcome flags come straight from the engine (`appended` / `forming`
 * / `unchanged` / `stale`): callers use them to skip the bar re-read when the
 * engine reports nothing changed, or to re-read only the tail when a few bars
 * were appended — a full-window `GET /data/series/bars` per venue tick is what
 * made engine-owned live mode laggy (full 10k download + 3s tick, back to back).
 */
export async function tickChartDataSession(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
): Promise<{
  ok: boolean;
  error?: string;
  appended?: number;
  forming?: boolean;
  unchanged?: boolean;
  stale?: boolean;
}> {
  const sessionId = await ensureChartDataSession(endpoint, apiKey, key);
  if (!sessionId) return { ok: false, error: 'chart data session unavailable' };
  const t = await tickDataSession(endpoint, apiKey, sessionId, {
    exchange: key.exchange,
    symbol: key.symbol,
  });
  if (t.ok) {
    const p = t.payload as Record<string, unknown>;
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : undefined;
    const bool = (v: unknown): boolean | undefined =>
      typeof v === 'boolean' ? v : undefined;
    return {
      ok: true,
      appended: num(p.appended),
      forming: bool(p.forming),
      unchanged: bool(p.unchanged),
      stale: bool(p.stale),
    };
  }
  if (t.gone && current?.sessionId === sessionId) {
    current = null;
  }
  return { ok: false, error: t.error };
}

/** Release the chart session (symbol change, live stop, engine switch). */
export function releaseChartDataSession(): void {
  if (!current) return;
  const { endpoint, apiKey, sessionId } = current;
  current = null;
  void releaseDataSession(endpoint, apiKey, sessionId);
}

/** @internal test helper */
export function _resetChartDataSessionForTests(): void {
  current = null;
}
