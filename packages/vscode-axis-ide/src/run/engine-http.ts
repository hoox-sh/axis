// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Thin Pro `/run` HTTP adapter (PR-06). Injectable fetch for unit tests.
 * Body mirrors PYNE `runOnPro` / AXIS catalog REST: `{ script, data, mode, symbol? }`.
 */

import type { OhlcvBar } from '../host/mock-bars';

export type RunMode = 'auto' | 'interpret' | 'compile';

/** Fetch subset used by the adapter (globalThis.fetch-compatible). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface EngineHttpRequest {
  endpoint: string;
  script: string;
  bars: OhlcvBar[];
  mode: RunMode;
  /** Optional chart symbol label (defaults to CHART). */
  symbol?: string;
  /** Bearer token (`pyn_…`). Required by callers that enforce Pro auth. */
  apiKey?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

export interface EngineCompileDiagnostic {
  message: string;
  line?: number;
  column?: number;
  severity?: 'error' | 'warning' | 'info';
}

export interface EngineRunResult {
  status: 'success' | 'error';
  plots: unknown;
  series: Record<string, unknown>;
  events: unknown[];
  drawings?: unknown;
  error?: string;
  code?: string;
  httpStatus?: number;
  diagnostics: EngineCompileDiagnostic[];
  raw?: unknown;
  meta: { ms?: number; transport: 'rest' };
}

export const MISSING_ENDPOINT_ERROR =
  'AXIS engine endpoint is empty. Set axis.engine.endpoint (e.g. http://127.0.0.1:5002).';

export const MISSING_API_KEY_ERROR =
  'AXIS Pro API key required for POST /run (SecretStorage pyn_…).';

export const DEFAULT_ENGINE_ENDPOINT = 'http://127.0.0.1:5002';

/** Chart bars store unix seconds; Pine `time` expects milliseconds. */
export function barsForPine(bars: OhlcvBar[]): Array<Record<string, number>> {
  if (!Array.isArray(bars)) return [];
  return bars.map((bar) => {
    const time = Number(bar?.time);
    const pineTime =
      Number.isFinite(time) && time > 0 && time < 1e11 ? Math.round(time * 1000) : time;
    return {
      time: pineTime,
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume),
    };
  });
}

function trimEndpoint(endpoint: string): string {
  return String(endpoint ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function coerceSeriesMap(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key || key.startsWith('_')) continue;
    if (Array.isArray(value)) out[key] = value;
  }
  return out;
}

function coerceDiagnostics(raw: unknown, fallbackMessage?: string): EngineCompileDiagnostic[] {
  const out: EngineCompileDiagnostic[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === 'string' && entry.trim()) {
        out.push({ message: entry.trim(), severity: 'error' });
        continue;
      }
      if (!isPlainObject(entry)) continue;
      const message = String(entry.message ?? entry.error ?? entry.msg ?? '').trim();
      if (!message) continue;
      const lineRaw = entry.line ?? entry.lineno ?? entry.row;
      const colRaw = entry.column ?? entry.col ?? entry.character;
      const line =
        typeof lineRaw === 'number' && Number.isFinite(lineRaw)
          ? Math.max(1, Math.floor(lineRaw))
          : undefined;
      const column =
        typeof colRaw === 'number' && Number.isFinite(colRaw)
          ? Math.max(0, Math.floor(colRaw))
          : undefined;
      const sev = String(entry.severity ?? entry.level ?? 'error').toLowerCase();
      const severity: EngineCompileDiagnostic['severity'] =
        sev === 'warning' || sev === 'warn'
          ? 'warning'
          : sev === 'info' || sev === 'hint'
            ? 'info'
            : 'error';
      out.push({ message, line, column, severity });
    }
  }
  if (out.length === 0 && fallbackMessage) {
    out.push({ message: fallbackMessage, severity: 'error' });
  }
  return out;
}

/** Map a loose Pro `/run` JSON body into a stable host result (never throws). */
export function mapEngineResponse(
  raw: unknown,
  opts?: { httpStatus?: number; ms?: number },
): EngineRunResult {
  try {
    const ms = opts?.ms;
    const httpStatus = opts?.httpStatus;
    if (!isPlainObject(raw)) {
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
        error: 'Empty or invalid engine response',
        httpStatus,
        diagnostics: [{ message: 'Empty or invalid engine response', severity: 'error' }],
        raw,
        meta: { ms, transport: 'rest' },
      };
    }

    const explicitError =
      raw.status === 'error' || raw.status === 'failed' || raw.ok === false;
    const explicitSuccess = raw.status === 'success' || raw.status === 'ok';
    const message =
      typeof raw.message === 'string'
        ? raw.message
        : typeof raw.error === 'string'
          ? raw.error
          : raw.error != null
            ? String(raw.error)
            : undefined;
    const status: 'success' | 'error' = explicitError
      ? 'error'
      : explicitSuccess
        ? 'success'
        : message
          ? 'error'
          : 'success';

    const diagnostics = coerceDiagnostics(
      raw.errors ?? raw.diagnostics ?? raw.compile_errors,
      status === 'error' ? message : undefined,
    );

    const plots = Array.isArray(raw.plots) ? raw.plots : raw.plots ?? [];
    const series = coerceSeriesMap(raw.series);
    const events = Array.isArray(raw.events) ? raw.events : [];
    const code = typeof raw.code === 'string' ? raw.code : undefined;

    const result: EngineRunResult = {
      status,
      plots,
      series,
      events,
      diagnostics,
      raw,
      meta: { ms, transport: 'rest' },
      httpStatus,
    };
    if (status === 'error') {
      result.error = message || code || `HTTP ${httpStatus ?? 'error'}`;
      if (code) result.code = code;
    }
    if (Array.isArray(raw.drawings)) result.drawings = raw.drawings;
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: msg,
      diagnostics: [{ message: msg, severity: 'error' }],
      httpStatus: opts?.httpStatus,
      meta: { ms: opts?.ms, transport: 'rest' },
    };
  }
}

/**
 * POST `{endpoint}/run` with script + bars. Never logs the API key.
 * Requires a non-empty `apiKey` (fail-closed — no anonymous Pro calls).
 */
export async function postEngineRun(req: EngineHttpRequest): Promise<EngineRunResult> {
  const t0 = Date.now();
  try {
    const endpoint = trimEndpoint(req.endpoint);
    if (!endpoint) {
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
        error: MISSING_ENDPOINT_ERROR,
        diagnostics: [{ message: MISSING_ENDPOINT_ERROR, severity: 'error' }],
        meta: { transport: 'rest' },
      };
    }

    const key = typeof req.apiKey === 'string' ? req.apiKey.trim() : '';
    if (!key) {
      return {
        status: 'error',
        plots: [],
        series: {},
        events: [],
        error: MISSING_API_KEY_ERROR,
        diagnostics: [{ message: MISSING_API_KEY_ERROR, severity: 'error' }],
        meta: { transport: 'rest' },
      };
    }

    const fetchImpl = req.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const url = `${endpoint}/run`;
    const body = {
      script: req.script,
      data: barsForPine(req.bars),
      mode: req.mode || 'auto',
      symbol: (req.symbol && String(req.symbol).trim()) || 'CHART',
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    };

    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    const text = await res.text();
    const ms = Date.now() - t0;

    let parsed: unknown;
    try {
      parsed = text && text.trim() ? JSON.parse(text) : null;
    } catch {
      parsed = {
        status: 'error',
        code: 'INVALID_RESPONSE',
        message: `HTTP ${res.status}: non-JSON body`,
      };
    }

    const mapped = mapEngineResponse(parsed, { httpStatus: res.status, ms });
    if (!res.ok && mapped.status === 'success') {
      // HTTP error with a success-shaped body — treat as error.
      const msg =
        mapped.error ||
        (isPlainObject(parsed) && typeof parsed.message === 'string'
          ? parsed.message
          : `HTTP ${res.status}`);
      return {
        ...mapped,
        status: 'error',
        error: msg,
        diagnostics:
          mapped.diagnostics.length > 0
            ? mapped.diagnostics
            : [{ message: msg, severity: 'error' }],
      };
    }
    return mapped;
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    const aborted =
      (e instanceof Error && e.name === 'AbortError') || /aborted/i.test(msg);
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: aborted ? 'Aborted' : msg,
      diagnostics: [{ message: aborted ? 'Aborted' : msg, severity: 'error' }],
      meta: { ms, transport: 'rest' },
    };
  }
}
