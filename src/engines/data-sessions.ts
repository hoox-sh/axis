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
 * Engine-owned data sessions (PYNE Pro, every-tick live mode).
 *
 * CALCULATOR PROFILE ONLY (F-20): kept for engines without `live_stream`.
 * Stream-profile engines ensure history server-side and push snapshots over
 * `WS /ws/live` — they never call this broker. Do not extend this module;
 * new behavior belongs in `src/engine/`.
 *
 * The engine owns the OHLCV series for `(exchange, market, symbol, interval)`.
 * AXIS only sends identity and script; it never ships bars for a session. When
 * the engine reports a cache miss, this module brokers the fill: auto-upload the
 * matching local Data Manager dataset if one exists, otherwise ask the engine to
 * fetch from the exchange. Wire contract: `docs/devops/engine-owned-data-plane.mdx`.
 *
 * @module engines/data-sessions
 */

import type { Bar } from '../store/types';
import type { EngineDataSessionRequest } from '../plugins/types';
import { providerDatasetLock, pyneMarket } from '../data/provider';
import { FALLBACK_MAJORS } from '../data/symbol-catalog';
import { normalizeHistoricalBars } from '../data/parse-bars';
import { pairFormSymbol } from '../engine/market-identity';
import { resolveSessionPayload } from './session-delta';
import { ENGINE_SERIES_STALE_STEPS, newestBarTime, seriesBehind } from './series-freshness';
import { combineAbortSignals } from '../utils/fetch-timeout';
import { BoundedMap } from '../utils/bounded-map';

/** Max bars per `POST /data/series/provide` request (contract). */
export const DATA_PROVIDE_CHUNK = 5_000;

/** Identity of an engine-owned series. */
export interface DataSeriesKey {
  exchange: string;
  market?: string;
  symbol: string;
  interval: string;
}

/** Normalized series key (lowercase exchange, uppercase symbol, market default `spot`). */
export interface CanonicalSeriesKey {
  exchange: string;
  market: string;
  symbol: string;
  interval: string;
}

export interface DataSeriesStatus {
  key: string;
  count: number;
  oldest: number | null;
  newest: number | null;
  updatedAt: number | null;
}

export interface DataSessionMiss {
  key: string;
  have: number;
  need: number;
}

export interface DataSessionHandle {
  sessionId: string;
  payload: Record<string, unknown>;
  /** How the series was filled before the session was created. */
  provisioned: 'none' | 'local' | 'fetch';
}

export type DataSessionCreateResult =
  | { ok: true; sessionId: string; payload: Record<string, unknown> }
  | { ok: false; miss: DataSessionMiss }
  | { ok: false; error: string };

/** Canonical series key used by the engine store (`exchange|market|SYMBOL|interval`, pair-form). */
export function canonicalSeriesKey(k: DataSeriesKey): CanonicalSeriesKey {
  return {
    exchange: String(k.exchange || '').trim().toLowerCase(),
    market: pyneMarket(k.market),
    symbol: pairFormSymbol(String(k.symbol || ''), FALLBACK_MAJORS),
    interval: String(k.interval || '').trim(),
  };
}

export function seriesKeyString(k: DataSeriesKey): string {
  const c = canonicalSeriesKey(k);
  return `${c.exchange}|${c.market}|${c.symbol}|${c.interval}`;
}

function seriesQuery(k: DataSeriesKey): string {
  const c = canonicalSeriesKey(k);
  return new URLSearchParams({
    exchange: c.exchange,
    market: c.market,
    symbol: c.symbol,
    interval: c.interval,
  }).toString();
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Minimum gap between automatic staleness repairs for one series (ms).
 * A frozen series is repaired with at most one status read plus one upload (or
 * engine fetch) per minute instead of one per venue tick.
 */
export const SERIES_REPAIR_COOLDOWN_MS = 60_000;

/** Default window pushed/asked for by {@link repairStaleEngineSeries}. */
const DEFAULT_REPAIR_BARS = 5_000;

/**
 * Pure staleness check for an engine series bound: is `newestSec` more than
 * {@link ENGINE_SERIES_STALE_STEPS} interval steps behind `nowSec`?
 *
 * An unknown / non-positive bound counts as stale: the caller can only lose a
 * cheap no-op upload, while assuming freshness would leave the series frozen
 * forever (see {@link repairStaleEngineSeries}).
 */
export function seriesIsStale(
  newestSec: number | null | undefined,
  interval: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  const newest =
    typeof newestSec === 'number' && Number.isFinite(newestSec) && newestSec > 0 ? newestSec : 0;
  if (newest <= 0) return true;
  return seriesBehind(newest, Math.floor(nowSec), interval, ENGINE_SERIES_STALE_STEPS);
}

function authHeaders(apiKey: string, json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (apiKey) {
    h['X-API-Key'] = apiKey;
    h.Authorization = `Bearer ${apiKey}`;
  }
  return h;
}

interface DataCallResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

async function call(
  endpoint: string,
  path: string,
  init: { method: string; body?: unknown },
  apiKey: string,
  signal?: AbortSignal,
): Promise<DataCallResult> {
  const res = await fetch(`${endpoint.replace(/\/$/, '')}${path}`, {
    method: init.method,
    headers: authHeaders(apiKey, init.body !== undefined),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: combineAbortSignals(REQUEST_TIMEOUT_MS, signal),
  });
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

function errorMessage(r: DataCallResult, fallback: string): string {
  const msg = r.body.message ?? r.body.error;
  return typeof msg === 'string' && msg ? msg : `${fallback} (HTTP ${r.status})`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `GET /data/series` — how many bars the engine already holds for a key. */
export async function getDataSeriesStatus(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
  signal?: AbortSignal,
): Promise<DataSeriesStatus> {
  const r = await call(endpoint, `/data/series?${seriesQuery(key)}`, { method: 'GET' }, apiKey, signal);
  if (!r.ok) throw new Error(errorMessage(r, 'series status failed'));
  return {
    key: typeof r.body.key === 'string' ? r.body.key : seriesKeyString(key),
    count: num(r.body.count) ?? 0,
    oldest: num(r.body.oldest),
    newest: num(r.body.newest),
    updatedAt: num(r.body.updated_at),
  };
}

/**
 * `POST /data/series/provide` — upload bars AXIS already holds locally.
 * Chunked to the contract limit; returns summed counts.
 */
export async function provideDataSeries(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
  bars: readonly Bar[],
  source: string,
  signal?: AbortSignal,
): Promise<{ added: number; updated: number; count: number }> {
  const c = canonicalSeriesKey(key);
  let added = 0;
  let updated = 0;
  let count = 0;
  for (let i = 0; i < bars.length; i += DATA_PROVIDE_CHUNK) {
    const chunk = bars.slice(i, i + DATA_PROVIDE_CHUNK).map((b) => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      // A missing volume stays missing - coercing it to 0 would store a real
      // zero volume where the venue never reported one.
      ...(b.volume !== undefined ? { volume: b.volume } : {}),
    }));
    const r = await call(
      endpoint,
      '/data/series/provide',
      { method: 'POST', body: { ...c, bars: chunk, source } },
      apiKey,
      signal,
    );
    if (!r.ok) throw new Error(errorMessage(r, 'series provide failed'));
    added += num(r.body.added) ?? 0;
    updated += num(r.body.updated) ?? 0;
    count = num(r.body.count) ?? count;
  }
  return { added, updated, count };
}

/** `POST /data/series/fetch` — the engine pulls `historyBars` from its exchange feed. */
export async function fetchDataSeries(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
  historyBars: number,
  signal?: AbortSignal,
): Promise<{ fetched: number; count: number }> {
  const r = await call(
    endpoint,
    '/data/series/fetch',
    { method: 'POST', body: { ...canonicalSeriesKey(key), history_bars: historyBars } },
    apiKey,
    signal,
  );
  if (!r.ok) throw new Error(errorMessage(r, 'series fetch failed'));
  return { fetched: num(r.body.fetched) ?? 0, count: num(r.body.count) ?? 0 };
}

/**
 * `DELETE /data/series` — drop the engine's stored series for one key.
 *
 * The engine keeps its own copy of the venue's OHLCV (a shared cache). A
 * dataset flush that only clears AXIS leaves that copy behind: the engine
 * keeps serving the old (holed, stale) window, and the chart mirrors it.
 *
 * Per key — the engine's store is shared, so a purge never touches another
 * series.
 */
export async function deleteDataSeries(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
  signal?: AbortSignal,
): Promise<{ removed: number }> {
  const r = await call(
    endpoint,
    `/data/series?${seriesQuery(key)}`,
    { method: 'DELETE' },
    apiKey,
    signal,
  );
  if (!r.ok) throw new Error(errorMessage(r, 'series delete failed'));
  return { removed: num(r.body.removed) ?? 0 };
}

/** `GET /data/series/bars` — newest window for chart paint (caller keeps it in memory only).
 * Engine bars go through the same normalization as venue bars
 * ({@link normalizeHistoricalBars}: ms→seconds via `toUnixSeconds`, `sanitizeBar`
 * repair/drop of null-NaN OHLC, dedupe by time with last-wins, sort ascending).
 * Always returns chart-safe `Bar[]` in unix seconds — never ms times or
 * unsorted data — so `setBarsQuiet` / `setDataToChart` cannot hit the LWC
 * `Value is null` path on engine-owned paints.
 */
export async function getDataSeriesBars(
  endpoint: string,
  apiKey: string,
  key: DataSeriesKey,
  limit: number,
  signal?: AbortSignal,
): Promise<Bar[]> {
  const r = await call(
    endpoint,
    `/data/series/bars?${seriesQuery(key)}&limit=${Math.max(1, Math.floor(limit))}`,
    { method: 'GET' },
    apiKey,
    signal,
  );
  if (!r.ok) throw new Error(errorMessage(r, 'series bars failed'));
  const raw = Array.isArray(r.body.bars) ? r.body.bars : [];
  return normalizeHistoricalBars(raw);
}

export interface DataSessionCreateInput {
  key: DataSeriesKey;
  historyBars: number;
  script: string;
  inputs?: Record<string, unknown>;
  libraries?: unknown[];
  profiler?: boolean;
  symbol?: string;
}

/**
 * `POST /data/session` — one attempt. A `409 DATA_MISS` is returned as a
 * structured miss so the broker can provision and retry.
 */
export async function createDataSession(
  endpoint: string,
  apiKey: string,
  input: DataSessionCreateInput,
  signal?: AbortSignal,
): Promise<DataSessionCreateResult> {
  // PYNE persists `symbol` as the store row; a load-form ticker would split it from MCP/stream.
  const body = {
    ...canonicalSeriesKey(input.key),
    history_bars: Math.max(1, Math.floor(input.historyBars)),
    script: input.script,
    ...(input.inputs && Object.keys(input.inputs).length ? { inputs: input.inputs } : {}),
    ...(input.libraries?.length ? { libraries: input.libraries } : {}),
    ...(input.profiler ? { profiler: true } : {}),
  };
  const r = await call(endpoint, '/data/session', { method: 'POST', body }, apiKey, signal);
  if (r.status === 409 && r.body.code === 'DATA_MISS') {
    return {
      ok: false,
      miss: {
        key: typeof r.body.key === 'string' ? r.body.key : seriesKeyString(input.key),
        have: num(r.body.have) ?? 0,
        need: num(r.body.need) ?? input.historyBars,
      },
    };
  }
  const sessionId = r.body.session_id;
  if (!r.ok || typeof sessionId !== 'string' || !sessionId || r.body.status === 'error') {
    return { ok: false, error: errorMessage(r, 'data session create failed') };
  }
  return { ok: true, sessionId, payload: r.body };
}

/**
 * Endpoints that rejected the `delta` flag (`UNKNOWN_FIELDS` — old backends).
 * Ticks there go plain; the full envelope is adopted as usual. Cleared with
 * the session memo (test helper below).
 */
const noDeltaEndpoints = new Set<string>();

/**
 * `POST /data/session/{id}/tick` — identity only. The engine fetches its own
 * new candles; AXIS never sends bars. `gone` means the session expired and
 * must be recreated.
 *
 * With `opts.delta`, a delta envelope is requested first (tail cells instead
 * of full 10k-bar series) and plain-retried when the backend does not know
 * the flag. The chart tick passes no delta — its minimal script yields an
 * already-tiny envelope, and it only reads the outcome flags.
 */
export async function tickDataSession(
  endpoint: string,
  apiKey: string,
  sessionId: string,
  identity: { exchange: string; symbol: string },
  signal?: AbortSignal,
  opts?: { delta?: boolean },
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string; gone: boolean }> {
  const plain = {
    exchange: String(identity.exchange || '').trim().toLowerCase(),
    symbol: pairFormSymbol(String(identity.symbol || ''), FALLBACK_MAJORS),
  };
  const wantDelta = opts?.delta === true && !noDeltaEndpoints.has(endpoint);
  const bodies = wantDelta ? [{ ...plain, delta: true }, plain] : [plain];
  for (let i = 0; i < bodies.length; i++) {
    const r = await call(
      endpoint,
      `/data/session/${encodeURIComponent(sessionId)}/tick`,
      { method: 'POST', body: bodies[i] },
      apiKey,
      signal,
    );
    if (!r.ok || r.body.status === 'error') {
      const code = (r.body as { code?: unknown }).code;
      if (wantDelta && i === 0 && code === 'UNKNOWN_FIELDS') {
        noDeltaEndpoints.add(endpoint);
        continue;
      }
      return {
        ok: false,
        error: errorMessage(r, 'data session tick failed'),
        gone:
          r.status === 404 ||
          code === 'NO_SESSION' ||
          code === 'SESSION_KEY_MISMATCH',
      };
    }
    return { ok: true, payload: r.body };
  }
  return { ok: false, error: 'data session tick failed', gone: false };
}

export interface EnsureDataSessionOptions extends DataSessionCreateInput {
  endpoint: string;
  apiKey: string;
  signal?: AbortSignal;
  /**
   * Local Data Manager bars for the same identity (oldest → newest). Defaults
   * to the dataset store for `(exchange, symbol, interval)`; injectable for tests.
   */
  localBars?: () => Promise<readonly Bar[]>;
}

/**
 * Data Manager dataset source ids that can hold this engine series, best first.
 *
 * Datasets are keyed by the **source plugin id** (`binance-rest|BTCUSDT|1m`),
 * not by the canonical venue (`binance|BTCUSDT|1m`) — a bare
 * `getDataset(exchange, …)` never matches, so the broker skipped the local
 * upload and fell through to the engine fetch (which needs ccxt on the host).
 * The Data Manager selection is preferred when it names the same venue; the
 * active source / provider session follow; the bare exchange stays last for
 * datasets written by older clients.
 */
async function localDatasetSourceIds(key: DataSeriesKey): Promise<string[]> {
  const c = canonicalSeriesKey(key);
  const ids: string[] = [];
  const push = (id: unknown): void => {
    const s = String(id || '').trim();
    if (s && s !== 'data-manager' && !ids.includes(s)) ids.push(s);
  };
  try {
    const { exchangeForSource } = await import('../data/symbol-exchange');
    const matchesVenue = (sourceId: string): boolean => {
      const venue = String(exchangeForSource(sourceId) || '').toLowerCase();
      return !!venue && venue !== 'generic' && venue === c.exchange;
    };
    try {
      const { getDataManagerSelection } = await import('../data/data-manager-source');
      const sel = getDataManagerSelection();
      if (sel?.sourceId && matchesVenue(sel.sourceId)) push(sel.sourceId);
    } catch {
      /* selection optional */
    }
    try {
      const { store } = await import('../store');
      if (matchesVenue(String(store.provider?.sourceId || ''))) push(store.provider?.sourceId);
      if (matchesVenue(String(store.source || ''))) push(store.source);
    } catch {
      /* store optional in tests */
    }
    if (matchesVenue(`${c.exchange}-rest`)) push(`${c.exchange}-rest`);
  } catch {
    /* symbol-exchange optional */
  }
  // Legacy direct key (older writers stored under the bare exchange).
  push(c.exchange);
  return ids;
}

/**
 * Data Manager datasets are keyed by AXIS load-form (`BTCUSDT`); the engine
 * series is pair-form (`BTC/USDT`). Lookup tries both plus the compact form
 * of a paired symbol so a pair-form drive still finds the local window.
 */
function localLookupSymbols(key: DataSeriesKey): string[] {
  const raw = String(key.symbol || '').trim().toUpperCase();
  const paired = pairFormSymbol(raw, FALLBACK_MAJORS);
  const compact = paired.includes('/') ? paired.replaceAll('/', '') : paired;
  const out: string[] = [];
  for (const s of [raw, paired, compact]) {
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

async function defaultLocalBars(key: DataSeriesKey): Promise<readonly Bar[]> {
  const c = canonicalSeriesKey(key);
  const { getDataset } = await import('../data/dataset-store');
  let authMode: unknown;
  try {
    const { store } = await import('../store');
    authMode = store.provider?.authMode;
  } catch {
    /* store optional in tests */
  }
  // `c.market` is the PYNE wire name; the dataset key uses the AXIS market.
  const lock = providerDatasetLock({ market: c.market, authMode });
  const candidates = await localDatasetSourceIds(key);
  const symbols = localLookupSymbols(key);
  for (const sourceId of candidates) {
    for (const symbol of symbols) {
      try {
        const bars = await getDataset(sourceId, symbol, c.interval, lock);
        if (bars.length) return bars;
      } catch {
        /* try the next candidate key */
      }
    }
  }
  return [];
}

/**
 * Create a data session, brokering cache misses:
 *
 * 1. create → hit returns immediately;
 * 2. miss + shared series provisioning (one local upload or engine fetch per
 *    `(endpoint, series)`, awaited by concurrent owners) → retry;
 * 3. still short after a local upload → clamp the window to what the engine
 *    holds and retry once (the apply path tail-aligns the shorter series);
 * 4. still missing → throw (no endless loop).
 *
 * Only identity and script leave the browser; bars travel only in step 2, and
 * only when the Data Manager already holds them.
 */
export async function ensureDataSession(opts: EnsureDataSessionOptions): Promise<DataSessionHandle> {
  const need = Math.max(1, Math.floor(opts.historyBars));
  const input: DataSessionCreateInput = {
    key: opts.key,
    historyBars: need,
    script: opts.script,
    inputs: opts.inputs,
    libraries: opts.libraries,
    profiler: opts.profiler,
    symbol: opts.symbol,
  };
  const memoKey = seriesProvisionMemoKey(opts.endpoint, opts.key);
  const attempt = (historyBars: number = need) =>
    createDataSession(opts.endpoint, opts.apiKey, { ...input, historyBars }, opts.signal);

  const first = await attempt();
  if (first.ok) {
    return { sessionId: first.sessionId, payload: first.payload, provisioned: 'none' };
  }
  if (!('miss' in first)) throw new Error(first.error);

  // Series memo fast path: a sibling owner (or the chart session) already
  // filled this window, so the miss may be stale — a concurrent provision that
  // landed between our create and now, or a restarted engine view. One cheap
  // create retries before paying for another full multi-chunk upload. The
  // retry is the correctness check — the engine stays the source of truth and
  // the memo is only a skip-upload hint, so a genuinely short engine simply
  // misses again and falls through to provisioning below.
  const memo = seriesProvisionMemo.get(memoKey);
  if (memo && memo.historyBars >= need) {
    const retry = await attempt();
    if (retry.ok) {
      return { sessionId: retry.sessionId, payload: retry.payload, provisioned: memo.via };
    }
    if (!('miss' in retry)) throw new Error(retry.error);
  }

  // Shared provisioning: concurrent owners converge on one fill (local upload
  // or engine fetch) for the same series instead of each uploading the full
  // window. Per-script sessions stay separate — only this step is shared.
  const via = await sharedProvisionSeries(opts, need, memoKey);
  const second = await attempt();
  if (second.ok) {
    return { sessionId: second.sessionId, payload: second.payload, provisioned: via };
  }
  if (!('miss' in second)) throw new Error(second.error);
  // The engine still reports short — but it now holds exactly what was just
  // uploaded. Ask for that count instead of the original window so a smaller
  // local dataset still yields a session (the apply path tail-aligns the
  // shorter series); never fall through to the exchange fetch for data the
  // host may not be able to download (no ccxt on the host).
  const have = Math.max(0, Math.floor(second.miss.have));
  if (via === 'local' && have > 0 && have < need) {
    const clamped = await attempt(have);
    if (clamped.ok) {
      return { sessionId: clamped.sessionId, payload: clamped.payload, provisioned: via };
    }
    if (!('miss' in clamped)) throw new Error(clamped.error);
    throw new Error(
      `data session still short after local upload: ${clamped.miss.key} have ${clamped.miss.have} / need ${clamped.miss.need}`,
    );
  }
  if (via === 'local') {
    // The upload landed but the engine still cannot satisfy the window
    // (nothing stuck, or a shape the create does not accept) — fall back to
    // the engine fetch exactly as the unshared path did, then retry once.
    await fetchDataSeries(opts.endpoint, opts.apiKey, opts.key, need, opts.signal);
    noteSeriesProvisioned(memoKey, need, 'fetch');
    const third = await attempt();
    if (third.ok) {
      return { sessionId: third.sessionId, payload: third.payload, provisioned: 'fetch' };
    }
    if (!('miss' in third)) throw new Error(third.error);
    throw new Error(
      `data session still short after fetch: ${third.miss.key} have ${third.miss.have} / need ${third.miss.need}`,
    );
  }
  throw new Error(
    `data session still short after fetch: ${second.miss.key} have ${second.miss.have} / need ${second.miss.need}`,
  );
}

/** Live-session memo: one engine session per (endpoint, owner, series). */
interface DataSessionMemo {
  sessionId: string;
  fingerprint: string;
  /** Last full payload (merged from deltas) for delta resolution. */
  payload?: Record<string, unknown>;
}

const dataSessionMemo = new Map<string, DataSessionMemo>();

/**
 * Series-level provisioning memo: one entry per (endpoint, series), shared
 * across owners. The owner memo above (endpoint|owner|series + script
 * fingerprint) keeps per-script sessions for evaluation isolation — but the
 * *provisioning* step that fills the engine's series is identical for every
 * sibling indicator on the same chart, so without this every new indicator
 * re-uploaded the full window (`DATA_PROVIDE_CHUNK × N` requests).
 *
 * Correctness: the entry records the largest window this client is known to
 * have filled. Reuse is verified, never trusted — a covered miss still
 * retries the create first, and the engine (source of truth) must answer hit
 * before any upload is skipped. Coverage only ever grows (`take max`); a
 * larger window re-provisions and widens it. The endpoint is part of the key
 * so provisioning never leaks across engines.
 */
interface SeriesProvision {
  /** Largest window this client is known to have filled on the engine. */
  historyBars: number;
  /** How the recorded window was filled. */
  via: 'local' | 'fetch';
  /** Wall clock of the recording (introspection only). */
  at: number;
}

const seriesProvisionMemo = new Map<string, SeriesProvision>();
/**
 * In-flight fills shared across owners. Concurrent indicator adds / reruns
 * stampede `ensureDataSession` together; the first caller uploads (or fetches)
 * while the rest await the same promise instead of each paying a full upload.
 */
const seriesProvisionInflight = new Map<string, Promise<'local' | 'fetch'>>();

/**
 * Wall clock of the last automatic staleness repair per (endpoint, series) —
 * the cooldown that keeps a frozen engine from being re-checked every tick.
 */
/**
 * (endpoint + series) → timestamp of the last repair attempt.
 *
 * Capped: a long session that walks many series must not keep one memo per
 * series forever.
 */
/** Cap on remembered series memos — one per (endpoint + series) pair. */
const SERIES_MEMO_MAX = 200;
const seriesRepairAt = new BoundedMap<string, number>(SERIES_MEMO_MAX);

function seriesProvisionMemoKey(endpoint: string, key: DataSeriesKey): string {
  return `${endpoint.replace(/\/$/, '')}|${seriesKeyString(key)}`;
}

function noteSeriesProvisioned(memoKey: string, historyBars: number, via: 'local' | 'fetch'): void {
  const need = Math.max(1, Math.floor(historyBars));
  const prev = seriesProvisionMemo.get(memoKey);
  if (prev && prev.historyBars >= need) return;
  seriesProvisionMemo.set(memoKey, { historyBars: need, via, at: Date.now() });
}

/**
 * Fill the engine's series once per (endpoint, series): upload the newest
 * local window when the Data Manager holds it, else ask the engine to fetch
 * from its exchange feed. Concurrent owners share the in-flight fill.
 */
function sharedProvisionSeries(
  opts: EnsureDataSessionOptions,
  need: number,
  memoKey: string,
): Promise<'local' | 'fetch'> {
  const inflight = seriesProvisionInflight.get(memoKey);
  if (inflight) return inflight;
  const task = (async (): Promise<'local' | 'fetch'> => {
    const local = await (opts.localBars ?? (() => defaultLocalBars(opts.key)))();
    if (local.length) {
      const tail = local.slice(-need);
      await provideDataSeries(opts.endpoint, opts.apiKey, opts.key, tail, 'axis-local', opts.signal);
      noteSeriesProvisioned(memoKey, need, 'local');
      // A local window that does not reach "now" (stale Data Manager cache for a
      // symbol last visited days ago) must never become the engine's frozen
      // series: engine ticks only append *newer* candles, so the stale tail
      // sticks, and AXIS paints the chart from that series in engine-owned live
      // mode. Top the tail up from the engine's own exchange feed — best-effort,
      // a host without ccxt still keeps the (deep) local history.
      if (seriesIsStale(newestBarTime(tail), opts.key.interval)) {
        try {
          await fetchDataSeries(opts.endpoint, opts.apiKey, opts.key, need, opts.signal);
        } catch {
          /* upstream fetch unavailable — repairStaleEngineSeries retries live */
        }
      }
      return 'local';
    }
    await fetchDataSeries(opts.endpoint, opts.apiKey, opts.key, need, opts.signal);
    noteSeriesProvisioned(memoKey, need, 'fetch');
    return 'fetch';
  })();
  seriesProvisionInflight.set(memoKey, task);
  const release = (): void => {
    if (seriesProvisionInflight.get(memoKey) === task) seriesProvisionInflight.delete(memoKey);
  };
  // Handled (not floating): the derived promise always resolves; dwelling
  // requesters observe the original task's outcome.
  task.then(release, release);
  return task;
}

/** @internal test helper */
export function _resetDataSessionMemo(): void {
  dataSessionMemo.clear();
  noDeltaEndpoints.clear();
  // Provisioning shares fate with sessions in tests: a stale series entry
  // would let a later case skip the upload path it means to exercise.
  seriesProvisionMemo.clear();
  seriesProvisionInflight.clear();
  seriesRepairAt.clear();
}

/** @internal test helper — drop only the series provisioning memo. */
export function _resetSeriesProvisionMemoForTests(): void {
  seriesProvisionMemo.clear();
  seriesProvisionInflight.clear();
}

/** @internal test helper — clear the per-series staleness-repair cooldown. */
export function _resetSeriesRepairCooldownForTests(): void {
  seriesRepairAt.clear();
}

/** @internal test helper — recorded coverage for (endpoint, series). */
export function _getSeriesProvisionForTests(
  endpoint: string,
  key: DataSeriesKey,
): SeriesProvision | null {
  return seriesProvisionMemo.get(seriesProvisionMemoKey(endpoint, key)) ?? null;
}

/** Outcome of a {@link repairStaleEngineSeries} attempt. */
export interface SeriesRepairResult {
  /** True when fresh data reached the engine (upload or engine-side fetch). */
  repaired: boolean;
  /** Where the fresh bars came from. */
  via: 'local' | 'fetch' | 'none';
  /** Bars uploaded (0 for an engine-side fetch). */
  bars: number;
  /** Set when a repair was attempted and failed (best-effort path). */
  error?: string;
}

/**
 * Push the freshest data AXIS holds onto a **stale** engine series.
 *
 * Why: {@link ensureDataSession} only treats a **count** shortfall
 * (`DATA_MISS`, `have < need`) as a miss, so a series that is deep enough but
 * frozen — the engine's upstream stopped advancing, or a stale local window was
 * uploaded before the Data Manager repaired it — stays stale forever. In
 * engine-owned live mode AXIS paints the chart from that series, so the chart
 * freezes at the stale tail without any error. This is the recovery path: it is
 * called by the live paint handlers when they observe the engine's newest bar
 * lurching behind the chart tail / the market.
 *
 * Local-first: when the local Data Manager window reaches "now", its newest
 * `historyBars` are uploaded (upsert by time, so the engine keeps its deeper
 * history). Otherwise the engine is asked to fetch from its exchange feed (which
 * needs ccxt host-side — a failure is reported, never thrown).
 *
 * Cooldown-guarded ({@link SERIES_REPAIR_COOLDOWN_MS}) and best-effort: never
 * throws, always resolves with the outcome.
 */
export async function repairStaleEngineSeries(opts: {
  endpoint: string;
  apiKey: string;
  key: DataSeriesKey;
  /** Window to push/ask for. Defaults to 5 000 bars. */
  historyBars?: number;
  /** Local Data Manager lookup (defaults to the dataset store for the key). */
  localBars?: () => Promise<readonly Bar[]>;
  /** "Now" in unix seconds — test seam. */
  nowSec?: number;
  /** Skip the cooldown (explicit user action / tests). */
  force?: boolean;
  signal?: AbortSignal;
}): Promise<SeriesRepairResult> {
  const need = Math.max(1, Math.floor(opts.historyBars ?? DEFAULT_REPAIR_BARS));
  const memoKey = seriesProvisionMemoKey(opts.endpoint, opts.key);
  const now = Math.floor(opts.nowSec ?? Date.now() / 1000);
  if (!opts.force) {
    const last = seriesRepairAt.get(memoKey) ?? 0;
    if (Date.now() - last < SERIES_REPAIR_COOLDOWN_MS) {
      return { repaired: false, via: 'none', bars: 0 };
    }
  }
  seriesRepairAt.set(memoKey, Date.now());

  // Someone else may have healed it already (second tab, the engine's own
  // catch-up): one cheap status read avoids a pointless upload. Advisory only —
  // a failed status read still repairs.
  try {
    const status = await getDataSeriesStatus(opts.endpoint, opts.apiKey, opts.key, opts.signal);
    if (status.count > 0 && !seriesIsStale(status.newest, opts.key.interval, now)) {
      return { repaired: false, via: 'none', bars: 0 };
    }
  } catch {
    /* status is advisory */
  }

  let local: readonly Bar[] = [];
  try {
    local = await (opts.localBars ?? (() => defaultLocalBars(opts.key)))();
  } catch {
    local = [];
  }
  const tail = local.slice(-need);
  if (tail.length && !seriesIsStale(newestBarTime(tail), opts.key.interval, now)) {
    try {
      await provideDataSeries(opts.endpoint, opts.apiKey, opts.key, tail, 'axis-local', opts.signal);
      noteSeriesProvisioned(memoKey, need, 'local');
      return { repaired: true, via: 'local', bars: tail.length };
    } catch (err: unknown) {
      return {
        repaired: false,
        via: 'local',
        bars: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    await fetchDataSeries(opts.endpoint, opts.apiKey, opts.key, need, opts.signal);
    noteSeriesProvisioned(memoKey, need, 'fetch');
    return { repaired: true, via: 'fetch', bars: 0 };
  } catch (err: unknown) {
    return {
      repaired: false,
      via: 'fetch',
      bars: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Cooldown for a slot whose provisioning keeps failing (no local dataset and a
 * host that cannot fetch its own candles). `ensureDataSession` costs up to
 * three round-trips per attempt; a live tick would otherwise pay the whole
 * chain on every tick while the run is already failing — the observed
 * hundreds-of-requests loop. Only live ticks back off; an interactive run
 * always retries so a fixed dataset / host is picked up immediately.
 */
export const DATA_SESSION_RETRY_COOLDOWN_MS = 60_000;
/**
 * (endpoint + owner + series) → the cooldown of the last failed provision.
 *
 * Capped for the same reason as {@link seriesRepairAt}.
 */
const provisionCooldown = new BoundedMap<string, { until: number; error: string }>(SERIES_MEMO_MAX);

/** @internal test helper */
export function _resetDataSessionCooldownForTests(): void {
  provisionCooldown.clear();
}

function cooledProvisioning(memoKey: string): { error: string } | null {
  const memo = provisionCooldown.get(memoKey);
  if (!memo) return null;
  if (memo.until <= Date.now()) {
    provisionCooldown.delete(memoKey);
    return null;
  }
  return { error: memo.error };
}

/** Best-effort `DELETE /session/{id}`; a failed release only costs idle-TTL lingering. */
export async function releaseDataSession(
  endpoint: string,
  apiKey: string,
  sessionId: string,
): Promise<void> {
  try {
    await call(endpoint, `/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, apiKey);
  } catch {
    /* engine TTL reclaims it */
  }
}

export type DataSessionRunResult =
  | {
      ok: true;
      payload: Record<string, unknown>;
      sessionId: string;
      via: 'data-session-create' | 'data-session-tick';
      provisioned: DataSessionHandle['provisioned'];
    }
  | { ok: false; error: string };

export interface RunDataSessionOptions {
  endpoint: string;
  apiKey: string;
  /** Script instance identity; sibling indicators keep separate sessions. */
  owner?: string;
  request: EngineDataSessionRequest;
  script: string;
  inputs?: Record<string, unknown>;
  libraries?: unknown[];
  profiler?: boolean;
  /** Genuine live tick: re-tick the existing session (identity only) when possible. */
  tick?: boolean;
  signal?: AbortSignal;
  /** Test seam for the local Data Manager lookup. */
  localBars?: () => Promise<readonly Bar[]>;
}

/**
 * Evaluate a script over an engine-owned series.
 *
 * - A live tick re-ticks the owner's existing session (identity only).
 * - A changed script/inputs/window or a non-tick run releases the old session
 *   and creates a fresh one through {@link ensureDataSession}.
 * - A session the engine has expired (`gone`) is recreated transparently.
 */
export async function runDataSession(o: RunDataSessionOptions): Promise<DataSessionRunResult> {
  const key = canonicalSeriesKey(o.request);
  const memoKey = `${o.endpoint.replace(/\/$/, '')}|${o.owner || '-'}|${seriesKeyString(key)}`;
  const fingerprint = JSON.stringify([
    o.request.historyBars,
    o.script,
    o.inputs ?? null,
    o.libraries ?? [],
    o.profiler === true,
  ]);
  const prev = dataSessionMemo.get(memoKey);

  if (prev && o.tick && prev.fingerprint === fingerprint) {
    const t = await tickDataSession(
      o.endpoint,
      o.apiKey,
      prev.sessionId,
      { exchange: key.exchange, symbol: key.symbol },
      o.signal,
      { delta: true },
    );
    if (t.ok) {
      // Delta tails merge onto the cached full payload; an unmergeable update
      // (rebased session, key drift) falls through and recreates below.
      const resolved = resolveSessionPayload(prev.payload, t.payload);
      if (resolved) {
        dataSessionMemo.set(memoKey, {
          sessionId: prev.sessionId,
          fingerprint,
          payload: resolved,
        });
        return {
          ok: true,
          payload: resolved,
          sessionId: prev.sessionId,
          via: 'data-session-tick',
          provisioned: 'none',
        };
      }
    } else if (!t.gone) {
      return { ok: false, error: t.error };
    }
  }

  if (!prev && o.tick) {
    const cooled = cooledProvisioning(memoKey);
    if (cooled) return { ok: false, error: cooled.error };
  }

  if (prev) {
    dataSessionMemo.delete(memoKey);
    void releaseDataSession(o.endpoint, o.apiKey, prev.sessionId);
  }

  try {
    const handle = await ensureDataSession({
      endpoint: o.endpoint,
      apiKey: o.apiKey,
      key: o.request,
      historyBars: o.request.historyBars,
      script: o.script,
      inputs: o.inputs,
      libraries: o.libraries,
      profiler: o.profiler,
      symbol: o.request.symbol,
      signal: o.signal,
      localBars: o.localBars,
    });
    provisionCooldown.delete(memoKey);
    dataSessionMemo.set(memoKey, { sessionId: handle.sessionId, fingerprint, payload: handle.payload });
    return {
      ok: true,
      payload: handle.payload,
      sessionId: handle.sessionId,
      via: 'data-session-create',
      provisioned: handle.provisioned,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    if (o.tick) {
      provisionCooldown.set(memoKey, {
        until: Date.now() + DATA_SESSION_RETRY_COOLDOWN_MS,
        error: `${error} — retrying in ${Math.round(DATA_SESSION_RETRY_COOLDOWN_MS / 1000)}s`,
      });
    }
    return { ok: false, error };
  }
}
