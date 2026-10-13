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

/** Canonical series key used by the engine store (`exchange|market|symbol|interval`). */
export function canonicalSeriesKey(k: DataSeriesKey): CanonicalSeriesKey {
  return {
    exchange: String(k.exchange || '').trim().toLowerCase(),
    market: String(k.market || 'spot').trim().toLowerCase() || 'spot',
    symbol: String(k.symbol || '').trim().toUpperCase(),
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

function requestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return parent && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([timeout, parent])
    : timeout;
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
    signal: requestSignal(signal),
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
      volume: b.volume ?? 0,
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

/** `GET /data/series/bars` — newest window for chart paint (caller keeps it in memory only). */
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
  return raw.filter(
    (b): b is Bar =>
      !!b && typeof b === 'object' && Number.isFinite((b as Bar).time),
  );
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
  const body = {
    ...canonicalSeriesKey(input.key),
    history_bars: Math.max(1, Math.floor(input.historyBars)),
    script: input.script,
    ...(input.inputs && Object.keys(input.inputs).length ? { inputs: input.inputs } : {}),
    ...(input.libraries?.length ? { libraries: input.libraries } : {}),
    ...(input.profiler ? { profiler: true } : {}),
    ...(input.symbol ? { symbol: input.symbol } : {}),
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
 * `POST /data/session/{id}/tick` — identity only. The engine fetches its own
 * new candles; AXIS never sends bars. `gone` means the session expired and
 * must be recreated.
 */
export async function tickDataSession(
  endpoint: string,
  apiKey: string,
  sessionId: string,
  identity: { exchange: string; symbol: string },
  signal?: AbortSignal,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: string; gone: boolean }> {
  const r = await call(
    endpoint,
    `/data/session/${encodeURIComponent(sessionId)}/tick`,
    {
      method: 'POST',
      body: {
        exchange: String(identity.exchange || '').trim().toLowerCase(),
        symbol: String(identity.symbol || '').trim().toUpperCase(),
      },
    },
    apiKey,
    signal,
  );
  if (!r.ok || r.body.status === 'error') {
    return {
      ok: false,
      error: errorMessage(r, 'data session tick failed'),
      gone: r.status === 404 || r.body.code === 'NO_SESSION',
    };
  }
  return { ok: true, payload: r.body };
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

async function defaultLocalBars(key: DataSeriesKey): Promise<readonly Bar[]> {
  const c = canonicalSeriesKey(key);
  const { getDataset } = await import('../data/dataset-store');
  // Data Manager sources are keyed by the venue id; the symbol keeps its local spelling.
  return getDataset(c.exchange, key.symbol, c.interval);
}

/**
 * Create a data session, brokering cache misses:
 *
 * 1. create → hit returns immediately;
 * 2. miss + local Data Manager bars → upload the newest `historyBars` (provide) → retry;
 * 3. still short → ask the engine to fetch `historyBars` from its exchange → retry;
 * 4. still missing → throw (no endless loop).
 *
 * Only identity and script leave the browser; bars travel only in step 2, and
 * only when the Data Manager already holds them.
 */
export async function ensureDataSession(opts: EnsureDataSessionOptions): Promise<DataSessionHandle> {
  const input: DataSessionCreateInput = {
    key: opts.key,
    historyBars: opts.historyBars,
    script: opts.script,
    inputs: opts.inputs,
    libraries: opts.libraries,
    profiler: opts.profiler,
    symbol: opts.symbol,
  };
  const attempt = () => createDataSession(opts.endpoint, opts.apiKey, input, opts.signal);

  const first = await attempt();
  if (first.ok) {
    return { sessionId: first.sessionId, payload: first.payload, provisioned: 'none' };
  }
  if (!('miss' in first)) throw new Error(first.error);

  let provisioned: DataSessionHandle['provisioned'] = 'none';
  const local = await (opts.localBars ?? (() => defaultLocalBars(opts.key)))();
  if (local.length) {
    const tail = local.slice(-Math.max(1, Math.floor(opts.historyBars)));
    await provideDataSeries(opts.endpoint, opts.apiKey, opts.key, tail, 'axis-local', opts.signal);
    provisioned = 'local';
    const second = await attempt();
    if (second.ok) {
      return { sessionId: second.sessionId, payload: second.payload, provisioned };
    }
    if (!('miss' in second)) throw new Error(second.error);
  }

  await fetchDataSeries(opts.endpoint, opts.apiKey, opts.key, opts.historyBars, opts.signal);
  provisioned = 'fetch';
  const third = await attempt();
  if (third.ok) {
    return { sessionId: third.sessionId, payload: third.payload, provisioned };
  }
  if (!('miss' in third)) throw new Error(third.error);
  throw new Error(
    `data session still short after fetch: ${third.miss.key} have ${third.miss.have} / need ${third.miss.need}`,
  );
}

/** Live-session memo: one engine session per (endpoint, owner, series). */
interface DataSessionMemo {
  sessionId: string;
  fingerprint: string;
}

const dataSessionMemo = new Map<string, DataSessionMemo>();

/** @internal test helper */
export function _resetDataSessionMemo(): void {
  dataSessionMemo.clear();
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
    );
    if (t.ok) {
      return {
        ok: true,
        payload: t.payload,
        sessionId: prev.sessionId,
        via: 'data-session-tick',
        provisioned: 'none',
      };
    }
    if (!t.gone) return { ok: false, error: t.error };
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
    dataSessionMemo.set(memoKey, { sessionId: handle.sessionId, fingerprint });
    return {
      ok: true,
      payload: handle.payload,
      sessionId: handle.sessionId,
      via: 'data-session-create',
      provisioned: handle.provisioned,
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
