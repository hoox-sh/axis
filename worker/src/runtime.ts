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
 * Optional `Authorization: Bearer` increments `USAGE` KV (`usage:<key>`), 30d TTL.
 * Body is validated once; the same parsed JSON is re-stringified for the proxy
 * because `Request` bodies are single-shot streams.
 */

import type { Env } from './index';
import { tryRunInWorker } from './pyodide_runtime';

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
    if (!Array.isArray(b.data) || b.data.length === 0) return { ok: false, err: 'data must be a non-empty array' };
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
    const upstream = await fetch(`${target}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyText,
    });
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
 * POST `/api/run` handler. Validates body, optionally meters usage, then
 * Pyodide → external proxy fallback.
 */
export async function handleRun(req: Request, env: Env, origin: string): Promise<Response> {
    const body = await req.json().catch(() => null);
    const v = validate(body);
    if (!v.ok) {
        return new Response(JSON.stringify({ status: 'error', code: 'BAD_REQUEST', message: v.err }), {
            status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
        });
    }

    // Best-effort usage meter; failures/unbound KV must not block runs.
    const auth = req.headers.get('Authorization') ?? '';
    if (auth.startsWith('Bearer ') && (env as unknown as { USAGE?: KVNamespace }).USAGE) {
        const key = auth.slice(7).trim();
        const usage = (env as unknown as { USAGE: KVNamespace }).USAGE;
        const current = parseInt((await usage.get(`usage:${key}`)) ?? '0', 10);
        await usage.put(`usage:${key}`, String(current + 1), { expirationTtl: 60 * 60 * 24 * 30 });
    }

    // 1) In-Worker Python via Pyodide (preferred when enabled).
    if (env.PYODIDE_IN_WORKER === 'enabled') {
        const pyResult = await tryRunInWorker(v.value.script, v.value.data, env);
        if (pyResult) {
            return new Response(JSON.stringify(pyResult), {
                status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin },
            });
        }
        // Fall through to external if Pyodide failed to boot.
    }

    // 2) External backend (re-serialize parsed body — Request body is one-shot).
    return proxyToExternal(JSON.stringify(body), env, origin);
}
