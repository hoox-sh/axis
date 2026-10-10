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
 * `/api/run` — execute Pine against OHLCV bars; return plots + events.
 *
 * ## Execution preference
 * 1. **In-worker Pyodide** when `PYODIDE_IN_WORKER=enabled` ({@link tryRunInWorker}).
 *    Needs a pynescript wheel (R2 / network); see `worker/RUNTIME.md`.
 * 2. **Proxy** to `EXTERNAL_BACKEND` + `/run` (local pyne Pro API, Flask, etc.).
 * 3. **503 `NO_BACKEND`** if neither path is available / Pyodide fails open.
 *
 * ## Auth & abuse controls
 * - `hx_live_…` SaaS keys verify live against `{CONSOLE_URL}/api/v1/verify`
 *   (`axis:run` scope) before the legacy gate; denials are 401 / 402
 *   (upgrade at https://console.hoox.sh/billing) / 429, console outages fall
 *   back to the legacy key (degraded) or fail closed 503. Verified runs meter
 *   one `runs` unit to `{CONSOLE_URL}/api/v1/usage` (lossy).
 * - Auth is required when `API_KEYS` is bound, `REQUIRE_RUN_AUTH=1`, or a real
 *   compute path is configured (`EXTERNAL_BACKEND` non-empty or
 *   `PYODIDE_IN_WORKER=enabled`) and `ALLOW_OPEN_KEYS` is not `"1"`.
 * - Local demos: `ALLOW_OPEN_KEYS=1` keeps `/api/run` open (no Bearer) even with
 *   a backend; never enable that on a public Worker.
 * - Always rate-limited per IP (and per key when authenticated) — isolate memory.
 * - Script/data size caps + upstream proxy timeout.
 *
 * Optional `Authorization: Bearer` increments `USAGE` KV (`usage:<key>`), 30d TTL.
 * Body is validated once; the same parsed JSON is re-stringified for the proxy
 * because `Request` bodies are single-shot streams.
 */

import type { Env } from './index';
import { extractBearer, requireApiKey } from './auth';
import { gateTenantKey, meterTenantUsage, sha256Hex } from './tenant';
import { tryRunInWorker } from './pyodide_runtime';
import { clientIp, jsonResponse, readCappedJson } from './http';
import { _resetRateLimitsForTests, allowRate } from './rate-limit';

/** Max Pine source length (chars) accepted by `/api/run`. */
const MAX_SCRIPT_CHARS = 512 * 1024;
/** Max OHLCV rows per run (aligned with chart history soft caps). */
const MAX_DATA_BARS = 50_000;
/** Upstream `/run` proxy timeout — prevents hung backends pinning Worker isolates. */
const PROXY_TIMEOUT_MS = 60_000;
/** Max runs per IP (or key) per window. */
const RUN_RATE_LIMIT = 30;
const RUN_RATE_WINDOW_MS = 60_000;
/** Fail closed before JSON.parse — 50k bars of OHLCV can be tens of MiB. */
const RUN_MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * True when /api/run must authenticate.
 * Fail-closed whenever a real backend would burn CPU for unauthenticated callers.
 * Local demos opt out with ALLOW_OPEN_KEYS=1 (and no API_KEYS / REQUIRE_RUN_AUTH).
 */
function runAuthRequired(env: Env): boolean {
  if (env.API_KEYS) return true;
  const flag = String(env.REQUIRE_RUN_AUTH || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') return true;

  // Explicit local-demo open mode: do not force the auth gate (Bearer optional).
  const openKeys =
    env.ALLOW_OPEN_KEYS === '1' ||
    env.ALLOW_OPEN_KEYS === 'true' ||
    String(env.ALLOW_OPEN_KEYS || '').toLowerCase() === 'yes';
  if (openKeys) return false;

  const external = String(env.EXTERNAL_BACKEND || '').trim();
  if (external) return true;

  if (env.PYODIDE_IN_WORKER === 'enabled') return true;

  return false;
}

/** `/api/run` error envelope — permissive CORS so browser callers can read `code`. */
function jsonError(
    status: number,
    code: string,
    message: string,
    origin: string,
    extraHeaders?: Record<string, string>,
): Response {
    return jsonResponse({ status: 'error', code, message }, {
        status,
        headers: { 'Access-Control-Allow-Origin': origin, ...(extraHeaders || {}) },
    });
}

/** @internal test helper — clear rate buckets between tests. */
export function _resetRunRateLimitForTests(): void {
    _resetRateLimitsForTests();
}

/** Client JSON body for `/api/run` (aligned with pyne Pro API). */
interface RunRequest {
    script: string;
    data: Array<{ time: number | string; open: number; high: number; low: number; close: number; volume?: number }>;
    /** `auto` (the PWA default) normalizes to `interpret` before execution. */
    mode?: 'interpret' | 'compile' | 'auto';
}

/** Structural validation only — engines enforce bar shape and script syntax. */
function validate(body: unknown): { ok: true; value: RunRequest } | { ok: false; err: string } {
    if (!body || typeof body !== 'object') return { ok: false, err: 'body must be a JSON object' };
    const b = body as Record<string, unknown>;
    if (typeof b.script !== 'string' || !b.script.trim()) return { ok: false, err: 'script is required' };
    if (b.script.length > MAX_SCRIPT_CHARS) {
        return { ok: false, err: `script exceeds ${MAX_SCRIPT_CHARS} characters` };
    }
    if (!Array.isArray(b.data) || b.data.length === 0) return { ok: false, err: 'data must be a non-empty array' };
    if (b.data.length > MAX_DATA_BARS) {
        return { ok: false, err: `data exceeds ${MAX_DATA_BARS} bars` };
    }
    if (b.mode !== undefined && b.mode !== 'interpret' && b.mode !== 'compile' && b.mode !== 'auto') {
        return { ok: false, err: 'mode must be "interpret", "compile", or "auto"' };
    }
    return { ok: true, value: b as unknown as RunRequest };
}

/** POST JSON body to `${EXTERNAL_BACKEND}/run`, preserving upstream status + body. */
async function proxyToExternal(
    bodyText: string,
    env: Env,
    origin: string,
    extraHeaders?: Record<string, string>,
): Promise<Response> {
    const target = env.EXTERNAL_BACKEND?.replace(/\/$/, '');
    if (!target) {
        return new Response(
            JSON.stringify({
                status: 'error',
                code: 'NO_BACKEND',
                message:
                    'No EXTERNAL_BACKEND configured and PYODIDE_IN_WORKER is disabled. ' +
                    'Set EXTERNAL_BACKEND=<flask-url> OR PYODIDE_IN_WORKER=enabled (and ship the pynescript wheel in R2).',
            }),
            {
                status: 503,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': origin,
                    ...(extraHeaders || {}),
                },
            },
        );
    }
    let upstream: Response;
    try {
        upstream = await fetch(`${target}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bodyText,
            signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const timedOut = /abort|timeout/i.test(msg);
        return new Response(
            JSON.stringify({
                status: 'error',
                code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK',
                message: timedOut
                    ? `EXTERNAL_BACKEND /run timed out after ${PROXY_TIMEOUT_MS}ms`
                    : `EXTERNAL_BACKEND /run unreachable: ${msg}`,
            }),
            {
                status: 504,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': origin,
                    ...(extraHeaders || {}),
                },
            },
        );
    }
    const text = await upstream.text();
    return new Response(text, {
        status: upstream.status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin,
            'Vary': 'Origin',
            ...(extraHeaders || {}),
        },
    });
}

/**
 * POST `/api/run` handler. Auth (when required) → rate limit → validate →
 * optional usage meter → Pyodide → external proxy fallback.
 */
export async function handleRun(
    req: Request,
    env: Env,
    origin: string,
    ctx?: ExecutionContext,
): Promise<Response> {
    // ── SaaS tenant gate (hx_live_…): live console verify (`axis:run`) + meter.
    // Non-tenant callers fall through to the legacy auth gate below, unchanged.
    // A cheap IP pre-limit runs before the gate so console verify is never
    // reachable past the abuse budget (A11).
    const ip = clientIp(req);
    if (!allowRate(`run:pre:${ip}`, RUN_RATE_LIMIT * 2, RUN_RATE_WINDOW_MS)) {
        return jsonError(
            429,
            'RATE_LIMIT',
            `Too many /api/run requests (max ${RUN_RATE_LIMIT * 2}/${RUN_RATE_WINDOW_MS / 1000}s)`,
            origin,
            { 'Retry-After': String(Math.ceil(RUN_RATE_WINDOW_MS / 1000)) },
        );
    }
    let verifyDegraded = false;
    const gate = await gateTenantKey(env, req, 'axis:run');

    // ── Auth gate (KV / REQUIRE_RUN_AUTH / backend without open keys) ──
    let userId: string | null = null;
    let rawKey: string | null = null;
    if (gate) {
        if (gate.decision === 'deny') {
            return jsonError(
                gate.status,
                gate.code,
                gate.message,
                origin,
                gate.retryAfter !== undefined ? { 'Retry-After': String(gate.retryAfter) } : undefined,
            );
        }
        verifyDegraded = gate.degraded;
        userId = gate.userId;
        rawKey = extractBearer(req) || null;
        if (!gate.degraded) meterTenantUsage(env, gate, 'axis:run', { runs: 1 }, ctx);
    } else if (runAuthRequired(env)) {
        const auth = await requireApiKey(req, env);
        if (!auth.ok) {
            return jsonError(auth.status, auth.code, auth.message, origin);
        }
        userId = auth.ctx.userId;
        rawKey = auth.ctx.key;
    } else {
        // Optional bearer for metering / tighter rate bucket when present
        const header = req.headers.get('Authorization') ?? '';
        if (header.startsWith('Bearer ')) {
            rawKey = header.slice(7).trim() || null;
        }
    }

    // Degraded tenant verify (console unreachable, legacy key matched) rides
    // along on every response below; absent otherwise.
    const verifyHeaders = verifyDegraded ? { 'X-Hoox-Verify': 'degraded' } : undefined;

    // ── Rate limit (always) ──
    // Per-key bucket uses the key hash (never a raw-key prefix) so rate keys
    // stay safe to log; hash failure falls back to the IP bucket.
    // (`ip` was resolved before the tenant gate for the A11 pre-limit above.)
    let rateKey = userId ? `run:user:${userId}` : `run:ip:${ip}`;
    if (!userId && rawKey) {
        try {
            rateKey = `run:key:${(await sha256Hex(rawKey)).slice(0, 16)}`;
        } catch {
            /* fall back to the IP bucket — rate limiting must not block */
        }
    }
    if (!allowRate(rateKey, RUN_RATE_LIMIT, RUN_RATE_WINDOW_MS)) {
        return jsonError(
            429,
            'RATE_LIMIT',
            `Too many /api/run requests (max ${RUN_RATE_LIMIT}/${RUN_RATE_WINDOW_MS / 1000}s)`,
            origin,
            { 'Retry-After': String(Math.ceil(RUN_RATE_WINDOW_MS / 1000)), ...(verifyHeaders || {}) },
        );
    }

    const capped = await readCappedJson(req, RUN_MAX_BODY_BYTES);
    if (!capped.ok) {
        return jsonError(413, 'PAYLOAD_TOO_LARGE', 'run body too large', origin, verifyHeaders);
    }
    const v = validate(capped.value);
    if (!v.ok) {
        return jsonError(400, 'BAD_REQUEST', v.err, origin, verifyHeaders);
    }
    // `auto` (PWA default) means interpret — normalize before execution/proxy
    // so the upstream only ever sees a concrete mode.
    if (v.value.mode === 'auto') v.value.mode = 'interpret';

    // Best-effort usage meter; failures/unbound KV must not block runs.
    // Keyed by key-hash prefix — the raw secret never lands in KV (A21).
    // Best-effort read-modify-write (KV has no atomic incr); lossy by design.
    if (rawKey && env.USAGE) {
        try {
            const keyHash = await sha256Hex(rawKey);
            const usageKey = `usage:${keyHash.slice(0, 16)}`;
            const current = parseInt((await env.USAGE.get(usageKey)) ?? '0', 10);
            await env.USAGE.put(usageKey, String(current + 1), {
                expirationTtl: 60 * 60 * 24 * 30,
            });
        } catch {
            /* meter must not block */
        }
    }

    // 1) In-Worker Python via Pyodide (preferred when enabled).
    if (env.PYODIDE_IN_WORKER === 'enabled') {
        const pyResult = await tryRunInWorker(v.value.script, v.value.data, env);
        if (pyResult) {
            return jsonResponse(pyResult, {
                status: 200,
                headers: { 'Access-Control-Allow-Origin': origin, ...(verifyHeaders || {}) },
            });
        }
        // Fall through to external if Pyodide failed to boot.
    }

    // 2) External backend (re-serialize parsed body — Request body is one-shot).
    return proxyToExternal(JSON.stringify(v.value), env, origin, verifyHeaders);
}
