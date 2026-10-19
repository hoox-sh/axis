/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * MCP live-plane capabilities: bar windows, the lag ledger, and the engine /
 * stream planes.
 *
 * Split out of `mcp/dispatch` (a routing switch) so each view is a small,
 * directly testable function. These are the questions an agent actually asks
 * while debugging a live chart — *"is the forming bar on the chart?", "why is
 * it a bar behind?", "is the engine's series advancing, and is the socket
 * subscribed?"* — answered without SSH-ing into the engine host.
 *
 * Secrets never leave the app plane: engine reads reuse the active engine's
 * endpoint + key **in-tab** and return only bounds/status; the key itself is
 * reported as `hasApiKey` and nothing else.
 *
 * @module mcp/live
 */

import { FALLBACK_MAJORS } from '../data/symbol-catalog';
import { pyneMarket } from '../data/provider';
import { intervalToSec } from '../data/bars-gaps';
import { currentSeriesKey, pairFormSymbol } from '../engine/market-identity';
import { routeEngineRun } from '../engine/router';
import type { DataSeriesKey, DataSeriesStatus } from '../engines/data-sessions';
import {
  canonicalSeriesKey,
  getDataSeriesStatus,
  repairStaleEngineSeries,
  seriesIsStale,
} from '../engines/data-sessions';
import { getChartSessionInfo, tickChartDataSession } from '../engines/chart-data-session';
import { getCachedEngineCapabilities, getCachedEngineHealth } from '../engines/catalog';
import { driveEngineSeries, type SeriesDriveTick } from '../engines/series-drive';
import { newestBarTime, stepsBehind } from '../engines/series-freshness';
import { getActiveEngineConfig, getActiveEngineId } from '../plugins/active';
import { resetStreamWire, streamRouteActive, streamSeriesTick, streamWireState } from '../streams/stream-live';
import { chartWindowLimit, store } from '../store';
import type { Bar } from '../store/types';
import { McpInvokeError } from './protocol';
import { barSummary, boundedBarRows } from './snapshot';

/** Cap for `chart.bars` tail/head rows (bounded on purpose — F9). */
const BAR_VIEW_MAX = 500;

/** Cap for reported gap runs in `chart.bars` (total still counts them all). */
const GAP_SLOTS_MAX = 50;

/** Round-trip budget for an engine query inside one MCP invoke (the Worker
 * bridge allows 20 s total; a status read is one cheap GET). */
const ENGINE_QUERY_TIMEOUT_MS = 6_000;

/** Resubscribe probe budget for `stream.reset` (the attempt continues in the
 * background; only the *report* is bounded). */
const RESUBSCRIBE_PROBE_MS = 10_000;

function fail(code: string, message: string): never {
  throw new McpInvokeError(code, message);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = num(v);
  if (n === null) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function engineSignal(): AbortSignal {
  return AbortSignal.timeout(ENGINE_QUERY_TIMEOUT_MS);
}

interface EngineConnection {
  endpoint: string;
  apiKey: string;
}

/**
 * Endpoint + key of the active engine, resolved exactly like every key-gated
 * engine call (`cfg.endpoint || store.endpoint`, key through the session vault).
 * `null` when no endpoint is configured — callers report `no-endpoint` instead
 * of pretending the plane is healthy.
 */
function engineConnection(): EngineConnection | null {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = getActiveEngineConfig() || {};
  } catch {
    cfg = {};
  }
  const endpoint = String(cfg.endpoint || '').trim() || String(store.endpoint || '').trim();
  if (!endpoint) return null;
  return { endpoint, apiKey: String(cfg.apiKey || '') };
}

function requireEngineConnection(): EngineConnection {
  const conn = engineConnection();
  if (!conn) fail('NO_ENDPOINT', 'active engine has no endpoint configured');
  return conn;
}

/** Canonical series key of the chart — same identity `streams/stream-live`
 * subscribes/drives with (`exchange|market|SYMBOL|interval`, pair-form). */
function chartSeriesKeyObject(): DataSeriesKey {
  return {
    exchange: String(store.exchange || 'binance').trim().toLowerCase() || 'binance',
    market: pyneMarket(store.provider?.market),
    symbol: pairFormSymbol(String(store.symbol || ''), FALLBACK_MAJORS),
    interval: String(store.interval || '1m'),
  };
}

/** Payload key for `engine.*`: falls back to the chart series field-by-field. */
function keyFromPayload(p: Record<string, unknown>): DataSeriesKey {
  const key: DataSeriesKey = {
    exchange: String(p.exchange || store.exchange || 'binance').trim().toLowerCase() || 'binance',
    market: pyneMarket(p.market || store.provider?.market),
    symbol: pairFormSymbol(String(p.symbol || store.symbol || '').trim(), FALLBACK_MAJORS),
    interval: String(p.interval || store.interval || '1m').trim() || '1m',
  };
  if (!key.symbol) fail('NO_SYMBOL', 'symbol required (payload symbol, or load a chart)');
  return key;
}

function chipOf(entry: {
  status?: string;
  have?: number;
  need?: number;
  message?: string;
  verified?: string;
  updatedAt?: number;
}): Record<string, unknown> {
  return {
    status: entry.status ?? 'idle',
    have: num(entry.have),
    need: num(entry.need),
    message: entry.message ?? null,
    verified: entry.verified ?? null,
    updatedAt: num(entry.updatedAt),
  };
}

/** Feed chip for the chart's series (pair-form key first, substring fallback). */
function chartFeedChip(): Record<string, unknown> | null {
  const feeds = store.live?.feeds || {};
  const symbol = String(store.symbol || '');
  const interval = String(store.interval || '1m');
  let wanted = '';
  try {
    wanted = currentSeriesKey({
      exchange: String(store.exchange || 'binance'),
      symbol,
      interval,
      catalog: FALLBACK_MAJORS,
    });
  } catch {
    wanted = '';
  }
  const entries = Object.entries(feeds);
  const hit =
    (wanted && feeds[wanted] ? ([wanted, feeds[wanted]] as const) : null) ||
    entries.find(([k]) => k.includes(symbol) && k.endsWith(`|${interval}`)) ||
    (entries.length === 1 ? entries[0] : null);
  if (!hit) return null;
  return { key: hit[0], ...chipOf(hit[1]) };
}

function seriesView(
  st: DataSeriesStatus | null,
  interval: string,
  chartLast: number,
  now: number,
): Record<string, unknown> | null {
  if (!st) return null;
  return {
    key: st.key,
    count: st.count,
    oldest: st.oldest,
    newest: st.newest,
    updatedAt: st.updatedAt,
    /** Bars behind the venue (wall) clock. */
    lagBars: st.newest ? stepsBehind(st.newest, now, interval) : null,
    /** Bars behind the chart tail (the paint guard's own verdict). */
    behindChartBars: st.newest && chartLast ? stepsBehind(st.newest, chartLast, interval) : null,
    stale: seriesIsStale(st.newest, interval, now),
    updatedAgeSec: st.updatedAt ? Math.max(0, now - st.updatedAt) : null,
  };
}

/** Fail-soft status read for before/after comparisons. */
async function seriesStatusOrNull(
  conn: EngineConnection,
  key: DataSeriesKey,
): Promise<DataSeriesStatus | null> {
  try {
    return await getDataSeriesStatus(conn.endpoint, conn.apiKey, key, engineSignal());
  } catch {
    return null;
  }
}

function safeRoute(): { useStream: boolean; reason: string } {
  try {
    return routeEngineRun(getCachedEngineCapabilities());
  } catch {
    return { useStream: false, reason: 'error' };
  }
}

function livePrefs(): Record<string, unknown> {
  return {
    active: store.live?.active ?? false,
    streamId: store.live?.streamId ?? null,
    rerunOn: store.live?.rerunOn ?? null,
    preferAfterLoad: store.live?.preferAfterLoad ?? null,
  };
}

function findGaps(bars: readonly Bar[], stepSec: number): Record<string, unknown> {
  const slots: Array<{ after: number; to: number; missing: number }> = [];
  let total = 0;
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]?.time ?? 0;
    const cur = bars[i]?.time ?? 0;
    if (!(prev > 0) || !(cur > prev)) continue;
    const missing = Math.floor((cur - prev) / stepSec) - 1;
    if (missing <= 0) continue;
    total += missing;
    if (slots.length < GAP_SLOTS_MAX) slots.push({ after: prev, to: cur, missing });
  }
  return {
    stepSec,
    total,
    slots,
    truncated: slots.length >= GAP_SLOTS_MAX && total > slots.reduce((s, g) => s + g.missing, 0),
  };
}

/**
 * `chart.bars` — bounded OHLCV windows plus the missing-slot map.
 *
 * Answers "what is the chart actually holding?" without shipping 5 000 rows:
 * `tail` (default 50, cap {@link BAR_VIEW_MAX}) for the live end — where the
 * forming bar shows or doesn't — `head` for the far end, and `gaps` for holes
 * punched by a repair/paint bug. Legitimate session gaps (weekends) appear as
 * gaps too: the report is factual, not a verdict (see `chart.lag`).
 */
export function chartBarsView(p: Record<string, unknown>): Record<string, unknown> {
  const bars = (store.bars || []) as Bar[];
  const interval = String(store.interval || '1m');
  const stepSec = Math.max(1, intervalToSec(interval) || 60);
  const limit = clampInt(p.limit, 1, BAR_VIEW_MAX, 50);
  const headN = p.head === undefined || p.head === null ? 0 : clampInt(p.head, 1, BAR_VIEW_MAX, 0);
  const now = nowSec();
  const wallSlot = now - (now % stepSec);
  const last = bars.length ? bars[bars.length - 1] : undefined;
  return {
    symbol: store.symbol,
    interval,
    stepSec,
    summary: barSummary(bars),
    tail: boundedBarRows(bars, limit),
    ...(headN ? { head: boundedBarRows(bars.slice(0, headN), headN) } : {}),
    ...(p.gaps === false ? {} : { gaps: findGaps(bars, stepSec) }),
    formingBar: last ? { time: last.time, current: last.time === wallSlot } : null,
  };
}

/**
 * `chart.lag` — the lag ledger for one question: *why is the chart behind?*
 *
 * Compares the chart tail against three clocks — the wall-clock bar slot, the
 * venue's own last tick (fresh tick wins; it honours session venues that hold
 * their last close), and the engine's stored series — then returns a verdict
 * code plus every raw number it used, so "always one bar behind" and "frozen
 * since boot" read apart at a glance.
 *
 * The engine read is one `GET /data/series` (in-tab key, 6 s budget,
 * fail-soft). Pass `engine: false` for the purely local view.
 */
export async function chartLagView(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const interval = String(store.interval || '1m');
  const stepSec = Math.max(1, intervalToSec(interval) || 60);
  const bars = (store.bars || []) as Bar[];
  const chartLast = newestBarTime(bars);
  const last = bars.length ? bars[bars.length - 1] : undefined;

  // Venue clock: a fresh tick for this symbol beats the wall clock (equities /
  // FX hold their last close outside session hours).
  const tick = store.telemetry?.lastTick ?? null;
  const tickAgeMs = tick ? Math.max(0, nowMs - Number(tick.at || 0)) : null;
  const tickFresh =
    tick !== null && tick.symbol === store.symbol && tickAgeMs !== null && tickAgeMs <= 2 * stepSec * 1000;
  const tickSlot = tick && tick.time > 0 ? Math.floor(tick.time / stepSec) * stepSec : null;
  const wallSlot = now - (now % stepSec);
  const useTick = tickFresh && tickSlot !== null;
  const venueSource = useTick ? 'tick' : 'wall-clock';
  const venueNow = useTick && tickSlot !== null ? tickSlot : now;
  const lag = chartLast > 0 ? stepsBehind(chartLast, venueNow, interval) : null;

  let verdict: Record<string, unknown>;
  if (!chartLast) {
    verdict = { code: 'empty', bars: 0, clock: venueSource, message: 'chart holds no bars' };
  } else if (lag === 0) {
    verdict = {
      code: 'live',
      bars: 0,
      clock: venueSource,
      message: 'chart tail is the current (forming) bar',
    };
  } else if (lag === 1) {
    verdict = {
      code: 'one-bar-behind',
      bars: 1,
      clock: venueSource,
      message: 'chart tail is the last closed bar — the forming bar is not on the chart (1 bar behind)',
    };
  } else {
    verdict = {
      code: 'behind',
      bars: lag,
      clock: venueSource,
      message: `chart is ${lag} bars behind the venue clock`,
    };
  }

  let engine: Record<string, unknown>;
  if (p.engine === false) {
    engine = { skipped: true, reason: 'disabled' };
  } else {
    const conn = engineConnection();
    if (!conn) {
      engine = { skipped: true, reason: 'no-endpoint' };
    } else {
      try {
        const st = await getDataSeriesStatus(
          conn.endpoint,
          conn.apiKey,
          chartSeriesKeyObject(),
          engineSignal(),
        );
        const view = seriesView(st, interval, chartLast, now);
        engine = {
          ...(view || {}),
          formingHold: st.newest != null && chartLast > 0 ? st.newest >= chartLast : null,
        };
      } catch (e: unknown) {
        engine = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  const engineNewest = typeof engine.newest === 'number' ? engine.newest : null;
  return {
    now: { ms: nowMs, sec: now },
    interval,
    stepSec,
    chart: {
      count: bars.length,
      lastTime: chartLast || null,
      lastClose: last && typeof last.close === 'number' ? last.close : null,
      lagBars: chartLast > 0 ? stepsBehind(chartLast, now, interval) : null,
      hasFormingBar: chartLast > 0 && chartLast >= wallSlot,
    },
    venue: {
      wallSlotSec: wallSlot,
      source: venueSource,
      tick: tick
        ? {
            timeSec: tick.time,
            slotSec: tickSlot,
            ageMs: tickAgeMs,
            symbol: tick.symbol ?? null,
            price: tick.price,
            fresh: tickFresh,
          }
        : null,
      note:
        tick && !tickFresh
          ? 'venue tick is older than 2 intervals — the wall-clock verdict may over-count outside session hours'
          : null,
    },
    feed: chartFeedChip(),
    scriptStatus: Object.fromEntries(
      Object.entries(store.live?.scriptStatus || {}).map(([id, s]) => [id, chipOf(s)]),
    ),
    engine,
    engineLagBars: engineNewest ? stepsBehind(engineNewest, now, interval) : null,
    telemetry: {
      engine: store.telemetry?.engine ?? null,
      stream: store.telemetry?.stream ?? null,
    },
    verdict,
  };
}

/**
 * `engine.get` — sanitized view of the engine plane: which engine, what it
 * claims to support, how the router profiles it, its cached `/health`, the
 * chart data session the drive ticks, and its HUD telemetry.
 *
 * The API key is reported as `hasApiKey` only; `configFields` lists the shape
 * of the active config (names, never values) so "did the endpoint/mode actually
 * stick?" is answerable.
 */
export function enginePlaneView(): Record<string, unknown> {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = getActiveEngineConfig() || {};
  } catch {
    cfg = {};
  }
  const endpoint = String(cfg.endpoint || '').trim() || String(store.endpoint || '').trim();
  let caps: unknown = null;
  try {
    caps = getCachedEngineCapabilities();
  } catch {
    caps = null;
  }
  return {
    id: getActiveEngineId(),
    engine: store.engine,
    endpoint: endpoint || null,
    hasApiKey: Boolean(String(cfg.apiKey || '').trim()),
    mode: cfg.mode != null && cfg.mode !== '' ? String(cfg.mode) : null,
    configFields: Object.keys(cfg).sort(),
    capabilities: caps,
    route: safeRoute(),
    health: getCachedEngineHealth(),
    session: getChartSessionInfo(),
    live: livePrefs(),
    telemetry: store.telemetry?.engine ?? null,
    status: store.status,
    statusMessage: store.statusMessage,
  };
}

/**
 * `engine.series` — read the engine's *own* store for a series (chart default).
 *
 * This is the ground truth behind "the chart is a bar behind": `newest` is the
 * engine's newest persisted bar, `updatedAgeSec` says whether anything is
 * writing it at all, and `stale` is the same verdict the paint guard uses.
 */
export async function engineSeriesView(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = keyFromPayload(p);
  const conn = requireEngineConnection();
  const interval = key.interval;
  const now = nowSec();
  const chartLast = newestBarTime(store.bars);
  let st: DataSeriesStatus;
  try {
    st = await getDataSeriesStatus(conn.endpoint, conn.apiKey, key, engineSignal());
  } catch (e: unknown) {
    fail('ENGINE_UNREACHABLE', e instanceof Error ? e.message : String(e));
  }
  const canonical = canonicalSeriesKey(key);
  const chartCanonical = canonicalSeriesKey(chartSeriesKeyObject());
  const view = seriesView(st, interval, chartLast, now);
  return {
    requested: `${canonical.exchange}|${canonical.market}|${canonical.symbol}|${canonical.interval}`,
    matchesChart:
      canonical.exchange === chartCanonical.exchange &&
      canonical.market === chartCanonical.market &&
      canonical.symbol === chartCanonical.symbol &&
      canonical.interval === chartCanonical.interval,
    ...(view || {}),
  };
}

/**
 * `engine.tick` — force one drive tick past the 10 s throttle and report the
 * before/after series bounds plus the raw engine envelope (`appended`,
 * `forming`, `unchanged`, `stale`).
 *
 * The envelope rides the drive's `tick` seam so the throttle bookkeeping still
 * runs: an agent pokes the engine once and sees exactly whether *its* tick
 * moved the series, or whether the engine's own feed is the thing that's dead.
 */
export async function engineTickView(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = keyFromPayload(p);
  const conn = requireEngineConnection();
  const interval = key.interval;
  const chartLast = newestBarTime(store.bars);
  const marketNow = Math.max(0, Math.floor(num(p.marketNow) ?? chartLast));
  const before = await seriesStatusOrNull(conn, key);
  const captured: { tick: SeriesDriveTick | null } = { tick: null };
  const started = Date.now();
  const outcome = await driveEngineSeries({
    endpoint: conn.endpoint,
    apiKey: conn.apiKey,
    key,
    marketNow,
    minGapMs: 0,
    historyBars: chartWindowLimit(),
    tick: async (endpoint, apiKey, k) => {
      const t = await tickChartDataSession(endpoint, apiKey, k, chartWindowLimit());
      captured.tick = t;
      return t;
    },
  });
  const after = await seriesStatusOrNull(conn, key);
  const now = nowSec();
  return {
    outcome,
    ms: Date.now() - started,
    tick: captured.tick,
    before: seriesView(before, interval, chartLast, now),
    after: seriesView(after, interval, chartLast, now),
    advancedBars:
      before && after ? (after.newest ?? 0) - (before.newest ?? 0) : null,
  };
}

/**
 * `engine.repair` — force the stale-series broker (`force: true` skips the
 * 60 s cooldown) and report how it healed: `via: 'local'` uploads AXIS'
 * freshest window, `via: 'fetch'` asks the engine to pull from its own feed.
 * Before/after bounds show whether the engine's `newest` actually moved.
 */
export async function engineRepairView(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = keyFromPayload(p);
  const conn = requireEngineConnection();
  const interval = key.interval;
  const chartLast = newestBarTime(store.bars);
  const historyBars = num(p.historyBars);
  const before = await seriesStatusOrNull(conn, key);
  const started = Date.now();
  const result = await repairStaleEngineSeries({
    endpoint: conn.endpoint,
    apiKey: conn.apiKey,
    key,
    ...(historyBars && historyBars > 0 ? { historyBars } : {}),
    force: true,
  });
  const after = await seriesStatusOrNull(conn, key);
  const now = nowSec();
  return {
    ...result,
    ms: Date.now() - started,
    before: seriesView(before, interval, chartLast, now),
    after: seriesView(after, interval, chartLast, now),
    advancedBars: before && after ? (after.newest ?? 0) - (before.newest ?? 0) : null,
  };
}

/**
 * `stream.get` — the live plane in one read: the router's stream/calculator
 * decision, the wire (`null` until something subscribed — itself the answer to
 * "why is there no subscription?"), every feed chip and script status, plus
 * the stream/engine telemetry the HUD shows.
 */
export function streamPlaneView(): Record<string, unknown> {
  const feeds = Object.fromEntries(
    Object.entries(store.live?.feeds || {}).map(([key, f]) => [key, { key, ...chipOf(f) }]),
  );
  return {
    routeActive: streamRouteActive(),
    route: safeRoute(),
    live: livePrefs(),
    wire: streamWireState(),
    feeds,
    scriptStatus: Object.fromEntries(
      Object.entries(store.live?.scriptStatus || {}).map(([id, s]) => [id, chipOf(s)]),
    ),
    telemetry: {
      stream: store.telemetry?.stream ?? null,
      engine: store.telemetry?.engine ?? null,
    },
    lastTick: store.telemetry?.lastTick ?? null,
  };
}

/**
 * `stream.reset` — drop the engine socket and every subscription, then
 * (default) probe one re-subscribe.
 *
 * The wire singleton is discarded, not just closed: `Redesign2WsClient` is
 * terminal after `disconnect()`, so the next tick rebuilds from the *current*
 * engine config. That recovers a changed API key/endpoint, a socket superseded
 * by a second tab, a wedged reconnect loop, or a failure cooldown — the exact
 * states "no live ticks forever" reduces to.
 *
 * The re-subscribe runs against the live stream route only (a calculator
 * engine has nothing to subscribe) and is raced against a report timeout: the
 * attempt keeps running, and `stream.get` shows its outcome.
 */
export async function streamResetView(p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const reset = resetStreamWire();
  let resubscribe: Record<string, unknown> = { requested: false, reason: 'disabled' };
  if (p.resubscribe !== false) {
    if (!store.live?.active) {
      resubscribe = { requested: false, reason: 'live-off' };
    } else if (!streamRouteActive()) {
      resubscribe = { requested: false, reason: 'route-not-stream' };
    } else {
      const attempt = streamSeriesTick(0).then(
        (rerun) => ({ ok: true, rerun }),
        (e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<{ ok: boolean; error: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, error: `resubscribe not confirmed within ${RESUBSCRIBE_PROBE_MS}ms` }),
          RESUBSCRIBE_PROBE_MS,
        );
      });
      try {
        resubscribe = { requested: true, ...(await Promise.race([attempt, timeout])) };
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  return { ok: true, ...reset, resubscribe };
}
