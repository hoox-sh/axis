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
 * PYNE Pro preview + quick-backtest surfaces.
 *
 * - `POST /preview/chart` — PNG thumbnail for a script over a close series
 * - `POST /preview/indicator` — PNG for one expression (`ta.sma(close, 14)`)
 * - `POST /backtest/quick` — quick strategy backtest (equity, trades, summary)
 *
 * All three are Pro-tier routes: a 403/404 means "this host does not offer it"
 * and must degrade to a message, never an exception. Requests carry the close
 * series only (the endpoints take `{close}` / OHLCV arrays, not bar objects).
 *
 * @module engines/pro
 */

import { getActiveEngineConfig } from '../plugins/active';
import { confirmEngineApiKeyTarget } from './catalog';
import { isAbortLike } from '../utils/errors';
import { combineAbortSignals } from '../utils/fetch-timeout';

const DEFAULT_TIMEOUT_MS = 60_000;

/** Bars sent to the preview endpoints; the backend caps render size anyway. */
export const PREVIEW_MAX_BARS = 500;

export interface PreviewOptions {
  /** `line` (default) or `ohlcv`. */
  type?: 'line' | 'ohlcv';
  color?: string;
  showVolume?: boolean;
  width?: number;
  height?: number;
}

export interface PreviewResult {
  ok: boolean;
  /** Base64 PNG payload (no data-URL prefix). */
  chart: string | null;
  bars: number | null;
  lastValue: number | null;
  /** Set when the host does not offer the route (Pro tier / older backend). */
  unavailable: boolean;
  error: string | null;
}

export interface BacktestSummary {
  [key: string]: unknown;
}

export interface QuickBacktestResult {
  ok: boolean;
  /** Equity curve values, when reported. */
  equityCurve: number[];
  trades: Array<Record<string, unknown>>;
  summary: BacktestSummary;
  /** Base64 PNG of the equity chart, when the backend rendered one. */
  equityChart: string | null;
  bars: number | null;
  initialCapital: number | null;
  unavailable: boolean;
  error: string | null;
}

export interface ProCallOptions {
  endpoint?: string;
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function failure(error: string, unavailable = false): PreviewResult {
  return { ok: false, chart: null, bars: null, lastValue: null, unavailable, error };
}

/** Resolve endpoint/key + consent; returns an error string when unusable. */
function resolveTarget(opts: ProCallOptions): { endpoint: string; headers: Record<string, string> } | string {
  const cfg = getActiveEngineConfig() || {};
  const endpoint = String(opts.endpoint ?? cfg.endpoint ?? '')
    .trim()
    .replace(/\/$/, '');
  const apiKey = String(opts.apiKey ?? cfg.apiKey ?? '').trim();
  if (!endpoint) return 'No backend endpoint — select the server engine and set a URL';
  if (/pyodide/i.test(endpoint)) return 'Pyodide runs in this tab — previews need a server engine';
  if (apiKey && !confirmEngineApiKeyTarget(endpoint, apiKey)) {
    return 'API key withheld for unconfirmed engine origin';
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return { endpoint, headers };
}

/** Last `PREVIEW_MAX_BARS` closes — the endpoints take a plain series. */
function closeSeries(closes: readonly number[]): number[] {
  const list = closes.filter((c) => typeof c === 'number' && Number.isFinite(c));
  return list.length > PREVIEW_MAX_BARS ? list.slice(list.length - PREVIEW_MAX_BARS) : list;
}

async function postJson(
  target: { endpoint: string; headers: Record<string, string> },
  path: string,
  body: unknown,
  opts: ProCallOptions,
): Promise<{ status: number; payload: Record<string, unknown> | null } | { error: string }> {
  try {
    const res = await fetch(`${target.endpoint}${path}`, {
      method: 'POST',
      headers: target.headers,
      body: JSON.stringify(body),
      signal: combineAbortSignals(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal),
    });
    let payload: Record<string, unknown> | null = null;
    try {
      const text = await res.text();
      const parsed: unknown = text.trim() ? JSON.parse(text) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = null;
    }
    return { status: res.status, payload };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    return { error: isAbortLike(err) ? 'Request timed out' : raw };
  }
}

/**
 * Render a PNG thumbnail for a script over the given closes.
 *
 * `unavailable` is true when the host does not offer the route (Pro tier or an
 * older backend), so the caller can hide the action instead of showing an error.
 */
export async function renderChartPreview(
  script: string,
  closes: readonly number[],
  options: PreviewOptions = {},
  opts: ProCallOptions = {},
): Promise<PreviewResult> {
  if (!String(script || '').trim()) return failure('No script to preview');
  const series = closeSeries(closes);
  if (!series.length) return failure('No close series to preview');
  const target = resolveTarget(opts);
  if (typeof target === 'string') return failure(target);

  const res = await postJson(
    target,
    '/preview/chart',
    {
      script,
      data: { close: series },
      options: {
        type: options.type ?? 'line',
        ...(options.color ? { color: options.color } : {}),
        ...(options.showVolume ? { show_volume: true } : {}),
        ...(options.width ? { width: options.width } : {}),
        ...(options.height ? { height: options.height } : {}),
      },
    },
    opts,
  );
  if ('error' in res) return failure(res.error);
  if (res.status === 403 || res.status === 404 || res.status === 501) {
    return failure('Preview is not available on this backend (Pro route)', true);
  }
  if (res.status < 200 || res.status >= 300 || !res.payload || res.payload.status === 'error') {
    const message =
      typeof res.payload?.message === 'string' && res.payload.message
        ? res.payload.message
        : `Preview failed (HTTP ${res.status})`;
    return failure(message);
  }
  const meta = (res.payload.meta || {}) as Record<string, unknown>;
  return {
    ok: true,
    chart: typeof res.payload.chart === 'string' ? res.payload.chart : null,
    bars: typeof meta.bars === 'number' ? meta.bars : series.length,
    lastValue: typeof meta.last_value === 'number' ? meta.last_value : null,
    unavailable: false,
    error: null,
  };
}

/** Render a PNG for one indicator expression (e.g. `ta.sma(close, 14)`). */
export async function renderIndicatorPreview(
  expression: string,
  closes: readonly number[],
  options: PreviewOptions = {},
  opts: ProCallOptions = {},
): Promise<PreviewResult> {
  if (!String(expression || '').trim()) return failure('No expression to preview');
  const series = closeSeries(closes);
  if (!series.length) return failure('No close series to preview');
  const target = resolveTarget(opts);
  if (typeof target === 'string') return failure(target);

  const res = await postJson(
    target,
    '/preview/indicator',
    {
      expression,
      data: { close: series },
      options: {
        ...(options.color ? { color: options.color } : {}),
        ...(options.width ? { width: options.width } : {}),
        ...(options.height ? { height: options.height } : {}),
      },
    },
    opts,
  );
  if ('error' in res) return failure(res.error);
  if (res.status === 403 || res.status === 404 || res.status === 501) {
    return failure('Preview is not available on this backend (Pro route)', true);
  }
  if (res.status < 200 || res.status >= 300 || !res.payload || res.payload.status === 'error') {
    const message =
      typeof res.payload?.message === 'string' && res.payload.message
        ? res.payload.message
        : `Preview failed (HTTP ${res.status})`;
    return failure(message);
  }
  const meta = (res.payload.meta || {}) as Record<string, unknown>;
  return {
    ok: true,
    chart: typeof res.payload.chart === 'string' ? res.payload.chart : null,
    bars: typeof meta.bars === 'number' ? meta.bars : series.length,
    lastValue: typeof meta.last_value === 'number' ? meta.last_value : null,
    unavailable: false,
    error: null,
  };
}

/**
 * `POST /backtest/quick` — one strategy over the current window.
 *
 * `mock_data` is only used when no OHLCV is supplied (the backend generates a
 * synthetic series), which keeps the route useful for a smoke test.
 */
export async function runQuickBacktest(
  script: string,
  ohlcv: { open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] },
  opts: ProCallOptions & { initialCapital?: number; mockBars?: number } = {},
): Promise<QuickBacktestResult> {
  const empty: QuickBacktestResult = {
    ok: false,
    equityCurve: [],
    trades: [],
    summary: {},
    equityChart: null,
    bars: null,
    initialCapital: null,
    unavailable: false,
    error: null,
  };
  if (!String(script || '').trim()) return { ...empty, error: 'No script to backtest' };
  const target = resolveTarget(opts);
  if (typeof target === 'string') return { ...empty, error: target };

  const closes = closeSeries(ohlcv.close);
  const hasData = closes.length > 0 && ohlcv.close.length === ohlcv.open.length;
  const res = await postJson(
    target,
    '/backtest/quick',
    {
      script,
      ...(hasData
        ? {
            data: {
              open: ohlcv.open.slice(-PREVIEW_MAX_BARS),
              high: ohlcv.high.slice(-PREVIEW_MAX_BARS),
              low: ohlcv.low.slice(-PREVIEW_MAX_BARS),
              close: closes,
              volume: ohlcv.volume.slice(-PREVIEW_MAX_BARS),
            },
          }
        : { mock_data: true, mock_bars: opts.mockBars ?? 252 }),
      initial_capital: opts.initialCapital ?? 10_000,
    },
    opts,
  );
  if ('error' in res) return { ...empty, error: res.error };
  if (res.status === 403 || res.status === 404 || res.status === 501) {
    return {
      ...empty,
      unavailable: true,
      error: 'Quick backtest is not available on this backend (Pro route)',
    };
  }
  if (res.status < 200 || res.status >= 300 || !res.payload || res.payload.status === 'error') {
    const message =
      typeof res.payload?.message === 'string' && res.payload.message
        ? res.payload.message
        : `Backtest failed (HTTP ${res.status})`;
    return { ...empty, error: message };
  }
  const result = (res.payload.result || {}) as Record<string, unknown>;
  const meta = (res.payload.meta || {}) as Record<string, unknown>;
  return {
    ok: true,
    equityCurve: Array.isArray(result.equity_curve)
      ? result.equity_curve.filter((v): v is number => typeof v === 'number')
      : [],
    trades: Array.isArray(result.trades)
      ? result.trades.filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      : [],
    summary: (result.summary as BacktestSummary) || {},
    equityChart: typeof result.equity_chart === 'string' ? result.equity_chart : null,
    bars: typeof meta.bars === 'number' ? meta.bars : closes.length || null,
    initialCapital: typeof meta.initial_capital === 'number' ? meta.initial_capital : null,
    unavailable: false,
    error: null,
  };
}

/** `GET /auth/usage` — tier + call budget for the configured key. */
export interface UsageResult {
  ok: boolean;
  keyId: string | null;
  tier: string | null;
  callsUsed: number | null;
  callsLimit: number | null;
  callsRemaining: number | null;
  lastUsed: number | null;
  /** True when the host has no usage route (older backend). */
  unavailable: boolean;
  error: string | null;
}

/**
 * Fetch usage for the configured key.
 *
 * Requires a key (the route is authenticated); without one the call is skipped
 * rather than provoking a 401.
 */
export async function fetchUsage(opts: ProCallOptions = {}): Promise<UsageResult> {
  const empty: UsageResult = {
    ok: false,
    keyId: null,
    tier: null,
    callsUsed: null,
    callsLimit: null,
    callsRemaining: null,
    lastUsed: null,
    unavailable: false,
    error: null,
  };
  const target = resolveTarget(opts);
  if (typeof target === 'string') return { ...empty, error: target };
  if (!target.headers['X-API-Key']) {
    return { ...empty, error: 'No API key configured for this engine' };
  }
  try {
    const res = await fetch(`${target.endpoint}/auth/usage`, {
      method: 'GET',
      headers: target.headers,
      signal: combineAbortSignals(opts.timeoutMs ?? 15_000, opts.signal),
    });
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return { ...empty, unavailable: true, error: 'Usage is not available on this backend' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ...empty, error: 'API key not recognised by this backend' };
    }
    if (!res.ok) return { ...empty, error: `Usage failed (HTTP ${res.status})` };
    const parsed = (await res.json()) as Record<string, unknown>;
    const usage = (parsed.usage || {}) as Record<string, unknown>;
    const asNum = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;
    return {
      ok: true,
      keyId: typeof parsed.key_id === 'string' ? parsed.key_id : null,
      tier: typeof parsed.tier === 'string' ? parsed.tier : null,
      callsUsed: asNum(usage.calls_used),
      callsLimit: asNum(usage.calls_limit),
      callsRemaining: asNum(usage.calls_remaining),
      lastUsed: asNum(usage.last_used),
      unavailable: false,
      error: null,
    };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    return { ...empty, error: /abort/i.test(raw) ? 'Usage request timed out' : raw };
  }
}
