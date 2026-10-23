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
 * CALCULATOR PROFILE ONLY (F-20): kept for engines without `live_stream`.
 * Stream-profile engines tick server-side and push deltas — they never call
 * this client. Do not extend this module; new behavior belongs in
 * `src/engine/`.
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
 * Live sessions always evaluate in `interpret` (compile has no resumable
 * evaluator state), so the fast path may only follow a full run the backend
 * itself resolved to `interpret`: {@link noteRunMode} remembers the mode
 * reported for each (endpoint + script + mode sent + profiler) run key, and
 * {@link runModeAllowsSessions} gates the fast path on it. An `auto` script the
 * backend compiled must not silently switch to interpreted values on a tick.
 *
 * Continuity is tracked per session key (endpoint + script + inputs +
 * libraries + symbol + interval) against Pine-ms bar times:
 * - same count + same last time → `tick` (skipped entirely when the last
 *   bar's OHLCV is unchanged — the cached envelope is reused);
 * - session last time found in the new bars → `tick` the finalized base,
 *   then `append` the strictly newer tail;
 * - anything else (history reload, rewind, gap) → release + recreate.
 *
 * A resumable session also cannot follow an in-place rewrite of closed history
 * (gap fill, venue revision, prepended bars) even when the count and tip are
 * unchanged, so a fingerprint of the closed bars (`bars[0..count-2]`, the
 * forming tip excluded) is compared before any tick/append is trusted; a
 * mismatch rebases over the current window.
 *
 * Sessions that outgrow the chart window by {@link SESSION_GROWTH_SLACK}
 * are rebased (release + recreate) so a long live stream cannot grow
 * server memory and tick envelopes without bound.
 *
 * A response that arrives but cannot be used (error envelope with a 2xx status,
 * mismatched `session_id`, unexpected bar count) is a miss too — never a
 * silently empty result. Unusable responses are remembered per session key for
 * {@link SESSION_RETRY_COOLDOWN_MS} so a backend that answers but cannot serve
 * sessions costs a full re-evaluation occasionally instead of on every tick.
 *
 * Any failure (unknown route on old backends, `NO_SESSION`, `SESSIONS_FULL`,
 * transport error) resolves to `null` — the caller falls back to a full
 * `engine.run`. Endpoints without session routes are remembered so the
 * fallback costs one probe per endpoint, not one per tick.
 *
 * The closed-history fingerprint is re-read on every tick, so continuity costs
 * O(window) client-side by construction ({@link hashBars}); the O(delta) claim
 * covers the server-side evaluation and the envelope, not this guard.
 *
 * @module engines/live-sessions
 */

import { parseEngineJson } from './json-sanitize';
import { resolveSessionPayload } from './session-delta';
import type { EngineLibrarySource } from '../plugins/types';
import type { Bar } from '../store/types';
import { combineAbortSignals } from '../utils/fetch-timeout';
import { BoundedMap } from '../utils/bounded-map';

/**
 * Bars past the chart window a session may grow before it is rebased.
 *
 * Growth inside the slack still reaches the chart through session hits whose
 * series is longer than the window — the indicator runner joins those series
 * to the chart by bar time (`alignSeriesToTimes` over `LiveSessionHit.barTimes`),
 * so the slack only bounds server memory / envelope size, never alignment.
 */
export const SESSION_GROWTH_SLACK = 2000;
/** How far back to search for the session's last time in fresh bars. */
const SESSION_LOOKUP_DEPTH = 512;
/** Create budget (initial eval runs the full window once). */
const SESSION_CREATE_BUDGET_MS = 90_000;
/** Tick/append budget (server-side work is sub-millisecond). */
const SESSION_OP_BUDGET_MS = 30_000;

/** Status probes are small; a slow answer is not worth waiting for. */
const SESSION_STATUS_BUDGET_MS = 5_000;

/** Minimum gap between `GET /session/{id}` reconciliations for one session. */
export const SESSION_STATUS_MIN_INTERVAL_MS = 5_000;

/** Only reconcile a session that has been idle at least this long. */
export const SESSION_STATUS_IDLE_RECONCILE_MS = 20_000;
/** Cooldown after `SESSIONS_FULL` before trying to create again. */
const SESSIONS_FULL_COOLDOWN_MS = 60_000;
/**
 * Cooldown for a session key whose last attempt was answered but unusable
 * (error envelope, wrong session id, unexpected count, no session id). Bounds
 * the cost of a backend that cannot serve sessions to a full re-evaluation
 * every {@link SESSION_RETRY_COOLDOWN_MS} instead of two per tick.
 */
export const SESSION_RETRY_COOLDOWN_MS = 30_000;
/** Cap on remembered session keys (failure memos) — churn must not grow it. */
const KEY_MEMO_MAX = 200;
/** Cap on remembered (endpoint + script + mode + profiler) run modes. */
const RUN_MODE_MEMO_MAX = 200;

/** Fields that identify a session key (everything but the bars themselves). */
export interface LiveSessionKeyFields {
  endpoint: string;
  script: string;
  /** Engine-facing inputs. Must be scalar-only — see the caller's guard. */
  inputs?: Record<string, unknown>;
  libraries?: EngineLibrarySource[];
  symbol: string;
  interval: string;
}

export interface LiveSessionTickOpts extends LiveSessionKeyFields {
  apiKey?: string;
  /** Chart-window bars with Pine-ms times (i.e. `barsForPine` output). */
  pineBars: Bar[];
  profiler?: boolean;
  /**
   * Identifies the chart script *instance* (applied indicator id / editor run
   * key). Sessions are released when a new revision takes over the same
   * instance — not when a sibling indicator on the same symbol/interval runs.
   */
  ownerId?: string;
  signal?: AbortSignal;
}

export type LiveSessionVia =
  'session-create' | 'session-tick' | 'session-append' | 'session-cached';

export interface LiveSessionHit {
  /** Raw engine payload (shaped like `/run` — caller maps to `RunResult`). */
  payload: unknown;
  via: LiveSessionVia;
  sessionId: string;
  /**
   * Bar times (Pine ms, i.e. `barsForPine` output) the returned envelope was
   * evaluated over. The continuity guards only return hits whose session bars
   * match the current chart window, so this is the window's own axis — the
   * indicator runner joins session series to the chart by these times instead
   * of index tail-align (which shifts when the session outgrew the window
   * inside {@link SESSION_GROWTH_SLACK}).
   */
  barTimes?: number[];
}

function evaluatedBarTimes(bars: Bar[]): number[] {
  return bars.map((b) => b.time);
}

interface SessionState {
  id: string;
  /** API key the session was created with (releases must authenticate too). */
  apiKey?: string;
  /** Bar count the session holds. */
  count: number;
  /** Last bar time (Pine ms) the session holds. */
  lastTime: number;
  /** Snapshot of the last bar the session evaluated (skip no-change ticks). */
  lastBar: string;
  /** Last full envelope (reused when nothing changed). */
  lastPayload: unknown;
  /**
   * Fingerprint of the *closed* bars the session holds (`bars[0..count-2]`,
   * i.e. everything except the forming tip). Detects an in-place rewrite of
   * history that a resumable session cannot follow.
   */
  closedHash: number;
  /** Last time this session was created / ticked / appended (ms epoch). */
  lastUsedAt: number;
  /** Last time `GET /session/{id}` was consulted (ms epoch). */
  lastReconciledAt: number;
  /** Last engine-reported status (introspection / telemetry only). */
  lastStatus: LiveSessionStatus | null;
}

const sessions = new Map<string, SessionState>();
/**
 * Chart slot + script instance → session key. Keyed by `ownerId` (the applied
 * indicator id or editor run key) so sibling indicators sharing one
 * symbol/interval do NOT evict each other; a new revision of the same
 * instance still releases the previous session.
 */
const owners = new Map<string, { key: string; id: string }>();
/** Endpoints probed without session routes (old backends, edge, proxies). */
const unsupported = new Set<string>();
/**
 * Endpoints that rejected the `delta` flag (`UNKNOWN_FIELDS` — old backends,
 * edge proxies). Ticks there go plain; the full envelope is adopted as usual.
 */
const noDeltaEndpoints = new Set<string>();
/** endpoint → timestamp of last `SESSIONS_FULL` (create cooldown). */
const fullCooldown = new Map<string, number>();
/** session key → timestamp until which the fast path is skipped after a miss. */
const keyCooldown = new BoundedMap<string, number>(KEY_MEMO_MAX);
/** (endpoint + script + mode + profiler) run key → last backend-reported mode. */
const runModes = new BoundedMap<string, string>(RUN_MODE_MEMO_MAX);

/** Fields that identify the *full run* whose mode decides session eligibility. */
export interface LiveSessionModeFields {
  endpoint: string;
  script: string;
  /** Mode sent to the backend for that run (`interpret` | `compile` | `auto`). */
  mode?: string;
  profiler?: boolean;
}

function runModeKey(f: LiveSessionModeFields): string {
  return JSON.stringify([f.endpoint, f.script, f.mode ?? '', f.profiler === true]);
}

/**
 * Remember the evaluation mode the backend reported for a full run.
 *
 * Sessions always evaluate in `interpret`, while `auto` may resolve to
 * `compile` server-side. Recording the backend's own answer (instead of
 * trusting the configured mode) lets `auto` deployments use sessions whenever
 * the series on the chart really came from interpret — and never switches a
 * compiled series to interpreted values. Keyed by the mode *sent* as well, so a
 * mode switch cannot inherit the previous mode's answer.
 */
export function noteRunMode(fields: LiveSessionModeFields, mode: unknown): void {
  if (!fields?.endpoint || typeof mode !== 'string' || !mode) return;
  const key = runModeKey(fields);
  // Refresh recency (delete + re-insert is built into BoundedMap.set), then
  // trim the coldest entries — the cap bounds distinct keys, not uses.
  runModes.set(key, mode);
}

/** True when the last full run for this script resolved to `interpret`. */
export function runModeAllowsSessions(fields: LiveSessionModeFields): boolean {
  if (!fields?.endpoint || !fields.script) return false;
  return runModes.get(runModeKey(fields)) === 'interpret';
}

function markSessionFailure(key: string): void {
  keyCooldown.set(key, Date.now() + SESSION_RETRY_COOLDOWN_MS);
}

function clearSessionFailure(key: string): void {
  keyCooldown.delete(key);
}

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

function sessionKey(opts: LiveSessionKeyFields): string {
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
  // Scope to the script instance so multiple indicators on one chart do not
  // release each other's sessions. Anonymous callers (no ownerId) scope to the
  // script source instead: distinct scripts stay independent, and a changed
  // script is a new scope whose predecessor expires on the idle TTL.
  const scope = opts.ownerId || opts.script;
  return `${opts.endpoint}|${opts.symbol}|${opts.interval}|${scope}`;
}

function barSnapshot(b: Bar): string {
  return `${b.time}|${b.open}|${b.high}|${b.low}|${b.close}|${(b as { volume?: unknown }).volume ?? ''}`;
}

/** Reused 8-byte view to fold float64 fields into the window hash. */
const HASH_VIEW = new DataView(new ArrayBuffer(8));

function hashNum(h: number, v: unknown): number {
  const x = Number(v);
  HASH_VIEW.setFloat64(0, Number.isFinite(x) ? x : Number.NaN, true);
  h = Math.imul(h ^ HASH_VIEW.getUint32(0, true), 0x01000193);
  h = Math.imul(h ^ HASH_VIEW.getUint32(4, true), 0x01000193);
  return h >>> 0;
}

/**
 * FNV-1a fingerprint of `bars[0..endInclusive]` (inclusive; `-1` hashes
 * nothing). Numeric fields are folded directly — no per-bar string allocation.
 * Callers exclude the forming tip, which legitimately changes every tick.
 */
function hashBars(bars: Bar[], endInclusive: number): number {
  let h = 0x811c9dc5;
  const lim = Math.min(endInclusive, bars.length - 1);
  for (let i = 0; i <= lim; i++) {
    const b = bars[i]!;
    h = hashNum(h, b.time);
    h = hashNum(h, b.open);
    h = hashNum(h, b.high);
    h = hashNum(h, b.low);
    h = hashNum(h, b.close);
    h = hashNum(h, (b as { volume?: unknown }).volume);
  }
  return h >>> 0;
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

async function postJson(
  url: string,
  body: unknown,
  opts: { apiKey?: string; signal?: AbortSignal; budgetMs: number },
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const signal = combineAbortSignals(opts.budgetMs, opts.signal);
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

/**
 * POST a session tick/append, requesting a delta envelope first and retrying
 * plain when the backend does not know the flag. Delta tails are ~cells, not
 * 10k-bar series — the transfer that made live mode laggy.
 */
async function postSessionOp(
  url: string,
  body: Record<string, unknown>,
  opts: { apiKey?: string; signal?: AbortSignal; budgetMs: number },
  endpoint: string,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  if (!noDeltaEndpoints.has(endpoint)) {
    const res = await postJson(url, { ...body, delta: true }, opts);
    const code = (res.payload as { code?: unknown } | null)?.code;
    if (res.ok || code !== 'UNKNOWN_FIELDS') return res;
    noDeltaEndpoints.add(endpoint);
  }
  return postJson(url, body, opts);
}

/**
 * Resolve a tick/append payload against the session's cached full result.
 * Null when unmergeable — the caller must drop the session (next tick
 * recreates it; the current one falls back to a full run), never apply
 * partial data.
 */
function resolveHitPayload(
  st: SessionState,
  key: string,
  endpoint: string,
  raw: unknown,
): Record<string, unknown> | null {
  const merged = resolveSessionPayload(st.lastPayload, raw);
  if (!merged) {
    dropSession(key, endpoint);
    markSessionFailure(key);
  }
  return merged;
}

function releaseSession(endpoint: string, id: string, apiKey?: string): void {
  // Best-effort — TTL reaps whatever this misses. Authenticated backends
  // reject an anonymous DELETE, so the same headers as create/tick are sent.
  try {
    void fetch(`${endpoint}/session/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: headersFor(apiKey),
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
    releaseSession(endpoint, st.id, st.apiKey);
  }
}

/** Engine-side view of a live session (`GET /session/{id}`). */
export interface LiveSessionStatus {
  sessionId: string;
  /** Bars the engine holds, when reported. */
  bars: number | null;
  /** Seconds since the engine last touched the session. */
  idleSeconds: number | null;
  /** Idle TTL before the engine reclaims the session. */
  ttlSeconds: number | null;
}

export type LiveSessionStatusResult =
  { kind: 'ok'; status: LiveSessionStatus } | { kind: 'gone' } | { kind: 'unknown' };

/**
 * `GET /session/{id}` — status blob the backend exposes for introspection.
 *
 * Never throws. `gone` means the engine has reclaimed the session (idle TTL,
 * restart, another process); `unknown` means the probe could not be answered
 * (older backend, transport failure) and callers must keep their local state.
 */
export async function getSessionStatus(
  endpoint: string,
  apiKey: string | undefined,
  sessionId: string,
  signal?: AbortSignal,
): Promise<LiveSessionStatusResult> {
  if (!endpoint || !sessionId) return { kind: 'unknown' };
  try {
    const res = await fetch(`${endpoint}/session/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
      headers: headersFor(apiKey),
      signal: combineAbortSignals(SESSION_STATUS_BUDGET_MS, signal),
    });
    if (res.status === 404) return { kind: 'gone' };
    if (!res.ok) return { kind: 'unknown' };
    const text = await res.text();
    let record: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text.trim() ? parseEngineJson(text) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>;
      }
    } catch {
      return { kind: 'unknown' };
    }
    if (!record) return { kind: 'unknown' };
    if (record.status === 'error') {
      return record.code === 'NO_SESSION' ? { kind: 'gone' } : { kind: 'unknown' };
    }
    const asNum = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      kind: 'ok',
      status: {
        sessionId: typeof record.session_id === 'string' ? record.session_id : sessionId,
        bars: asNum(record.bars),
        idleSeconds: asNum(record.idle_seconds),
        ttlSeconds: asNum(record.ttl_seconds),
      },
    };
  } catch {
    return { kind: 'unknown' };
  }
}

/**
 * Reconcile the cached session against the engine before trusting it.
 *
 * Throttled twice over: only after the session has been idle for
 * {@link SESSION_STATUS_IDLE_RECONCILE_MS} and only once per
 * {@link SESSION_STATUS_MIN_INTERVAL_MS}. A session the engine no longer holds
 * — or one whose bar count drifted — is dropped locally so the caller
 * recreates it. Any other answer leaves local state alone: this is an
 * optimization, never a correctness gate (a tick still detects `gone`).
 */
async function maybeReconcileSession(
  opts: LiveSessionTickOpts,
  key: string,
  st: SessionState,
): Promise<'recreate' | 'ok' | 'unknown'> {
  const now = Date.now();
  if (now - st.lastReconciledAt < SESSION_STATUS_MIN_INTERVAL_MS) return 'unknown';
  if (now - st.lastUsedAt < SESSION_STATUS_IDLE_RECONCILE_MS) return 'unknown';
  st.lastReconciledAt = now;
  const res = await getSessionStatus(opts.endpoint, opts.apiKey, st.id, opts.signal);
  if (res.kind === 'gone') {
    // Known dead: drop the local entry without paying a DELETE for a 404.
    sessions.delete(key);
    return 'recreate';
  }
  if (res.kind !== 'ok') return 'unknown';
  if (res.status.bars != null && res.status.bars !== st.count) {
    // The engine's series drifted from what we recorded — rebase over the
    // chart window instead of ticking a session we cannot describe.
    dropSession(key, opts.endpoint);
    return 'recreate';
  }
  st.lastStatus = res.status;
  return 'ok';
}

/**
 * Engine-side status for telemetry.
 *
 * Reuses a status fetched within {@link SESSION_STATUS_MIN_INTERVAL_MS} — the
 * caller may call this on every paint without adding a request per tick — and
 * otherwise asks the engine once. Returns null when there is no session for the
 * owner (or any session at all) and never throws.
 *
 * @param ownerId applied indicator id / editor run key; omit for the session
 *   that was used most recently.
 */
export async function refreshLiveSessionTelemetry(
  ownerId?: string,
  signal?: AbortSignal,
): Promise<LiveSessionStatus | null> {
  let key: string | undefined;
  if (ownerId) {
    key = owners.get(ownerId)?.key;
  } else {
    let newest = -1;
    for (const [k, st] of sessions) {
      if (st.lastUsedAt > newest) {
        newest = st.lastUsedAt;
        key = k;
      }
    }
  }
  if (!key) return null;
  const st = sessions.get(key);
  if (!st) return null;
  const now = Date.now();
  if (now - st.lastReconciledAt < SESSION_STATUS_MIN_INTERVAL_MS) return st.lastStatus;
  st.lastReconciledAt = now;
  const endpoint = keyEndpoint(key);
  if (!endpoint) return st.lastStatus;
  const res = await getSessionStatus(endpoint, st.apiKey, st.id, signal);
  if (res.kind === 'ok') {
    st.lastStatus = res.status;
    return res.status;
  }
  if (res.kind === 'gone') {
    sessions.delete(key);
    return null;
  }
  return st.lastStatus;
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
  const record =
    res.payload && typeof res.payload === 'object' && !Array.isArray(res.payload)
      ? (res.payload as Record<string, unknown>)
      : null;
  if (!res.ok || !record || record.status === 'error') {
    const code = record?.code;
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      // Old backend / edge / proxy without session routes — remember it.
      unsupported.add(opts.endpoint);
    } else if (res.status === 503 || code === 'SESSIONS_FULL') {
      fullCooldown.set(opts.endpoint, now);
    } else {
      // Answered but unusable (transport-level 5xx/4xx that is not a missing
      // route, or a 2xx error envelope) — do not re-pay a full create on every
      // tick just to fall back to a full run anyway.
      markSessionFailure(key);
    }
    return null;
  }
  const sessionId = typeof record.session_id === 'string' ? record.session_id : null;
  if (!sessionId) {
    // A create we cannot address leaks a server-side session and would run the
    // full window again next tick — treat as a failure and back off.
    markSessionFailure(key);
    return null;
  }
  const count =
    typeof record.count === 'number' && Number.isFinite(record.count)
      ? Math.floor(record.count)
      : opts.pineBars.length;
  clearSessionFailure(key);
  // A different script took over this chart slot — release its session.
  const owner = ownerKey(opts);
  const prev = owners.get(owner);
  if (prev && prev.key !== key) dropSession(prev.key, opts.endpoint);
  owners.set(owner, { key, id: sessionId });
  const last = opts.pineBars[opts.pineBars.length - 1]!;
  const created = Date.now();
  sessions.set(key, {
    id: sessionId,
    apiKey: opts.apiKey,
    count,
    lastTime: last.time,
    lastBar: barSnapshot(last),
    lastPayload: res.payload,
    // Closed history only — the forming tip is excluded on purpose.
    closedHash: hashBars(opts.pineBars, opts.pineBars.length - 2),
    lastUsedAt: created,
    lastReconciledAt: created,
    lastStatus: null,
  });
  return {
    payload: res.payload,
    via: 'session-create',
    sessionId,
    barTimes: evaluatedBarTimes(opts.pineBars),
  };
}

/**
 * Outcome of a `/tick` or `/append` call.
 *
 * `invalid` = the server answered but the body cannot be used as this
 * session's result (transport status, error envelope, wrong session id), which
 * must never be rendered as a successful empty run. `miss` = no answer
 * (transport error/timeout) — transient, so it does not cool the key down.
 */
type SessionOpOutcome =
  { kind: 'ok'; payload: unknown } | { kind: 'gone' } | { kind: 'invalid' } | { kind: 'miss' };

/** True when `payload` can be treated as `sessionId`'s evaluation result. */
function isSessionResult(payload: unknown, sessionId: string): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const rec = payload as Record<string, unknown>;
  // `/run`-shaped envelopes report failures as `{ status: 'error' }`, sometimes
  // with a 2xx status — an error body is not a result.
  if (rec.status === 'error') return false;
  // When the server echoes its session id, it must be the one we asked for.
  if (typeof rec.session_id === 'string' && rec.session_id !== sessionId) return false;
  return true;
}

async function tickSession(
  opts: LiveSessionTickOpts,
  st: SessionState,
  bar: Bar,
): Promise<SessionOpOutcome> {
  let res: { ok: boolean; status: number; payload: unknown };
  try {
    res = await postSessionOp(
      `${opts.endpoint}/session/${encodeURIComponent(st.id)}/tick`,
      { bar: bar as unknown as Record<string, unknown> },
      { apiKey: opts.apiKey, signal: opts.signal, budgetMs: SESSION_OP_BUDGET_MS },
      opts.endpoint,
    );
  } catch {
    return { kind: 'miss' };
  }
  if (!res.ok || !isSessionResult(res.payload, st.id)) {
    if ((res.payload as { code?: unknown } | null)?.code === 'NO_SESSION') {
      return { kind: 'gone' };
    }
    // The server answered (transport errors threw above) but the body cannot be
    // used — never render it as a successful run.
    return { kind: 'invalid' };
  }
  return { kind: 'ok', payload: res.payload };
}

async function appendSession(
  opts: LiveSessionTickOpts,
  st: SessionState,
  bars: Bar[],
): Promise<SessionOpOutcome> {
  let res: { ok: boolean; status: number; payload: unknown };
  try {
    res = await postSessionOp(
      `${opts.endpoint}/session/${encodeURIComponent(st.id)}/append`,
      { bars: bars as unknown as Record<string, unknown> },
      { apiKey: opts.apiKey, signal: opts.signal, budgetMs: SESSION_OP_BUDGET_MS },
      opts.endpoint,
    );
  } catch {
    return { kind: 'miss' };
  }
  if (!res.ok || !isSessionResult(res.payload, st.id)) {
    if ((res.payload as { code?: unknown } | null)?.code === 'NO_SESSION') {
      return { kind: 'gone' };
    }
    // The server answered (transport errors threw above) but the body cannot be
    // used — never render it as a successful run.
    return { kind: 'invalid' };
  }
  return { kind: 'ok', payload: res.payload };
}

/** Drop a session after a failed op and remember unusable answers. */
function sessionOpFailed(key: string, endpoint: string, outcome: SessionOpOutcome): void {
  dropSession(key, endpoint);
  if (outcome.kind === 'invalid') markSessionFailure(key);
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

async function tryLiveSessionTickInner(opts: LiveSessionTickOpts): Promise<LiveSessionHit | null> {
  const bars = Array.isArray(opts.pineBars) ? opts.pineBars : [];
  if (!opts.endpoint || !opts.script || bars.length === 0) return null;
  if (unsupported.has(opts.endpoint)) return null;
  if (opts.signal?.aborted) return null;

  const key = sessionKey(opts);
  const n = bars.length;
  const last = bars[n - 1]!;
  // A recent unusable answer for this key: skip the fast path (one full run
  // beats re-paying a full window create before every tick).
  const cooledUntil = keyCooldown.get(key);
  if (cooledUntil && cooledUntil > Date.now()) return null;
  let st = sessions.get(key);

  if (!st) return createSession(opts, key);

  // Rebase: the session outgrew the chart window — restart over it.
  if (st.count > n + SESSION_GROWTH_SLACK) {
    dropSession(key, opts.endpoint);
    sessions.delete(key);
    st = undefined;
    return createSession(opts, key);
  }

  // Idle session: ask the engine whether it still holds it before paying a
  // tick/append. A reclaimed session would 404 anyway — this just avoids the
  // wasted round-trip and keeps the local bar count honest.
  if ((await maybeReconcileSession(opts, key, st)) === 'recreate') {
    st = undefined;
    return createSession(opts, key);
  }

  // Same tip — re-tick only when its OHLCV actually moved.
  if (n === st.count && last.time === st.lastTime) {
    // Stable count and tip, but a closed bar may have been rewritten in place
    // (gap fill, venue revision): the session would keep stale values.
    if (hashBars(bars, n - 2) !== st.closedHash) {
      dropSession(key, opts.endpoint);
      return createSession(opts, key);
    }
    if (barSnapshot(last) === st.lastBar) {
      return {
        payload: st.lastPayload,
        via: 'session-cached',
        sessionId: st.id,
        barTimes: evaluatedBarTimes(bars),
      };
    }
    const tick = await tickSession(opts, st, last);
    if (tick.kind !== 'ok') {
      sessionOpFailed(key, opts.endpoint, tick);
      return tick.kind === 'gone' ? createSession(opts, key) : null;
    }
    const mergedSame = resolveHitPayload(st, key, opts.endpoint, tick.payload);
    if (!mergedSame) return null;
    const count = payloadCount(mergedSame, n);
    if (count !== n) {
      // Server disagrees about the series shape — do not trust the session.
      dropSession(key, opts.endpoint);
      markSessionFailure(key);
      return null;
    }
    st.lastBar = barSnapshot(last);
    st.lastPayload = mergedSame;
    st.lastUsedAt = Date.now();
    return {
      payload: mergedSame,
      via: 'session-tick',
      sessionId: st.id,
      barTimes: evaluatedBarTimes(bars),
    };
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
  // Bars before the previously-forming base were rewritten, or older bars were
  // prepended: the session's series no longer matches the chart — restart over
  // the current window instead of appending a divergent tail.
  if (hashBars(bars, idx - 1) !== st.closedHash) {
    dropSession(key, opts.endpoint);
    return createSession(opts, key);
  }
  const base = bars[idx]!;
  const tail = bars.slice(idx + 1);
  if (!tail.length) {
    // Count differs but no newer bars (duplicate stamps) — re-tick the tip.
    if (barSnapshot(last) === st.lastBar) {
      return {
        payload: st.lastPayload,
        via: 'session-cached',
        sessionId: st.id,
        barTimes: evaluatedBarTimes(bars),
      };
    }
    const tick = await tickSession(opts, st, last);
    if (tick.kind !== 'ok') {
      sessionOpFailed(key, opts.endpoint, tick);
      return tick.kind === 'gone' ? createSession(opts, key) : null;
    }
    const mergedDup = resolveHitPayload(st, key, opts.endpoint, tick.payload);
    if (!mergedDup) return null;
    const count = payloadCount(mergedDup, n);
    if (count !== n) {
      // Only a session holding exactly `n` bars can carry the fingerprint below.
      dropSession(key, opts.endpoint);
      markSessionFailure(key);
      return null;
    }
    st.lastTime = last.time;
    st.count = count;
    st.lastBar = barSnapshot(last);
    st.lastPayload = mergedDup;
    st.closedHash = hashBars(bars, n - 2);
    st.lastUsedAt = Date.now();
    return {
      payload: mergedDup,
      via: 'session-tick',
      sessionId: st.id,
      barTimes: evaluatedBarTimes(bars),
    };
  }
  // Tick-then-append: finalize the base with its current (closed) values
  // BEFORE appending, or append would confirm the stale forming values and
  // duplicate the bar.
  if (barSnapshot(base) !== st.lastBar) {
    const ticked = await tickSession(opts, st, base);
    if (ticked.kind !== 'ok') {
      sessionOpFailed(key, opts.endpoint, ticked);
      return ticked.kind === 'gone' ? createSession(opts, key) : null;
    }
    const mergedBase = resolveHitPayload(st, key, opts.endpoint, ticked.payload);
    if (!mergedBase) return null;
    st.lastBar = barSnapshot(base);
    st.lastPayload = mergedBase;
  }
  const appended = await appendSession(opts, st, tail);
  if (appended.kind !== 'ok') {
    sessionOpFailed(key, opts.endpoint, appended);
    return appended.kind === 'gone' ? createSession(opts, key) : null;
  }
  const mergedTail = resolveHitPayload(st, key, opts.endpoint, appended.payload);
  if (!mergedTail) return null;
  const count = payloadCount(mergedTail, st.count + tail.length);
  if (count !== st.count + tail.length) {
    dropSession(key, opts.endpoint);
    markSessionFailure(key);
    return null;
  }
  st.count = count;
  st.lastTime = last.time;
  st.lastBar = barSnapshot(last);
  st.lastPayload = mergedTail;
  // The appended tail is now closed history; fingerprint it for the next tick.
  st.closedHash = hashBars(bars, n - 2);
  st.lastUsedAt = Date.now();
  return {
    payload: mergedTail,
    via: 'session-append',
    sessionId: st.id,
    barTimes: evaluatedBarTimes(bars),
  };
}

/** Release every cached session (best-effort DELETE) and clear the cache. */
export function releaseLiveSessions(): void {
  try {
    for (const [key, st] of sessions) {
      const endpoint = keyEndpoint(key);
      if (endpoint) releaseSession(endpoint, st.id, st.apiKey);
    }
  } catch {
    /* ignore */
  }
  sessions.clear();
  owners.clear();
  keyCooldown.clear();
  runModes.clear();
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
  noDeltaEndpoints.clear();
  fullCooldown.clear();
  keyCooldown.clear();
  runModes.clear();
}

/** @internal test helper — inspect cached session state */
export function _liveSessionStateForTests(key: {
  endpoint: string;
  script: string;
  inputs?: Record<string, unknown>;
  libraries?: EngineLibrarySource[];
  symbol: string;
  interval: string;
}): SessionState | null {
  return sessions.get(sessionKey(key)) ?? null;
}
