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
 * PYNE live evaluation sessions (Pro API 0.6.9+) — O(delta) live re-runs.
 *
 * A session keeps the parsed script, its series, and its TA state alive
 * server-side, so a live tick re-evaluates one bar instead of the whole
 * rolling window (measured 1,087 ms → 0.13 ms on 20k bars). The session
 * envelope is shaped like `/run`, so the existing result normalizer handles
 * both.
 *
 * Protocol (interpret only — compile has no resumable evaluator state):
 * - `POST {endpoint}/session` — create over the current bars (full envelope)
 * - `POST {endpoint}/session/{id}/tick` — re-tick the forming bar, O(1).
 *   Count does not advance; overwrites the last cell in place.
 * - `POST {endpoint}/session/{id}/append` — append closed bars, O(delta).
 *   **Tick-then-append order is required**: `append` confirms the session's
 *   forming bar as stored, so appending the final close values without
 *   ticking first would duplicate the bar (stale confirmed + new appended).
 * - `DELETE {endpoint}/session/{id}` — release (else the 15-min idle TTL).
 *
 * Continuity is tracked per session key (endpoint + script + inputs +
 * libraries + symbol + interval) against Pine-ms bar times:
 * - same count + same last time → `tick` (skipped entirely when the last
 *   bar's OHLCV is unchanged — the cached envelope is reused);
 * - session last time found in the new bars → `tick` the finalized base,
 *   then `append` the strictly newer tail;
 * - anything else (history reload, rewind, gap) → release + recreate.
 *
 * Sessions that outgrow the chart window by {@link SESSION_GROWTH_SLACK}
 * are rebased (release + recreate) so a long live stream cannot grow
 * server memory and tick envelopes without bound.
 *
 * Any failure (unknown route on old backends, `NO_SESSION`, `SESSIONS_FULL`,
 * transport error) resolves to `null` — the caller falls back to a full
 * `engine.run`. Endpoints without session routes are remembered so the
 * fallback costs one probe per endpoint, not one per tick.
 *
 * @module engines/live-sessions
 */

import { parseEngineJson } from './json-sanitize';
import type { EngineLibrarySource } from '../plugins/types';
import type { Bar } from '../store/types';

/** Bars past the chart window a session may grow before it is rebased. */
export const SESSION_GROWTH_SLACK = 2000;
/** How far back to search for the session's last time in fresh bars. */
const SESSION_LOOKUP_DEPTH = 512;
/** Create budget (initial eval runs the full window once). */
const SESSION_CREATE_BUDGET_MS = 90_000;
/** Tick/append budget (server-side work is sub-millisecond). */
const SESSION_OP_BUDGET_MS = 30_000;
/** Cooldown after `SESSIONS_FULL` before trying to create again. */
const SESSIONS_FULL_COOLDOWN_MS = 60_000;

export interface LiveSessionTickOpts {
  endpoint: string;
  apiKey?: string;
  script: string;
  /** Chart-window bars with Pine-ms times (i.e. `barsForPine` output). */
  pineBars: Bar[];
  inputs?: Record<string, unknown>;
  libraries?: EngineLibrarySource[];
  profiler?: boolean;
  symbol: string;
  interval: string;
  signal?: AbortSignal;
}

export type LiveSessionVia = 'session-create' | 'session-tick' | 'session-append' | 'session-cached';

export interface LiveSessionHit {
  /** Raw engine payload (shaped like `/run` — caller maps to `RunResult`). */
  payload: unknown;
  via: LiveSessionVia;
  sessionId: string;
}

interface SessionState {
  id: string;
  /** Bar count the session holds. */
  count: number;
  /** Last bar time (Pine ms) the session holds. */
  lastTime: number;
  /** Snapshot of the last bar the session evaluated (skip no-change ticks). */
  lastBar: string;
  /** Last full envelope (reused when nothing changed). */
  lastPayload: unknown;
}

const sessions = new Map<string, SessionState>();
/** endpoint|symbol|interval → session key (releases the previous script's session). */
const owners = new Map<string, { key: string; id: string }>();
/** Endpoints probed without session routes (old backends, edge, proxies). */
const unsupported = new Set<string>();
/** endpoint → timestamp of last `SESSIONS_FULL` (create cooldown). */
const fullCooldown = new Map<string, number>();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function sessionKey(opts: LiveSessionTickOpts): string {
  return JSON.stringify(
    canonicalize({
      endpoint: opts.endpoint,
      script: opts.script,
      inputs: opts.inputs || {},
      libraries: opts.libraries || [],
      symbol: opts.symbol,
      interval: opts.interval,
    }),
  );
}

function ownerKey(opts: LiveSessionTickOpts): string {
  return `${opts.endpoint}|${opts.symbol}|${opts.interval}`;
}

function barSnapshot(b: Bar): string {
  return `${b.time}|${b.open}|${b.high}|${b.low}|${b.close}|${(b as { volume?: unknown }).volume ?? ''}`;
}

function headersFor(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = String(apiKey || '').trim();
  if (key) {
    headers['X-API-Key'] = key;
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function withBudget(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timer = AbortSignal.timeout(ms);
  if (signal && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timer, signal]);
  }
  return signal || timer;
}

async function postJson(
  url: string,
  body: unknown,
  opts: { apiKey?: string; signal?: AbortSignal; budgetMs: number },
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const signal = withBudget(opts.signal, opts.budgetMs);
  const res = await fetch(url, {
    method: 'POST',
    headers: headersFor(opts.apiKey),
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text && String(text).trim() ? parseEngineJson(text) : null;
  } catch {
    payload = null;
  }
  return { ok: res.ok, status: res.status, payload };
}

function releaseSession(endpoint: string, id: string): void {
  // Best-effort — TTL reaps whatever this misses.
  try {
    void fetch(`${endpoint}/session/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

function dropSession(key: string, endpoint: string): void {
  const st = sessions.get(key);
  if (st) {
    sessions.delete(key);
    releaseSession(endpoint, st.id);
  }
}

async function createSession(
  opts: LiveSessionTickOpts,
  key: string,
): Promise<LiveSessionHit | null> {
  const now = Date.now();
  if ((fullCooldown.get(opts.endpoint) || 0) + SESSIONS_FULL_COOLDOWN_MS > now) {
    return null;
  }
  let res: { ok: boolean; status: number; payload: unknown };
  try {
    res = await postJson(
      `${opts.endpoint}/session`,
      {
        script: opts.script,
        data: opts.pineBars,
        symbol: opts.symbol || 'CHART',
        ...(opts.inputs && Object.keys(opts.inputs).length ? { inputs: opts.inputs } : {}),
        ...(opts.profiler ? { profiler: true } : {}),
        ...(opts.libraries?.length ? { libraries: opts.libraries } : {}),
        mode: 'interpret',
      },
      { apiKey: opts.apiKey, signal: opts.signal, budgetMs: SESSION_CREATE_BUDGET_MS },
    );
  } catch {
    return null;
  }
  if (!res.ok || !res.payload || typeof res.payload !== 'object') {
    const code = (res.payload as { code?: unknown } | null)?.code;
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      // Old backend / edge / proxy without session routes — remember it.
      unsupported.add(opts.endpoint);
    } else if (res.status === 503 || code === 'SESSIONS_FULL') {
      fullCooldown.set(opts.endpoint, now);
    }
    return null;
  }
  const record = res.payload as Record<string, unknown>;
  const sessionId = typeof record.session_id === 'string' ? record.session_id : null;
  const count =
    typeof record.count === 'number' && Number.isFinite(record.count)
      ? Math.floor(record.count)
      : opts.pineBars.length;
  if (!sessionId) return null;
  // A different script took over this chart slot — release its session.
  const owner = ownerKey(opts);
  const prev = owners.get(owner);
  if (prev && prev.key !== key) dropSession(prev.key, opts.endpoint);
  owners.set(owner, { key, id: sessionId });
  const last = opts.pineBars[opts.pineBars.length - 1]!;
  sessions.set(key, {
    id: sessionId,
    count,
    lastTime: last.time,
    lastBar: barSnapshot(last),
    lastPayload: res.payload,
  });
  return { payload: res.payload, via: 'session-create', sessionId };
}

async function tickSession(
  opts: LiveSessionTickOpts,
  st: SessionState,
  bar: Bar,
): Promise<unknown | null> {
  let res: { ok: boolean; status: number; payload: unknown };
  try {
    res = await postJson(
      `${opts.endpoint}/session/${encodeURIComponent(st.id)}/tick`,
      { bar },
      { apiKey: opts.apiKey, signal: opts.signal, budgetMs: SESSION_OP_BUDGET_MS },
    );
  } catch {
    return null;
  }
  if (!res.ok || !res.payload || typeof res.payload !== 'object') {
    return (res.payload as { code?: unknown } | null)?.code === 'NO_SESSION' ? 'gone' : null;
  }
  return res.payload;
}

async function appendSession(
  opts: LiveSessionTickOpts,
  st: SessionState,
  bars: Bar[],
): Promise<unknown | null> {
  let res: { ok: boolean; status: number; payload: unknown };
  try {
    res = await postJson(
      `${opts.endpoint}/session/${encodeURIComponent(st.id)}/append`,
      { bars },
      { apiKey: opts.apiKey, signal: opts.signal, budgetMs: SESSION_OP_BUDGET_MS },
    );
  } catch {
    return null;
  }
  if (!res.ok || !res.payload || typeof res.payload !== 'object') {
    return (res.payload as { code?: unknown } | null)?.code === 'NO_SESSION' ? 'gone' : null;
  }
  return res.payload;
}

function payloadCount(payload: unknown, fallback: number): number {
  const count = (payload as { count?: unknown } | null)?.count;
  return typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : fallback;
}

/**
 * Evaluate a live tick through a PYNE live session when possible.
 *
 * Returns the raw engine payload plus the path taken, or `null` when the
 * caller should fall back to a full `engine.run` (sessions unsupported,
 * failed, or discontinuous). Never throws.
 */
export async function tryLiveSessionTick(
  opts: LiveSessionTickOpts,
): Promise<LiveSessionHit | null> {
  try {
    return await tryLiveSessionTickInner(opts);
  } catch {
    return null;
  }
}

async function tryLiveSessionTickInner(
  opts: LiveSessionTickOpts,
): Promise<LiveSessionHit | null> {
  const bars = Array.isArray(opts.pineBars) ? opts.pineBars : [];
  if (!opts.endpoint || !opts.script || bars.length === 0) return null;
  if (unsupported.has(opts.endpoint)) return null;
  if (opts.signal?.aborted) return null;

  const key = sessionKey(opts);
  const n = bars.length;
  const last = bars[n - 1]!;
  let st = sessions.get(key);

  if (!st) return createSession(opts, key);

  // Rebase: the session outgrew the chart window — restart over it.
  if (st.count > n + SESSION_GROWTH_SLACK) {
    dropSession(key, opts.endpoint);
    sessions.delete(key);
    st = undefined;
    return createSession(opts, key);
  }

  // Same tip — re-tick only when its OHLCV actually moved.
  if (n === st.count && last.time === st.lastTime) {
    if (barSnapshot(last) === st.lastBar) {
      return { payload: st.lastPayload, via: 'session-cached', sessionId: st.id };
    }
    const payload = await tickSession(opts, st, last);
    if (payload === 'gone' || payload == null) {
      dropSession(key, opts.endpoint);
      if (payload === 'gone') return createSession(opts, key);
      return null;
    }
    const count = payloadCount(payload, n);
    if (count !== n) {
      // Server disagrees about the series shape — do not trust the session.
      dropSession(key, opts.endpoint);
      return null;
    }
    st.lastBar = barSnapshot(last);
    st.lastPayload = payload;
    return { payload, via: 'session-tick', sessionId: st.id };
  }

  // Series advanced (or shrank) — locate the session tip in the fresh bars.
  const from = Math.max(0, n - SESSION_LOOKUP_DEPTH);
  let idx = -1;
  for (let i = n - 1; i >= from; i--) {
    if (bars[i]!.time === st.lastTime) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    // History reload / rewind / gap the session cannot follow — recreate.
    dropSession(key, opts.endpoint);
    return createSession(opts, key);
  }
  const base = bars[idx]!;
  const tail = bars.slice(idx + 1);
  if (!tail.length) {
    // Count differs but no newer bars (duplicate stamps) — re-tick the tip.
    if (barSnapshot(last) === st.lastBar) {
      return { payload: st.lastPayload, via: 'session-cached', sessionId: st.id };
    }
    const payload = await tickSession(opts, st, last);
    if (payload === 'gone' || payload == null) {
      dropSession(key, opts.endpoint);
      if (payload === 'gone') return createSession(opts, key);
      return null;
    }
    st.lastTime = last.time;
    st.count = payloadCount(payload, n);
    st.lastBar = barSnapshot(last);
    st.lastPayload = payload;
    return { payload, via: 'session-tick', sessionId: st.id };
  }
  // Tick-then-append: finalize the base with its current (closed) values
  // BEFORE appending, or append would confirm the stale forming values and
  // duplicate the bar.
  if (barSnapshot(base) !== st.lastBar) {
    const ticked = await tickSession(opts, st, base);
    if (ticked === 'gone') {
      dropSession(key, opts.endpoint);
      return createSession(opts, key);
    }
    if (ticked == null) {
      dropSession(key, opts.endpoint);
      return null;
    }
    st.lastBar = barSnapshot(base);
    st.lastPayload = ticked;
  }
  const appended = await appendSession(opts, st, tail);
  if (appended === 'gone') {
    dropSession(key, opts.endpoint);
    return createSession(opts, key);
  }
  if (appended == null) {
    dropSession(key, opts.endpoint);
    return null;
  }
  const count = payloadCount(appended, st.count + tail.length);
  if (count !== st.count + tail.length) {
    dropSession(key, opts.endpoint);
    return null;
  }
  st.count = count;
  st.lastTime = last.time;
  st.lastBar = barSnapshot(last);
  st.lastPayload = appended;
  return { payload: appended, via: 'session-append', sessionId: st.id };
}

/** Release every cached session (best-effort DELETE) and clear the cache. */
export function releaseLiveSessions(): void {
  try {
    for (const [key, st] of sessions) {
      const endpoint = keyEndpoint(key);
      if (endpoint) releaseSession(endpoint, st.id);
    }
  } catch {
    /* ignore */
  }
  sessions.clear();
  owners.clear();
}

function keyEndpoint(key: string): string | null {
  try {
    const parsed = JSON.parse(key) as { endpoint?: unknown };
    return typeof parsed.endpoint === 'string' ? parsed.endpoint : null;
  } catch {
    return null;
  }
}

/** @internal test helper */
export function _resetLiveSessionsForTests(): void {
  sessions.clear();
  owners.clear();
  unsupported.clear();
  fullCooldown.clear();
}

/** @internal test helper — inspect cached session state */
export function _liveSessionStateForTests(key: {
  endpoint: string;
  script: string;
  inputs?: Record<string, unknown>;
  libraries?: EngineLibrarySource[];
  symbol: string;
  interval: string;
  pineBars: Bar[];
}): SessionState | null {
  return (
    sessions.get(
      sessionKey({
        ...key,
        apiKey: undefined,
        profiler: undefined,
        signal: undefined,
      }),
    ) ?? null
  );
}
