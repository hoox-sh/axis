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
 * Stream-path glue between the live loop and the engine-owned plane (F-19).
 *
 * Owns one `StreamLiveWire` per tab, built lazily from the active engine
 * config. Handlers paint series snapshots/deltas through the same store/chart
 * helpers the legacy path uses (`setBarsQuiet` + `setDataToChart` for full
 * replaces, `appendBar` + `manager.appendBar` for tip appends) and report
 * subscription status into `store.live.feeds` / `scriptStatus`.
 *
 * Every entry throws `StreamFallbackError` on failure so callers drop to the
 * legacy path; nothing here runs unless `routeEngineRun` says stream.
 *
 * @module streams/stream-live
 */

import { getManager, setDataToChart } from '../chart/manager-access';
import { FALLBACK_MAJORS } from '../data/symbol-catalog';
import { applyStreamPayload } from '../engine/apply-bridge';
import { Redesign2BarCloseVerifier, compareClosedOhlcv } from '../engine/bar-close-verify';
import { currentSeriesKey } from '../engine/market-identity';
import { StreamLiveWire, StreamFallbackError, type WireClient } from '../engine/live-wire';
import { Redesign2WsClient } from '../engine/ws-client';
import { routeEngineRun } from '../engine/router';
import { getCachedEngineCapabilities } from '../engines/catalog';
import { getActiveEngineConfig } from '../plugins/active';
import {
  appendBar,
  clearFeedStatus,
  clearScriptStatus,
  setBarsQuiet,
  setFeedStatus,
  setScriptStatus,
  store,
} from '../store';
import type { Bar } from '../store/types';
import type { Indicator } from '../store/types';

function chartSeriesKey(): string {
  return currentSeriesKey({
    exchange: store.exchange || 'binance',
    symbol: store.symbol || '',
    interval: store.interval || '',
    catalog: FALLBACK_MAJORS,
  });
}

function seriesSubId(): string {
  return `series:${chartSeriesKey()}`;
}

function toBarTime(bars: Bar[]): number {
  return bars.length ? bars[bars.length - 1]!.time : 0;
}

let wire: StreamLiveWire | null = null;
const verifiers = new Map<string, Redesign2BarCloseVerifier>();

function buildWire(): StreamLiveWire {
  const cfg = getActiveEngineConfig();
  const endpoint = String(cfg?.endpoint || store.endpoint || 'http://localhost:5002');
  const client = new Redesign2WsClient({ endpoint }) as unknown as WireClient;
  return new StreamLiveWire(
    client,
    {
      onStatus: (subId, status, extra) => {
        if (subId.startsWith('series:')) {
          const key = subId.slice('series:'.length);
          setFeedStatus(key, status, extra);
        } else {
          setScriptStatus(subId, status, extra?.message);
        }
      },
      onSeriesFull: (bars) => {
        setBarsQuiet(bars);
        setDataToChart(bars, { fit: false, clearMarkers: false });
      },
      onSeriesDelta: (bars, append) => {
        if (!bars.length) return;
        if (append && bars.length <= 4) {
          const manager = getManager();
          for (const bar of bars) {
            appendBar(bar);
            if (manager) manager.appendBar(bar);
          }
          return;
        }
        setBarsQuiet(bars);
        setDataToChart(bars, { fit: false, clearMarkers: false });
      },
      onCloseVerified: (time, _result, ohlcv) => {
        void (async () => {
          const key = chartSeriesKey();
          const o = ohlcv ?? {};
          const nums = {
            open: Number(o.open),
            high: Number(o.high),
            low: Number(o.low),
            close: Number(o.close),
            volume: Number(o.volume),
          };
          if (![nums.open, nums.high, nums.low, nums.close, nums.volume].every(Number.isFinite)) {
            setFeedStatus(key, 'degraded', { message: 'unverified close', verified: 'none' });
            return;
          }
          try {
            const out = await verifyClosedBar({
              seriesKey: key,
              symbol: store.symbol || '',
              interval: store.interval || '',
              time,
              engineOhlcv: nums,
            });
            if (out.result === 'mismatch') {
              setFeedStatus(key, 'degraded', {
                message: 'close mismatch — repair requested',
                verified: out.verified,
              });
              return;
            }
            if (out.verified === 'venue' || out.verified === 'proxy') {
              setFeedStatus(key, 'live', { verified: out.verified });
            } else {
              setFeedStatus(key, 'degraded', { message: 'unverified close', verified: out.verified });
            }
          } catch {
            setFeedStatus(key, 'degraded', { message: 'unverified close', verified: 'none' });
          }
        })();
      },
    },
    (script, indicatorId, full, via, bars) =>
      applyStreamPayload({ script, indicatorId, full: full as never, via, bars }),
  );
}

function getWire(): StreamLiveWire {
  if (!wire) wire = buildWire();
  return wire;
}

/** True when the stream path owns this live tick (flag + live_stream caps). */
export function streamRouteActive(): boolean {
  try {
    return routeEngineRun(getCachedEngineCapabilities()).useStream;
  } catch {
    return false;
  }
}

function seriesMeta(): Record<string, unknown> {
  return {
    exchange: (store.exchange || 'binance').toLowerCase(),
    market: 'spot',
    symbol: store.symbol || '',
    interval: store.interval || '',
    history_bars: store.rollingWindowBars || 10000,
  };
}

/**
 * Venue tick on the stream path: ensure the series subscription (paint arrives
 * via `onSeriesFull`/`onSeriesDelta`), then report whether the caller should
 * re-run scripts. Never appends venue bars locally — the subscription owns
 * the replica.
 */
export async function streamSeriesTick(): Promise<boolean> {
  const w = getWire();
  const subId = seriesSubId();
  try {
    const before = toBarTime(store.bars);
    const bars = await w.ensureSeries(subId, seriesMeta());
    const manager = getManager();
    setBarsQuiet(bars);
    if (manager) setDataToChart(bars, { fit: false, clearMarkers: false });
    setFeedStatus(chartSeriesKey(), 'live');
    return toBarTime(bars) !== before;
  } catch (e) {
    if (e instanceof StreamFallbackError) {
      setFeedStatus(chartSeriesKey(), 'degraded', { message: e.reason });
      throw e;
    }
    throw new StreamFallbackError('series-tick', e instanceof Error ? e.message : String(e));
  }
}

/** Evaluate one script over the latest merged stream state (no re-run). */
export async function streamEvalScript(ind: Indicator): Promise<void> {
  const w = getWire();
  try {
    await w.evalScript({
      subId: ind.id,
      script: ind.code,
      indicatorId: ind.id,
      meta: seriesMeta(),
      bars: store.bars,
    });
    setScriptStatus(ind.id, 'live');
  } catch (e) {
    if (e instanceof StreamFallbackError) {
      setScriptStatus(ind.id, 'degraded', e.reason);
      throw e;
    }
    setScriptStatus(ind.id, 'error', e instanceof Error ? e.message : String(e));
    throw new StreamFallbackError('eval', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Begin close verification for the watermark bar (F-17 rule): compare the
 * engine's finalized OHLCV against the local replica cell. A mismatch sends
 * `repair` on the next tick cycle (wired when the wire exposes repair; until
 * then the degraded status surfaces it).
 */
export function streamVerifyClose(
  time: number,
  engineOhlcv: { open: number; high: number; low: number; close: number; volume: number },
): 'match' | 'mismatch' | 'unknown' {
  const key = seriesSubId();
  let v = verifiers.get(key);
  if (!v) {
    v = new Redesign2BarCloseVerifier();
    verifiers.set(key, v);
  }
  try {
    v.begin();
  } catch {
    return 'unknown';
  }
  const local = store.bars.find((b) => b.time === time);
  const result = local
    ? compareClosedOhlcv(engineOhlcv, {
        open: Number(local.open),
        high: Number(local.high),
        low: Number(local.low),
        close: Number(local.close),
        volume: Number(local.volume),
      })
    : 'unknown';
  try {
    v.finish(result);
  } catch {
    return 'unknown';
  }
  return result;
}

export type VerifyStrength = 'venue' | 'proxy' | 'engine' | 'none';

export interface VerifyClosedBarInput {
  /** Canonical series key (for status reporting). */
  seriesKey: string;
  /** Venue load-form symbol (e.g. BTCUSDT) for the kline lookup. */
  symbol: string;
  /** Venue interval (e.g. 1m). */
  interval: string;
  /** Closed bar time (unix seconds). */
  time: number;
  engineOhlcv: { open: number; high: number; low: number; close: number; volume: number };
  signal?: AbortSignal;
}

export interface VerifyClosedBarOutcome {
  result: 'match' | 'mismatch' | 'unknown';
  verified: VerifyStrength;
}

type KlineFetcher = (opts: {
  path: 'klines';
  query?: string;
  skipSigned?: boolean;
  skipWorkerProxy?: boolean;
  signal?: AbortSignal;
}) => Promise<unknown>;

/**
 * Three-tier close verification (F-28): venue REST first, Worker proxy
 * second, engine-copy (local replica) last. Returns which tier confirmed.
 * Non-binance venues skip straight to proxy/engine (no direct helper yet).
 */
export async function verifyClosedBar(
  input: VerifyClosedBarInput,
  deps?: { fetchKlines?: KlineFetcher },
): Promise<VerifyClosedBarOutcome> {
  const query = `symbol=${encodeURIComponent(input.symbol)}&interval=${encodeURIComponent(input.interval)}&startTime=${input.time * 1000}&limit=1`;
  const fetchKlines: KlineFetcher =
    deps?.fetchKlines ??
    ((opts) => import('../data/binance-http').then((m) => m.fetchBinanceJson(opts as never) as Promise<unknown>));
  const readRow = (json: unknown): { open: number; high: number; low: number; close: number; volume: number } | null => {
    const rows = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => Array.isArray(r) && Number(r[0]) === input.time * 1000) ?? rows[0];
    if (!Array.isArray(row) || row.length < 6) return null;
    const [ , o, h, l, c, v] = row.map(Number);
    if (![o, h, l, c, v].every(Number.isFinite)) return null;
    return { open: o, high: h, low: l, close: c, volume: v };
  };
  // Tier 1 — direct venue REST (no proxy involved).
  try {
    const row = readRow(await fetchKlines({ path: 'klines', query, skipSigned: true, skipWorkerProxy: true, signal: input.signal }));
    if (row) return { result: compareClosedOhlcv(input.engineOhlcv, row), verified: 'venue' };
  } catch {
    /* fall through */
  }
  // Tier 2 — Worker market proxy.
  try {
    const row = readRow(await fetchKlines({ path: 'klines', query, skipSigned: true, signal: input.signal }));
    if (row) return { result: compareClosedOhlcv(input.engineOhlcv, row), verified: 'proxy' };
  } catch {
    /* fall through */
  }
  // Tier 3 — engine copy (local replica cell). Weak: logged as such.
  return { result: streamVerifyClose(input.time, input.engineOhlcv), verified: 'engine' };
}

/** Tear down the stream path (stopLive / symbol switch / restart). */
export function streamStop(): void {
  try {
    wire?.disconnect();
  } catch {
    /* ignore */
  }
  wire = null;
  verifiers.clear();
  try {
    for (const key of Object.keys(store.live.feeds)) clearFeedStatus(key);
    for (const id of Object.keys(store.live.scriptStatus)) clearScriptStatus(id);
  } catch {
    /* store unavailable in tests */
  }
}

export { StreamFallbackError };
