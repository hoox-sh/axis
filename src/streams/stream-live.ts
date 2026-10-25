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
 * Owns the tab's live wires, built lazily from the active engine config.
 * Chart slots share one socket per fingerprint; a second socket opens only
 * for a different engine endpoint (tab cap 2). Handlers paint series
 * snapshots/deltas through the same store/chart
 * helpers the legacy path uses (`setBarsQuiet` + `setDataToChart` for full
 * replaces, `appendLiveBar` for tip appends) and report subscription status
 * into `store.live.feeds` / `scriptStatus`.
 *
 * Every entry throws `StreamFallbackError` on failure so callers drop to the
 * legacy path; nothing here runs unless `routeEngineRun` says stream.
 *
 * @module streams/stream-live
 */

import { getManager, setDataToChart } from '../chart/manager-access';
import { FALLBACK_MAJORS } from '../data/symbol-catalog';
import { intervalToSec } from '../data/bars-gaps';
import { applyStreamPayload } from '../engine/apply-bridge';
import { Redesign2BarCloseVerifier, compareClosedOhlcv } from '../engine/bar-close-verify';
import { currentSeriesKey, pairFormSymbol } from '../engine/market-identity';
import { pyneMarket } from '../data/provider';
import { StreamLiveWire, StreamFallbackError, type WireClient } from '../engine/live-wire';
import { SocketPool, socketFingerprint } from '../engine/v1/socket-pool';
import { createLiveWsClient } from '../hp/workers/host';
import { routeEngineRun } from '../engine/router';
import { getCachedEngineCapabilities } from '../engines/catalog';
import type { DataSeriesKey } from '../engines/data-sessions';
import { invalidateDataSessions } from '../engines/data-sessions';
import { invalidateLiveSessionsForSeries } from '../engines/live-sessions';
import { driveEngineSeries } from '../engines/series-drive';
import { engineWindowBehindChart, newestBarTime } from '../engines/series-freshness';
import { engineSeriesStale, noteStaleEngineSeries } from '../engines/series-repair';
import { getActiveEngineConfig } from '../plugins/active';
import {
  clearFeedStatus,
  clearScriptStatus,
  chartWindowLimit,
  setBarsQuiet,
  setFeedStatus,
  setScriptStatus,
  sliceToChartWindow,
  store,
} from '../store';
import { appendLiveBar } from '../chart/live-append';
import type { Bar } from '../store/types';
import type { Indicator } from '../store/types';
import { BoundedMap } from '../utils/bounded-map';

function chartPairSymbol(): string {
  return pairFormSymbol(String(store.symbol || ''), FALLBACK_MAJORS);
}

function chartSeriesKey(): string {
  return currentSeriesKey({
    exchange: store.exchange || 'binance',
    symbol: store.symbol || '',
    interval: store.interval || '',
    market: pyneMarket(store.provider?.market),
    catalog: FALLBACK_MAJORS,
  });
}

function seriesSubId(): string {
  return `series:${chartSeriesKey()}`;
}

function toBarTime(bars: Bar[]): number {
  return bars.length ? bars[bars.length - 1]!.time : 0;
}

/** Exchange id (canonical) of the chart's current series. */
function chartExchange(): string {
  return (
    String(store.exchange || 'binance')
      .trim()
      .toLowerCase() || 'binance'
  );
}

/** Window the engine series is subscribed with (bars). */
function engineHistoryBars(): number {
  return Number.isFinite(store.rollingWindowBars) && store.rollingWindowBars > 0
    ? store.rollingWindowBars
    : 2000;
}

/** PYNE `full` of a 5k 1m window times out; the chart is already painted from REST. */
const LIVE_SNAPSHOT_BARS = 500;

/** Subscribe for a short tail snapshot so `/ws/live` can connect; REST already painted the window. */
export function subscribeHistoryBars(have: number, rolling: number): number {
  const want = Number.isFinite(rolling) && rolling > 0 ? rolling : 2000;
  if (have >= 50) return Math.min(LIVE_SNAPSHOT_BARS, have, want);
  return Math.min(want, LIVE_SNAPSHOT_BARS);
}

/**
 * Stale-engine guard for a hand-off from the engine's series (stream plane).
 *
 * The chart is painted from the engine's series, so a snapshot that is *behind*
 * the chart tail (the Data Manager / venue path already has the newer bars) must
 * not be painted: it would back-date the chart and re-open the same stale window
 * on every venue tick. Refuse the paint and report + repair the engine's series
 * from AXIS' own dataset — the next snapshot carries the healed window.
 *
 * A snapshot that is only behind the venue `marketNow` (the forming bar the
 * caller just flushed) is **reported and repaired but still painted**: it
 * advances the chart (or is a no-op), and skipping it would pin the candles
 * while every other series keeps moving — which is its own bug.
 *
 * `marketNow` is only supplied on venue-triggered ticks, so a session venue
 * (equities / FX holding its last close over a weekend) is never accused of
 * being frozen: the trigger clock simply does not advance there. Chart-tail
 * staleness applies to every path.
 *
 * Returns `true` when the bars are safe to paint.
 */
function engineSeriesPaintable(bars: Bar[], marketNow = 0): boolean {
  const iv = String(store.interval || '1m');
  const reason = engineSeriesStale({
    chartBars: store.bars,
    engineBars: bars,
    interval: iv,
    marketNow,
  });
  if (!reason) return true;
  reportStaleEngine(reason, newestBarTime(bars) || null);
  // Report/repair always; refuse only a paint that would back-date the chart.
  return !engineWindowBehindChart(store.bars, bars, iv);
}

/** Canonical series key of the chart (engine `series` identity, pair-form). */
function chartSeriesKeyObject(): DataSeriesKey {
  return {
    exchange: chartExchange(),
    market: store.provider?.market || 'spot',
    symbol: chartPairSymbol(),
    interval: String(store.interval || '1m'),
  };
}

/**
 * Merge an engine snapshot into the chart window.
 * Chart rows win; the engine tail only fills holes and extends.
 */
export function mergeEngineSnapshot(chartBars: Bar[], snapshot: Bar[]): Bar[] {
  if (!snapshot.length) return chartBars;
  if (!chartBars.length) return sliceToChartWindow(snapshot);
  const byTime = new Map<number, Bar>();
  for (const b of chartBars) {
    if (b && Number.isFinite(b.time)) byTime.set(b.time, b);
  }
  for (const b of snapshot) {
    if (b && Number.isFinite(b.time) && !byTime.has(b.time)) byTime.set(b.time, b);
  }
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return sliceToChartWindow(merged);
}

/**
 * Report a stale engine series and queue the background repair (throttled log
 * + plane/feed telemetry + broker call — see `engines/series-repair.ts`).
 */
function reportStaleEngine(reason: string, engineNewest: number | null): void {
  noteStaleEngineSeries({
    exchange: chartExchange(),
    symbol: String(store.symbol || ''),
    interval: String(store.interval || '1m'),
    engineNewest,
    reason,
    repair: {
      endpoint: String(getActiveEngineConfig()?.endpoint || store.endpoint || ''),
      apiKey: String(getActiveEngineConfig()?.apiKey || ''),
      key: chartSeriesKeyObject(),
      historyBars: engineHistoryBars(),
    },
  });
}

/**
 * True when `bars` continues the chart tail (same slot or the very next) — safe
 * to append per bar. A delta that jumps further would open a hole in the series;
 * the per-tick `ensureSeries` full snapshot reconciles it instead.
 */
function continuesChartTail(bars: Bar[]): boolean {
  const tail = toBarTime(store.bars);
  const first = bars.length ? bars[0]!.time : 0;
  if (!tail || !first) return false;
  const step = intervalToSec(String(store.interval || '1m'));
  const delta = first - tail;
  return delta >= 0 && delta <= step;
}

const tabSockets = new SocketPool<StreamLiveWire>();
let wire: StreamLiveWire | null = null;
let wireCred = '';
/**
 * (engine + series) → the bar-close verifier for that series.
 *
 * Capped: a session that walks many series must not keep one verifier per
 * series forever.
 */
/** Cap on remembered bar-close verifiers — one per (engine + series) pair. */
const VERIFIER_MEMO_MAX = 32;
const verifiers = new BoundedMap<string, Redesign2BarCloseVerifier>(VERIFIER_MEMO_MAX);

function wireFingerprint(): string {
  const cfg = getActiveEngineConfig();
  const endpoint = String(cfg?.endpoint || store.endpoint || '');
  const authToken = String(cfg?.apiKey || '').trim();
  return socketFingerprint(endpoint, authToken);
}

function buildWire(): StreamLiveWire {
  const cfg = getActiveEngineConfig();
  const endpoint = String(cfg?.endpoint || store.endpoint || 'http://localhost:5002');
  // The engine-owned plane authenticates over the socket, not the URL: the
  // server answers UNAUTHORIZED (and AXIS then falls back to REST) unless the
  // first frame is `auth`. Read the key the same way every key-gated REST call
  // does, so a vault-restored key reaches the socket too.
  const authToken = String(cfg?.apiKey || '').trim() || undefined;
  const rawClient = createLiveWsClient({
    endpoint,
    authToken,
  });
  const client = rawClient as unknown as WireClient;
  return new StreamLiveWire(
    client,
    {
      onStatus: (subId, status, extra) => {
        if (subId.startsWith('series:')) {
          const key = subId.slice('series:'.length);
          const clearStale =
            status === 'connecting' || status === 'live' || status === 'datafeed-loading';
          setFeedStatus(key, status, {
            ...extra,
            ...(clearStale && extra?.message === undefined ? { message: '' } : {}),
          });
        } else {
          setScriptStatus(subId, status, extra?.message);
        }
      },
      onSeriesFull: (bars) => {
        if (!engineSeriesPaintable(bars)) return;
        // The chart window is the single authority — an engine snapshot that
        // carries more bars than the window is trimmed before it is painted.
        // The snapshot is **merged**, not applied as a replace: it is a short
        // tail, and a replace threw the chart's own (freshly loaded) window
        // away.
        const view = mergeEngineSnapshot(store.bars, bars);
        if (!view.length) return;
        setBarsQuiet(view);
        setDataToChart(view, { fit: false, clearMarkers: false });
      },
      onSeriesDelta: (bars, append) => {
        if (!bars.length) return;
        if (!engineSeriesPaintable(bars)) return;
        // Ticks never rewrite the window (P3): only a snapshot/repair uses
        // setData. Same-slot or next-slot tips path-set through appendLiveBar.
        if (!append || bars.length > 4 || !continuesChartTail(bars)) return;
        for (const bar of bars) {
          appendLiveBar(bar, { via: 'worker' });
        }
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
              void getWire()
                .then((w) => {
                  try {
                    w.repair(seriesSubId(), time);
                  } catch {
                    /* repair is best-effort */
                  }
                })
                .catch(() => {});
              return;
            }
            if (out.verified === 'venue' || out.verified === 'proxy') {
              setFeedStatus(key, 'live', { verified: out.verified });
            } else {
              setFeedStatus(key, 'degraded', {
                message: 'unverified close',
                verified: out.verified,
              });
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

async function getWire(): Promise<StreamLiveWire> {
  const fp = wireFingerprint();
  if (wire && wireCred === fp) return wire;
  // Primary slot moved: drop this tab's previous fingerprint. Other
  // acquires can still hold a second socket. Cap is 2.
  if (wireCred && wireCred !== fp) {
    const dead = tabSockets.release(wireCred);
    if (dead) {
      try {
        dead.reset();
      } catch {
        /* previous socket is gone */
      }
    }
    if (wire === dead) wire = null;
  }
  const got = tabSockets.acquire(fp, buildWire);
  const next = got.status === 'live' ? got.value : await got.wait;
  wire = next;
  wireCred = fp;
  return next;
}

/**
 * Diagnostic view of the engine socket for MCP `stream.get`.
 *
 * `null` when nothing has subscribed yet — the wire is built lazily on the
 * first stream tick, so "no wire" is itself the answer to "why is there no
 * subscription?".
 */
export function streamWireState(): ReturnType<StreamLiveWire['snapshotState']> | null {
  if (!wire) return null;
  try {
    return wire.snapshotState();
  } catch {
    return null;
  }
}

/**
 * Drop the engine socket and every subscription (MCP `stream.reset`).
 *
 * Every live wire in the tab pool is discarded (not just disconnected):
 * `Redesign2WsClient` is terminal after `disconnect()`, so the next stream
 * tick rebuilds from the current engine config — recovering a changed API
 * key/endpoint, a superseded socket, or a failure cooldown in one step.
 * Never throws.
 */
export function resetStreamWire(): {
  hadWire: boolean;
  wasOpen: boolean;
  unsubscribed: number;
  cooledDown: boolean;
} {
  const held = tabSockets.drain();
  if (wire && !held.includes(wire)) held.push(wire);
  wire = null;
  wireCred = '';
  if (!held.length) return { hadWire: false, wasOpen: false, unsubscribed: 0, cooledDown: false };
  let out = { hadWire: true, wasOpen: false, unsubscribed: 0, cooledDown: false };
  for (const target of held) {
    try {
      const r = target.reset();
      out = {
        hadWire: true,
        wasOpen: out.wasOpen || r.wasOpen,
        unsubscribed: out.unsubscribed + r.unsubscribed,
        cooledDown: out.cooledDown || r.cooledDown,
      };
    } catch {
      /* reset must never break the caller */
    }
  }
  return out;
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
    market: pyneMarket(store.provider?.market),
    symbol: chartPairSymbol(),
    interval: store.interval || '',
    history_bars: subscribeHistoryBars(store.bars.length, engineHistoryBars()),
  };
}

/**
 * Subscription meta for a **script** subscription.
 *
 * The script's plot values are painted over the chart's **whole** window, so
 * the engine's script state has to cover it. The short live-snapshot depth
 * (`LIVE_SNAPSHOT_BARS`) is only right for the chart's own OHLCV series —
 * the chart is painted from REST — while a script painted from a 500-bar
 * state covers only the last 500 bars: the rest of the window goes blank and
 * the script's band fill collapses with it.
 */
function scriptMeta(): Record<string, unknown> {
  const meta = seriesMeta();
  meta.history_bars = scriptHistoryBars();
  return meta;
}

/**
 * Bars a script subscription must cover: the chart window, not the short
 * prefix painted before the dataset fills.
 */
export function scriptHistoryBars(): number {
  const want = chartWindowLimit();
  const have = store.bars.length;
  return Math.max(1, want, have);
}

/**
 * Drive the engine's own series forward on the stream path.
 *
 * The stream plane **replicates** the engine's series: the wire carries
 * `subscribe` / `resume` / `repair` / `ping` and has no client-side tick, so
 * the engine's own per-tick scheduler is the only thing that can move the
 * series the chart and every script session read.
 *
 * When that scheduler stalls — observed live on a 1m series, the engine's
 * `newest` frozen three bars behind the venue for minutes — the script
 * sessions that evaluate over that series freeze with it. The chart keeps
 * advancing (it is painted from the venue), but the indicators keep the values
 * of the frozen window, and the apply path tail-aligns them onto the chart's
 * tail: the indicators end up **displaced by the freeze gap**, growing with
 * every new bar, and the newest bars carry no indicator value at all.
 *
 * `series-drive` is the missing drive — a throttled chart-session tick that
 * asks the engine to fetch and append its own bars. It stays engine-owned
 * (the engine still owns the series and its upstream) and the staleness
 * report + repair broker stays the backstop for engines that cannot be
 * driven.
 *
 * @param marketNow newest venue trigger bar time (unix sec) the caller flushed.
 */
export async function streamDriveSeries(marketNow = 0): Promise<void> {
  const cfg = getActiveEngineConfig() || {};
  const endpoint = String(cfg.endpoint || '').trim();
  const apiKey = String(cfg.apiKey || '').trim();
  if (!endpoint || !apiKey) return;
  const key: DataSeriesKey = {
    exchange: chartExchange(),
    market: pyneMarket(store.provider?.market),
    symbol: chartPairSymbol(),
    interval: store.interval || '',
  };
  try {
    const outcome = await driveEngineSeries({
      endpoint,
      apiKey,
      key,
      marketNow,
      // Same depth the engine-owned path uses, so the drive reuses the
      // existing chart data session instead of re-provisioning it.
      historyBars: chartWindowLimit(),
    });
    // PYNE `stale` means the tick clamped and a hole was filled or remains.
    // The in-memory script session still has the old axis until it is dropped.
    if (outcome === 'stale') {
      try {
        invalidateDataSessions(endpoint, key);
        invalidateLiveSessionsForSeries(endpoint, key.symbol, key.interval);
      } catch {
        /* the next explicit run still recreates */
      }
    }
  } catch {
    /* the drive is best-effort — the staleness broker is the backstop */
  }
}

/**
 * Venue tick on the stream path: ensure the series subscription (first
 * snapshot paints; later ticks are subscribe-once and leave the venue-painted
 * forming tip alone), then report whether the caller should re-run scripts.
 *
 * `marketNow` is the newest venue trigger time the caller just flushed: it is
 * the venue's own clock, so a frozen engine (series stuck while the venue keeps
 * trading) is detectable. Omit it on non-venue-driven calls (the guard then
 * only refuses to back-date the chart).
 */
export async function streamSeriesTick(marketNow = 0): Promise<boolean> {
  const token = String(getActiveEngineConfig()?.apiKey || '').trim();
  if (!token) throw new StreamFallbackError('no-auth', 'engine API key missing');
  const w = await getWire();
  const subId = seriesSubId();
  try {
    const before = toBarTime(store.bars);
    const alreadyLive = w.isSubscribed(subId);
    const bars = await w.ensureSeries(subId, seriesMeta());
    if (alreadyLive) {
      setFeedStatus(chartSeriesKey(), 'live');
      return false;
    }
    if (!engineSeriesPaintable(bars, marketNow)) return false;
    // The tail snapshot is merged into the chart's window — it must not
    // shrink a longer REST/DSM window (that replace threw the freshly loaded
    // dataset away).
    const manager = getManager();
    const view = mergeEngineSnapshot(store.bars, bars);
    if (!view.length) return false;
    setBarsQuiet(view);
    if (manager) setDataToChart(view, { fit: false, clearMarkers: false });
    setFeedStatus(chartSeriesKey(), 'live');
    return toBarTime(bars) !== before;
  } catch (e) {
    if (e instanceof StreamFallbackError) {
      setFeedStatus(chartSeriesKey(), 'degraded', { message: 'venue+REST' });
      throw e;
    }
    throw new StreamFallbackError('series-tick', e instanceof Error ? e.message : String(e));
  }
}

/** Evaluate one script over the latest merged stream state (no re-run). */
export async function streamEvalScript(ind: Indicator): Promise<void> {
  const token = String(getActiveEngineConfig()?.apiKey || '').trim();
  if (!token) throw new StreamFallbackError('no-auth', 'engine API key missing');
  const w = await getWire();
  try {
    await w.evalScript({
      subId: ind.id,
      script: ind.code,
      indicatorId: ind.id,
      meta: scriptMeta(),
      bars: store.bars,
      // The engine evaluates the subscribed script with these values — the
      // script's defaults otherwise, which makes an input change a no-op.
      inputs: (ind.inputValues ?? undefined) as Record<string, unknown> | undefined,
    });
    setScriptStatus(ind.id, 'live');
  } catch (e) {
    if (e instanceof StreamFallbackError) {
      setScriptStatus(ind.id, 'degraded', 'venue+REST');
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
    ((opts) =>
      import('../data/binance-http').then(
        (m) => m.fetchBinanceJson(opts as never) as Promise<unknown>,
      ));
  const readRow = (
    json: unknown,
  ): { open: number; high: number; low: number; close: number; volume: number } | null => {
    const rows = Array.isArray(json) ? json : (json as { data?: unknown })?.data;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => Array.isArray(r) && Number(r[0]) === input.time * 1000) ?? rows[0];
    if (!Array.isArray(row) || row.length < 6) return null;
    const [, o, h, l, c, v] = row.map(Number);
    if (![o, h, l, c, v].every(Number.isFinite)) return null;
    return { open: o, high: h, low: l, close: c, volume: v };
  };
  // Tier 1 — direct venue REST (no proxy involved).
  try {
    const row = readRow(
      await fetchKlines({
        path: 'klines',
        query,
        skipSigned: true,
        skipWorkerProxy: true,
        signal: input.signal,
      }),
    );
    if (row) return { result: compareClosedOhlcv(input.engineOhlcv, row), verified: 'venue' };
  } catch {
    /* fall through */
  }
  // Tier 2 — Worker market proxy.
  try {
    const row = readRow(
      await fetchKlines({ path: 'klines', query, skipSigned: true, signal: input.signal }),
    );
    if (row) return { result: compareClosedOhlcv(input.engineOhlcv, row), verified: 'proxy' };
  } catch {
    /* fall through */
  }
  // Tier 3 — engine copy (local replica cell). Weak: logged as such.
  return { result: streamVerifyClose(input.time, input.engineOhlcv), verified: 'engine' };
}

/** Tear down the stream path (stopLive / symbol switch / restart). */
export function streamStop(): void {
  const held = tabSockets.drain();
  if (wire && !held.includes(wire)) held.push(wire);
  for (const w of held) {
    try {
      w.disconnect();
    } catch {
      /* ignore */
    }
  }
  wire = null;
  wireCred = '';
  verifiers.clear();
  try {
    for (const key of Object.keys(store.live.feeds)) clearFeedStatus(key);
    for (const id of Object.keys(store.live.scriptStatus)) clearScriptStatus(id);
  } catch {
    /* store unavailable in tests */
  }
}

export { StreamFallbackError };
