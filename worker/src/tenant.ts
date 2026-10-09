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
 * Live SaaS tenant verify + usage metering for `hx_live_…` keys.
 *
 * Mirrors the sibling `pyne-agent-worker` (`src/lib/verify.ts` + `src/lib/usage.ts`)
 * semantics, scoped to AXIS (`axis:stream` | `axis:run`):
 *
 * - L1 in-memory Map (30s, max 512 entries) → KV `TENANT_KEYS` (optional binding;
 *   code works with AND without it — L2 is skipped when `env.TENANT_KEYS` is
 *   undefined) → live `GET {CONSOLE_URL}/api/v1/verify?scope=<scope>`.
 * - Hash on wire only: `Authorization: Bearer <sha256hex(rawKey)>`. The raw key
 *   is never transmitted, cached, or logged (hash prefixes only).
 * - Positive cache 60s, negative cache 10s. Scope-verdict (key valid, required
 *   scope missing) cached in L1 only — never KV-negatived, the key stays valid
 *   for other scopes.
 * - Usage: `queueUsage` per verified stream-create / run, `flushUsage` batches
 *   of up to 50 to `POST {CONSOLE_URL}/api/v1/usage`. Lossy by design — transport
 *   failures, non-2xx, and `207` per-event errors are swallowed (warn only) and
 *   never fail the request. 2s abort budget. Idempotency key
 *   `<YYYY-MM-DD>:<hash16>:<counter>` with a per-isolate monotonic counter.
 *
 * Divergence from the sibling: console-unreachable does NOT self-degrade here.
 * {@link verifyTenant} reports `VERIFY_UNAVAILABLE` (503) and the caller
 * ({@link gateTenantKey}) falls back to the legacy {@link requireApiKey} result:
 * legacy match → degraded allow (`X-Hoox-Verify: degraded`), otherwise
 * fail-closed 503. Self-host (`pn_`) keys never reach this module — see
 * {@link gateTenantKey}, which returns `null` for non-tenant tokens so legacy
 * paths stay byte-identical in behavior.
 */

import type { Env } from './index';
import { classifyBearerToken, extractBearer, requireApiKey } from './auth';

/** Positive verify cache TTL (KV + entry `exp`). */
export const VERIFY_POSITIVE_TTL_S = 60;
/** Negative verify cache TTL (unknown key). */
export const VERIFY_NEGATIVE_TTL_S = 10;

const L1_TTL_MS = 30_000;
const L1_MAX_ENTRIES = 512;

/** Upgrade URL surfaced on `402 ENTITLEMENT_REQUIRED`. */
export const BILLING_UPGRADE_URL = 'https://console.hoox.sh/billing';

/** Console usage ingestion path. */
export const USAGE_PATH = '/api/v1/usage';
/** Max usage events per flush POST. */
export const USAGE_BATCH_MAX = 50;
/** Cap the in-isolate usage queue to bound memory. */
export const USAGE_QUEUE_MAX = 500;
/** Inline flush budget so a slow console never blocks a request (fire-and-forget). */
export const USAGE_FLUSH_TIMEOUT_MS = 2_000;

/** Scopes enforced by live tenant verify on this worker. */
export type TenantScope = 'axis:stream' | 'axis:run';

/** Metering units: streams created (`axis:stream`) / runs executed (`axis:run`). */
export interface TenantUsageUnits {
  streams?: number;
  runs?: number;
}

export type VerifyLimits = Record<string, unknown> | null;

export interface VerifySuccess {
  ok: true;
  tid: string;
  plan: string;
  scopes: string[];
  limits: VerifyLimits;
  /** Full SHA-256 hex of the raw key — the hash-on-wire credential (never the raw key). */
  keyHash: string;
  /** 16-char hash shard for usage idempotency keys (never the raw key). */
  keyHash16: string;
  degraded?: boolean;
  cached?: boolean;
}

export type VerifyFailureCode =
  | 'INVALID_KEY'
  | 'ENTITLEMENT_REQUIRED'
  | 'RATE_LIMITED'
  | 'VERIFY_UNAVAILABLE';

export interface VerifyFailure {
  ok: false;
  code: VerifyFailureCode;
  status: number;
  error: string;
  retryAfter?: number;
}

export type VerifyResult = VerifySuccess | VerifyFailure;

export interface VerifyCacheEntry {
  tid: string;
  plan: string;
  scopes: string[];
  limits: VerifyLimits;
  /** Epoch seconds when this entry expires. */
  exp: number;
  /** Negative-cache marker (key unknown at console). */
  invalid?: boolean;
  /** Scope-verdict marker (key valid, required scope missing). L1 only. */
  entitlementRequired?: boolean;
}

export type VerifyFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface VerifyOptions {
  /** Override for tests (defaults to global fetch — no network in unit tests). */
  fetchFn?: VerifyFetchFn;
}

/** SHA-256 hex via Workers `crypto.subtle`. Never applied to log output. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Safe log reference: hash prefix only — never the raw key. */
export function keyRef(hashHex: string): string {
  return `hx:${hashHex.slice(0, 8)}`;
}

/** KV cache key: `hx:{sha256hex[:16]}`. */
export function verifyCacheKey(hashHex: string): string {
  return `hx:${hashHex.slice(0, 16)}`;
}

// L1: process-local Map with TTL + simple LRU eviction.
const l1 = new Map<string, VerifyCacheEntry>();

function l1GetEntry(key: string, nowMs: number): VerifyCacheEntry | null {
  const v = l1.get(key);
  if (!v) return null;
  if (v.exp * 1000 <= nowMs) {
    l1.delete(key);
    return null;
  }
  l1.delete(key);
  l1.set(key, v);
  return v;
}

function l1Set(key: string, value: VerifyCacheEntry): void {
  // Cap L1 residency at L1_TTL_MS regardless of the KV TTL carried by exp.
  const capSec = Math.floor(Date.now() / 1000) + Math.floor(L1_TTL_MS / 1000);
  const capped: VerifyCacheEntry =
    value.exp > capSec ? { ...value, exp: capSec } : value;
  if (l1.has(key)) l1.delete(key);
  l1.set(key, capped);
  while (l1.size > L1_MAX_ENTRIES) {
    const oldest = l1.keys().next();
    if (oldest.done) break;
    l1.delete(oldest.value);
  }
}

/** Test hook: clear the in-memory verify cache. */
export function clearTenantCache(): void {
  l1.clear();
}

function asCacheEntry(raw: unknown, nowSec: number): VerifyCacheEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o['exp'] !== 'number' || (o['exp'] as number) <= nowSec) return null;
  if (o['invalid'] === true) {
    return { tid: '', plan: '', scopes: [], limits: null, exp: o['exp'] as number, invalid: true };
  }
  if (!Array.isArray(o['scopes'])) return null;
  const scopes = (o['scopes'] as unknown[]).filter(
    (s): s is string => typeof s === 'string',
  );
  const tid = typeof o['tid'] === 'string' ? (o['tid'] as string) : 'unknown';
  const plan = typeof o['plan'] === 'string' ? (o['plan'] as string) : 'unknown';
  const limits =
    o['limits'] !== null && typeof o['limits'] === 'object'
      ? (o['limits'] as Record<string, unknown>)
      : null;
  return { tid, plan, scopes, limits, exp: o['exp'] as number };
}

async function kvPut(env: Env, key: string, entry: VerifyCacheEntry, ttlSec: number): Promise<void> {
  try {
    await env.TENANT_KEYS?.put(key, JSON.stringify(entry), {
      expirationTtl: ttlSec,
    });
  } catch {
    // Cache write-through failure must not fail auth.
  }
}

function invalidFailure(): VerifyFailure {
  return { ok: false, code: 'INVALID_KEY', status: 401, error: 'Invalid API key' };
}

function entitlementFailure(scope: string): VerifyFailure {
  return {
    ok: false,
    code: 'ENTITLEMENT_REQUIRED',
    status: 402,
    error: `Entitlement required for scope '${scope}' — upgrade at ${BILLING_UPGRADE_URL}`,
  };
}

function unavailable(ref: string, scope: string, detail: string): VerifyFailure {
  console.warn(JSON.stringify({ type: 'tenant_verify_unavailable', key: ref, scope, detail }));
  return {
    ok: false,
    code: 'VERIFY_UNAVAILABLE',
    status: 503,
    error: `Tenant verify unavailable (${ref}): ${detail}`,
  };
}

/**
 * Verify a console-issued `hx_live_…` key for `requiredScope`.
 * L1 (30s) → KV `TENANT_KEYS` (skipped when unbound) → live
 * `GET {CONSOLE_URL}/api/v1/verify`. Wire format sends the SHA-256 hex of the
 * key, never the raw key. Raw keys are never logged.
 */
export async function verifyTenant(
  env: Env,
  rawKey: string,
  requiredScope: TenantScope,
  opts?: VerifyOptions,
): Promise<VerifyResult> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const scope = (requiredScope || '').trim();
  // Fail closed on an empty scope — silently defaulting would mask caller bugs.
  if (!scope) return entitlementFailure('(missing scope)');
  const hash = await sha256Hex(rawKey);
  const hash16 = hash.slice(0, 16);
  const ref = keyRef(hash);
  const cacheKey = verifyCacheKey(hash);
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  // L1: per-scope entitlement verdict (key valid, scope missing).
  const scopedKey = `${cacheKey}|scope:${scope}`;
  const scoped = l1GetEntry(scopedKey, nowMs);
  if (scoped?.entitlementRequired && scoped.exp > nowSec) {
    return entitlementFailure(scope);
  }

  // L1: positive / negative entry.
  const hit = l1GetEntry(cacheKey, nowMs);
  if (hit && hit.exp > nowSec) {
    if (hit.invalid) return invalidFailure();
    if (!hit.scopes.includes(scope)) return entitlementFailure(scope);
    return {
      ok: true, tid: hit.tid, plan: hit.plan, scopes: hit.scopes, limits: hit.limits,
      keyHash: hash, keyHash16: hash16, cached: true,
    };
  }

  // L2: KV (optional binding — skip entirely when unbound).
  if (env.TENANT_KEYS) {
    try {
      const raw = await env.TENANT_KEYS.get(cacheKey, 'json');
      const entry = asCacheEntry(raw, nowSec);
      if (entry) {
        l1Set(cacheKey, entry);
        if (entry.invalid) return invalidFailure();
        if (!entry.scopes.includes(scope)) return entitlementFailure(scope);
        return {
          ok: true, tid: entry.tid, plan: entry.plan, scopes: entry.scopes, limits: entry.limits,
          keyHash: hash, keyHash16: hash16, cached: true,
        };
      }
    } catch {
      // KV read failure falls through to live verify.
    }
  }

  const base = (env.CONSOLE_URL || '').trim().replace(/\/+$/, '');
  if (!base) {
    console.warn(JSON.stringify({ type: 'tenant_verify_no_console', key: ref, scope }));
    return unavailable(ref, scope, 'CONSOLE_URL is not configured');
  }

  const url = `${base}/api/v1/verify?scope=${encodeURIComponent(scope)}`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'GET',
      headers: {
        // Hash on wire only — console looks up by hash.
        Authorization: `Bearer ${hash}`,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      JSON.stringify({ type: 'tenant_verify_unreachable', key: ref, scope, error: msg }),
    );
    return unavailable(ref, scope, 'console unreachable');
  }

  if (res.status === 401) {
    const entry: VerifyCacheEntry = {
      tid: '', plan: '', scopes: [], limits: null,
      exp: nowSec + VERIFY_NEGATIVE_TTL_S, invalid: true,
    };
    l1Set(cacheKey, entry);
    await kvPut(env, cacheKey, entry, VERIFY_NEGATIVE_TTL_S);
    return invalidFailure();
  }

  if (res.status === 403) {
    // Key valid, required scope missing. Cache the verdict in L1 only
    // (the key itself is valid for other scopes — never KV-negative it).
    l1Set(scopedKey, {
      tid: '', plan: '', scopes: [], limits: null,
      exp: nowSec + VERIFY_POSITIVE_TTL_S, entitlementRequired: true,
    });
    return entitlementFailure(scope);
  }

  if (res.status === 429) {
    const rawRetry = res.headers.get('Retry-After');
    const parsed = rawRetry !== null ? Number(rawRetry) : NaN;
    const failure: VerifyFailure = {
      ok: false, code: 'RATE_LIMITED', status: 429, error: 'Rate limited — retry shortly',
    };
    if (Number.isFinite(parsed) && parsed >= 0) failure.retryAfter = parsed;
    return failure;
  }

  if (res.status !== 200) {
    console.warn(
      JSON.stringify({ type: 'tenant_verify_bad_status', key: ref, scope, status: res.status }),
    );
    return unavailable(ref, scope, `console status ${res.status}`);
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    console.warn(JSON.stringify({ type: 'tenant_verify_bad_json', key: ref, scope }));
    return unavailable(ref, scope, 'console returned invalid JSON');
  }

  // Tolerant parse: full shape {tid, plan, scopes, limits} and slimmer console
  // shapes ({valid: true, scopes} / {user_id, …}).
  const scopesRaw = body['scopes'];
  const scopes = Array.isArray(scopesRaw)
    ? (scopesRaw as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  const tid =
    typeof body['tid'] === 'string'
      ? (body['tid'] as string)
      : typeof body['user_id'] === 'string'
        ? (body['user_id'] as string)
        : 'unknown';
  const plan = typeof body['plan'] === 'string' ? (body['plan'] as string) : 'unknown';
  const limits =
    body['limits'] !== null &&
    body['limits'] !== undefined &&
    typeof body['limits'] === 'object'
      ? (body['limits'] as Record<string, unknown>)
      : null;

  // Client-side scope enforcement (console may ignore `?scope=`).
  if (!scopes.includes(scope)) {
    l1Set(scopedKey, {
      tid, plan, scopes, limits,
      exp: nowSec + VERIFY_POSITIVE_TTL_S, entitlementRequired: true,
    });
    return entitlementFailure(scope);
  }

  const entry: VerifyCacheEntry = {
    tid, plan, scopes, limits, exp: nowSec + VERIFY_POSITIVE_TTL_S,
  };
  l1Set(cacheKey, entry);
  await kvPut(env, cacheKey, entry, VERIFY_POSITIVE_TTL_S);
  return { ok: true, tid, plan, scopes, limits, keyHash: hash, keyHash16: hash16 };
}

/** HTTP mapping for a {@link VerifyFailure} (status + stable code + message). */
export interface TenantHttpError {
  status: number;
  code: string;
  message: string;
  retryAfter?: number;
}

export function verifyFailureHttp(f: VerifyFailure): TenantHttpError {
  if (f.code === 'RATE_LIMITED' && f.retryAfter !== undefined) {
    return { status: 429, code: f.code, message: f.error, retryAfter: f.retryAfter };
  }
  return { status: f.status, code: f.code, message: f.error };
}

export interface TenantAllow {
  decision: 'allow';
  /** DO partition id: key-hash shard (verify-ok) or legacy `userId` (degraded). */
  userId: string;
  /** Console tenant id (`''` when degraded — no metering without it). */
  tid: string;
  degraded: boolean;
  keyHash: string;
  keyHash16: string;
}

export interface TenantDeny {
  decision: 'deny';
  status: number;
  code: string;
  message: string;
  retryAfter?: number;
}

export type TenantGate = TenantAllow | TenantDeny;

/**
 * Classify-gated live verify for `hx_live_…` bearer keys.
 *
 * Returns `null` when the request carries no tenant-passthrough token — the
 * caller then uses its legacy path (self-host `pn_` / open / D1-fail-closed)
 * unchanged. Tenant tokens are verified live; on `VERIFY_UNAVAILABLE` the
 * legacy {@link requireApiKey} result decides: match → degraded allow (caller
 * attaches `X-Hoox-Verify: degraded`), otherwise fail-closed 503.
 */
export async function gateTenantKey(
  env: Env,
  req: Request,
  scope: TenantScope,
  opts?: VerifyOptions,
): Promise<TenantGate | null> {
  const token = extractBearer(req);
  if (classifyBearerToken(token).kind !== 'tenant-passthrough') return null;
  const v = await verifyTenant(env, token, scope, opts);
  if (v.ok) {
    return {
      decision: 'allow', userId: v.keyHash.slice(0, 32), tid: v.tid,
      degraded: v.degraded === true, keyHash: v.keyHash, keyHash16: v.keyHash16,
    };
  }
  if (v.code !== 'VERIFY_UNAVAILABLE') {
    const http = verifyFailureHttp(v);
    if (http.retryAfter !== undefined) {
      return {
        decision: 'deny', status: http.status, code: http.code,
        message: http.message, retryAfter: http.retryAfter,
      };
    }
    return { decision: 'deny', status: http.status, code: http.code, message: http.message };
  }
  const legacy = await requireApiKey(req, env);
  if (legacy.ok) {
    return {
      decision: 'allow', userId: legacy.ctx.userId, tid: '',
      degraded: true, keyHash: '', keyHash16: '',
    };
  }
  const http = verifyFailureHttp(v);
  return { decision: 'deny', status: http.status, code: http.code, message: http.message };
}

// ── Usage metering ────────────────────────────────────────────────

export interface TenantUsageEvent {
  tid: string;
  scope: string;
  units: TenantUsageUnits;
  idem: string;
  service?: string;
  day?: string;
}

export interface QueueTenantUsageInput {
  tid: string;
  scope: TenantScope | string;
  units: TenantUsageUnits;
  /** 16-char hash shard for the idem key (never the raw key). */
  keyHash16?: string;
  /** Override idem (tests); generated when omitted. */
  idem?: string;
  service?: string;
}

export interface FlushUsageOpts {
  /** Override for tests (defaults to global fetch). */
  fetchFn?: VerifyFetchFn;
  /** Abort budget in ms (default {@link USAGE_FLUSH_TIMEOUT_MS}). */
  timeoutMs?: number;
}

const USAGE_SERVICE = 'axis-worker';

const usageQueue: TenantUsageEvent[] = [];
let usageSeq = 0;

function usageDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Queue one usage event. Returns the event, or `null` when the tenant id is
 * missing / `unknown` (dropped, never queued). Never throws and never logs
 * raw keys. `env` is reserved for future KV-backed queues (unused today).
 */
export function queueUsage(_env: Env, input: QueueTenantUsageInput): TenantUsageEvent | null {
  try {
    const tid = String(input.tid ?? '').trim();
    if (!tid || tid === 'unknown') return null;
    const scope = String(input.scope ?? 'axis:run').trim() || 'axis:run';
    const units: TenantUsageUnits = {};
    const streams = Number(input.units?.streams ?? 0);
    if (Number.isFinite(streams) && streams > 0) units.streams = Math.floor(streams);
    const runs = Number(input.units?.runs ?? 0);
    if (Number.isFinite(runs) && runs > 0) units.runs = Math.floor(runs);
    if (units.streams === undefined && units.runs === undefined) units.runs = 1;
    const day = usageDay();
    const hash16 = String(input.keyHash16 ?? '').trim() || 'unknown';
    const idem = String(input.idem ?? '').trim() || `${day}:${hash16}:${++usageSeq}`;
    const event: TenantUsageEvent = { tid, scope, units, idem, day };
    if (input.service !== undefined) event.service = input.service;
    else event.service = USAGE_SERVICE;
    usageQueue.push(event);
    while (usageQueue.length > USAGE_QUEUE_MAX) usageQueue.shift();
    return event;
  } catch {
    return null;
  }
}

/** Drop queued usage events (tests). The idem counter stays monotonic. */
export function clearUsageQueue(): void {
  usageQueue.length = 0;
}

/** Number of queued (unflushed) usage events. */
export function usageQueueDepth(): number {
  return usageQueue.length;
}

/** Read-only snapshot of the queue (tests). */
export function peekUsageQueue(): TenantUsageEvent[] {
  return usageQueue.map((e) => ({ ...e, units: { ...e.units } }));
}

function warn(type: string, extra?: Record<string, unknown>): void {
  try {
    console.warn(JSON.stringify({ type, ...extra }));
  } catch {
    /* logging must never throw */
  }
}

function resolveServiceAuth(env: Env, authToken?: string): string {
  const explicit = String(authToken ?? '').trim();
  if (explicit) return explicit;
  try {
    const fromEnv = String(
      (env as unknown as { USAGE_SERVICE_KEY?: unknown }).USAGE_SERVICE_KEY ?? '',
    ).trim();
    if (fromEnv) return fromEnv;
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * POST up to {@link USAGE_BATCH_MAX} queued events to the console.
 * Returns the number of accepted events. The dequeued batch is dropped either
 * way (lossy) — metering can never wedge the isolate or fail a request.
 * Never throws; never logs raw keys or bearer values.
 */
export async function flushUsage(
  env: Env,
  authToken?: string,
  opts?: FlushUsageOpts,
): Promise<number> {
  try {
    if (usageQueue.length === 0) return 0;
    const base = String(env.CONSOLE_URL ?? '').trim().replace(/\/+$/, '');
    if (!base) {
      // No console: lossy-drop the queue (same as transport failure below) so
      // an unconfigured deploy can never wedge the isolate at USAGE_QUEUE_MAX.
      const dropped = usageQueue.splice(0, usageQueue.length).length;
      warn('usage_flush_no_console', { queued: dropped, dropped });
      return 0;
    }
    const batch = usageQueue.splice(0, USAGE_BATCH_MAX);
    if (batch.length === 0) return 0;
    const token = resolveServiceAuth(env, authToken);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    // Hash-on-wire: service key or per-request tenant hash — never raw.
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const url = `${base}${USAGE_PATH}`;
    const timeoutMs =
      opts?.timeoutMs !== undefined &&
      Number.isFinite(opts.timeoutMs) &&
      (opts.timeoutMs as number) > 0
        ? Math.floor(opts.timeoutMs as number)
        : USAGE_FLUSH_TIMEOUT_MS;
    const fetchFn = opts?.fetchFn ?? fetch;
    const signal =
      typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
    let res: Response;
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: batch }),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warn('usage_flush_error', { error: msg.slice(0, 200), dropped: batch.length });
      return 0;
    }
    if (res.status === 207) return handleMultiStatus(batch, res);
    if (res.status >= 200 && res.status < 300) return batch.length;
    warn('usage_flush_rejected', {
      status: res.status,
      dropped: batch.length,
      first_idem: batch[0]?.idem,
    });
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warn('usage_flush_error', { error: msg.slice(0, 200) });
    return 0;
  }
}

/**
 * Tolerant `207` multi-status handling: count `ok` / duplicate replays as
 * accepted, warn (and drop) everything else — including `quota_exceeded`,
 * which is deliberately NOT requeued to avoid poison-event flush loops.
 */
async function handleMultiStatus(batch: TenantUsageEvent[], res: Response): Promise<number> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    warn('usage_flush_207_unparseable', { dropped: batch.length });
    return 0;
  }
  const results = extractResults(body);
  if (!results) return batch.length;
  let accepted = 0;
  results.forEach((r, i) => {
    const idem = batch[i]?.idem ?? (r as Record<string, unknown>)['idem'];
    if (isAcceptedResult(r)) {
      accepted++;
      return;
    }
    warn('usage_event_rejected', {
      idem: typeof idem === 'string' ? idem : batch[i]?.idem,
      code: (r as Record<string, unknown>)['code'],
      status: (r as Record<string, unknown>)['status'],
    });
  });
  return accepted;
}

function extractResults(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  for (const key of ['results', 'events', 'data']) {
    const v = o[key];
    if (Array.isArray(v)) return v as unknown[];
  }
  return null;
}

function isAcceptedResult(r: unknown): boolean {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  if (o['ok'] === true) return true;
  if (o['ok'] === false) return false;
  const status = Number(o['status']);
  if (Number.isFinite(status) && status >= 200 && status < 300) return true;
  const code = String(o['code'] ?? o['error'] ?? '').toLowerCase();
  if (!code) return false;
  if (/(duplicate|already|idempotent|replay|^ok$)/.test(code)) return true;
  // quota_exceeded / rate_limited / invalid: not accepted — dropped with warn.
  return false;
}

/**
 * Meter one verified tenant action: queue the event and flush fire-and-forget
 * (via `ctx.waitUntil` when available). Degraded gates (no `tid`) are skipped.
 * Never throws.
 */
export function meterTenantUsage(
  env: Env,
  gate: TenantAllow,
  scope: TenantScope,
  units: TenantUsageUnits,
  ctx?: ExecutionContext | null,
): void {
  try {
    if (gate.degraded || !gate.tid) return;
    queueUsage(env, { tid: gate.tid, scope, units, keyHash16: gate.keyHash16 });
    const pending = flushUsage(env, gate.keyHash || undefined);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(pending);
    else void pending;
  } catch {
    /* metering must never fail the request */
  }
}
