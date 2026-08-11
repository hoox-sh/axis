// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
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
 * - When `API_KEYS` is bound or `REQUIRE_RUN_AUTH=1`, {@link requireApiKey} is mandatory.
 * - Always rate-limited per IP (and per key when authenticated) — isolate memory.
 * - Script/data size caps + upstream proxy timeout.
 *
 * Optional `Authorization: Bearer` increments `USAGE` KV (`usage:<key>`), 30d TTL.
 * Body is validated once; the same parsed JSON is re-stringified for the proxy
 * because `Request` bodies are single-shot streams.
 */

import type { Env } from './index';
import { requireApiKey } from './auth';
import { tryRunInWorker } from './pyodide_runtime';

/** Max Pine source length (chars) accepted by `/api/run`. */
const MAX_SCRIPT_CHARS = 512 * 1024;
/** Max OHLCV rows per run (aligned with chart history soft caps). */
const MAX_DATA_BARS = 50_000;
/** Upstream `/run` proxy timeout — prevents hung backends pinning Worker isolates. */
const PROXY_TIMEOUT_MS = 60_000;
/** Max runs per IP (or key) per window. */
const RUN_RATE_LIMIT = 30;
const RUN_RATE_WINDOW_MS = 60_000;

// ── Best-effort in-isolate rate limit (same pattern as git-oauth) ──
const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function allowRate(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || now - b.windowStart > windowMs) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) {
        if (now - v.windowStart > windowMs * 2) rateBuckets.delete(k);
      }
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** True when /api/run must authenticate (prod KV or explicit flag). */
function runAuthRequired(env: Env): boolean {
  if (env.API_KEYS) return true;
  const flag = String(env.REQUIRE_RUN_AUTH || '').toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

function jsonError(
  status: number,
  code: string,
  message: string,
  origin: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ status: 'error', code, message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      ...(extraHeaders || {}),
    },
  });
}

/** @internal test helper — clear rate buckets between tests. */
export function _resetRunRateLimitForTests(): void {
  rateBuckets.clear();
}

/** Client JSON body for `/api/run` (aligned with pyne Pro API). */
interface RunRequest {
    script: string;
    data: Array<{ time: number | string; open: number; high: number; low: number; close: number; volume?: number }>;
    mode?: 'interpret' | 'compile';
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
    if (b.mode !== undefined && b.mode !== 'interpret' && b.mode !== 'compile') {
        return { ok: false, err: 'mode must be "interpret" or "compile"' };
    }
    return { ok: true, value: b as unknown as RunRequest };
}

/** POST JSON body to `${EXTERNAL_BACKEND}/run`, preserving upstream status + body. */
async function proxyToExternal(bodyText: string, env: Env, origin: string): Promise<Response> {
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
            { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin } },
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
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
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
        },
    });
}

/**
 * POST `/api/run` handler. Auth (when required) → rate limit → validate →
 * optional usage meter → Pyodide → external proxy fallback.
 */
export async function handleRun(req: Request, env: Env, origin: string): Promise<Response> {
    // ── Auth gate (prod: API_KEYS bound or REQUIRE_RUN_AUTH) ──
    let userId: string | null = null;
    let rawKey: string | null = null;
    if (runAuthRequired(env)) {
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

    // ── Rate limit (always) ──
    const ip = clientIp(req);
    const rateKey = userId ? `run:user:${userId}` : rawKey ? `run:key:${rawKey.slice(0, 16)}` : `run:ip:${ip}`;
    if (!allowRate(rateKey, RUN_RATE_LIMIT, RUN_RATE_WINDOW_MS)) {
        return jsonError(
            429,
            'RATE_LIMIT',
            `Too many /api/run requests (max ${RUN_RATE_LIMIT}/${RUN_RATE_WINDOW_MS / 1000}s)`,
            origin,
            { 'Retry-After': String(Math.ceil(RUN_RATE_WINDOW_MS / 1000)) },
        );
    }

    const body = await req.json().catch(() => null);
    const v = validate(body);
    if (!v.ok) {
        return jsonError(400, 'BAD_REQUEST', v.err, origin);
    }

    // Best-effort usage meter; failures/unbound KV must not block runs.
    if (rawKey && env.USAGE) {
        try {
            const current = parseInt((await env.USAGE.get(`usage:${rawKey}`)) ?? '0', 10);
            await env.USAGE.put(`usage:${rawKey}`, String(current + 1), {
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
            return new Response(JSON.stringify(pyResult), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': origin,
                },
            });
        }
        // Fall through to external if Pyodide failed to boot.
    }

    // 2) External backend (re-serialize parsed body — Request body is one-shot).
    return proxyToExternal(JSON.stringify(body), env, origin);
}
