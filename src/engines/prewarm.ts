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
 * PYNE `POST /compile/prewarm` — pay Numba JIT / IR-cache population before the
 * first interactive run.
 *
 * The backend compiles with `mode: auto` by default, so a cold host makes the
 * *first* run absorb the JIT cost (seconds on a large script). Prewarming warms
 * the shared builtin kernels and, optionally, specific Pine sources, without
 * evaluating anything on OHLCV — it only fills the IR / disk caches.
 *
 * The client never throws: callers (Runtime button, Workers Manager, CLI) all
 * want a typed outcome to render, and a backend without the route must degrade
 * to "unsupported" rather than an exception.
 *
 * Wire contract: `POST {endpoint}/compile/prewarm` with an optional
 * `{ scripts?: string[], force?: boolean }`; the response carries
 * `has_numba`, `builtins_warmed`, `prewarm_ms`, `scripts_ok`,
 * `scripts_failed` and per-script `errors`.
 *
 * @module engines/prewarm
 */

import { getActiveEngineConfig } from '../plugins/active';
import { confirmEngineApiKeyTarget } from './catalog';

/** Backend hard cap on `scripts` per prewarm call (`backend/app.py`). */
export const MAX_PREWARM_SCRIPTS = 16;

/** Numba JIT can legitimately take a while on a cold host. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface PrewarmResult {
  /** The request reached the backend and it accepted the warm pass. */
  ok: boolean;
  /** Numba importable in the backend process (object-mode compile still works without). */
  hasNumba: boolean;
  /** Shared builtin kernels are warmed after this call. */
  builtinsWarmed: boolean;
  /** Sources the backend compiled successfully. */
  scriptsOk: number;
  /** Sources the backend rejected or failed to compile. */
  scriptsFailed: number;
  /** Backend wall time for the warm pass (ms), when reported. */
  prewarmMs: number | null;
  /** Per-script failures, already truncated server-side. */
  errors: string[];
  /** Why the call failed (unreachable, unsupported, declined consent). */
  error: string | null;
}

export interface PrewarmOptions {
  /** Sources to compile into the IR cache. Capped at {@link MAX_PREWARM_SCRIPTS}. */
  scripts?: readonly string[];
  /** Re-warm builtins even when the backend already reports them warm. */
  force?: boolean;
  /** Override the active engine endpoint (CLI / explicit target). */
  endpoint?: string;
  /** Override the active engine API key. */
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function failure(error: string): PrewarmResult {
  return {
    ok: false,
    hasNumba: false,
    builtinsWarmed: false,
    scriptsOk: 0,
    scriptsFailed: 0,
    prewarmMs: null,
    errors: [],
    error,
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Fingerprints of script sets already warmed this session. A repeat of the same
 * sources is a no-op; a changed script warms again; a failed call is forgotten
 * so the next attempt can retry.
 */
const warmedFingerprints = new Set<string>();

/** @internal test helper */
export function _resetPrewarmMemoForTests(): void {
  warmedFingerprints.clear();
}

/** Cheap FNV-1a over the sources so the memo key does not retain them. */
function sourcesFingerprint(endpoint: string, scripts: readonly string[]): string {
  let h = 2166136261;
  for (const s of scripts) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x2f;
    h = Math.imul(h, 16777619);
  }
  return `${endpoint}|${scripts.length}|${(h >>> 0).toString(36)}`;
}

/**
 * Applied, visible, non-library script sources — the set a user is actually
 * evaluating, so warming them pays off. Capped to the backend limit.
 */
export async function collectAppliedScriptSources(): Promise<string[]> {
  const { store } = await import('../store');
  const { detectScriptKind } = await import('../indicators/script-meta');
  const out: string[] = [];
  for (const s of store.scripts || []) {
    if (!s?.visible || !s.code?.trim()) continue;
    if (detectScriptKind(s.code) === 'library') continue;
    out.push(s.code);
    if (out.length >= MAX_PREWARM_SCRIPTS) break;
  }
  return out;
}

/**
 * Warm the applied chart scripts once per session.
 *
 * Returns `null` when there is nothing to warm or the exact source set was
 * already warmed (the cheap path callers can fire without thinking). Callers
 * pass `scripts` explicitly for testability; omit it to read the store.
 */
export async function prewarmAppliedScripts(
  opts: PrewarmOptions & { scripts?: readonly string[] } = {},
): Promise<PrewarmResult | null> {
  const scripts = normalizeScripts(opts.scripts ?? (await collectAppliedScriptSources()));
  if (!scripts.length) return null;
  const cfg = getActiveEngineConfig() || {};
  const endpoint = String(opts.endpoint ?? cfg.endpoint ?? '')
    .trim()
    .replace(/\/$/, '');
  const key = sourcesFingerprint(endpoint, scripts);
  if (warmedFingerprints.has(key)) return null;
  warmedFingerprints.add(key);
  const result = await prewarmEngine({ ...opts, scripts });
  if (!result.ok) warmedFingerprints.delete(key);
  return result;
}

/** Combine the caller's abort with a timeout budget (AbortSignal.any when available). */
function requestSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([timeout, parent])
    : timeout;
}

/** Trim + drop blanks + enforce the backend cap. */
function normalizeScripts(scripts: readonly string[] | undefined): string[] {
  if (!scripts?.length) return [];
  const out: string[] = [];
  for (const s of scripts) {
    if (typeof s !== 'string' || !s.trim()) continue;
    out.push(s);
    if (out.length >= MAX_PREWARM_SCRIPTS) break;
  }
  return out;
}

/**
 * Warm the configured (or explicit) PYNE endpoint.
 *
 * Resolves endpoint / API key the same way the runner does
 * (`getActiveEngineConfig()`), respects the cross-origin key consent gate, and
 * returns a typed result for every outcome.
 */
export async function prewarmEngine(opts: PrewarmOptions = {}): Promise<PrewarmResult> {
  const cfg = getActiveEngineConfig() || {};
  const endpoint = String(opts.endpoint ?? cfg.endpoint ?? '')
    .trim()
    .replace(/\/$/, '');
  const apiKey = String(opts.apiKey ?? cfg.apiKey ?? '').trim();
  if (!endpoint) {
    return failure('No backend endpoint — select the server engine and set a URL');
  }
  if (/pyodide/i.test(endpoint)) {
    return failure('Pyodide runs in this tab — prewarm applies to a server engine');
  }
  // Never send a key to a fresh cross-origin backend without consent. Declined
  // → no request at all (the warm pass is optional, not worth a leaked secret).
  if (apiKey && !confirmEngineApiKeyTarget(endpoint, apiKey)) {
    return failure('API key withheld for unconfirmed engine origin');
  }

  const scripts = normalizeScripts(opts.scripts);
  const body: Record<string, unknown> = {};
  if (scripts.length) body.scripts = scripts;
  if (opts.force) body.force = true;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(`${endpoint}/compile/prewarm`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: requestSignal(opts.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 405) {
      return failure('Backend has no /compile/prewarm route (older PYNE)');
    }
    if (!res.ok) {
      return failure(`Prewarm failed (HTTP ${res.status})`);
    }
    const raw = (await res.json()) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || raw.status === 'error') {
      const message = typeof raw?.message === 'string' && raw.message ? raw.message : null;
      return failure(message || 'Backend rejected the prewarm request');
    }
    return {
      ok: true,
      hasNumba: raw.has_numba === true,
      builtinsWarmed: raw.builtins_warmed === true,
      scriptsOk: num(raw.scripts_ok) ?? 0,
      scriptsFailed: num(raw.scripts_failed) ?? 0,
      prewarmMs: num(raw.prewarm_ms),
      errors: Array.isArray(raw.errors)
        ? raw.errors.filter((e): e is string => typeof e === 'string')
        : [],
      error: null,
    };
  } catch (err: unknown) {
    if (opts.signal?.aborted) return failure('Prewarm cancelled');
    const raw = err instanceof Error ? err.message : String(err);
    return failure(/abort/i.test(raw) ? 'Prewarm timed out' : raw);
  }
}
