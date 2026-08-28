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
 * Pure helpers for the indicator run pipeline: defensive engine payload
 * parsing, user-readable transport errors, and concurrent-run epochs.
 *
 * Chart mutation stays in {@link indicators/runner}; this module never
 * touches the store or Lightweight Charts.
 *
 * @module indicators/run-helpers
 */

import type { RunResult as EngineRunResult } from '../plugins/types';

/** Engine result with `series` / `plots` / `events` always present. */
export type NormalizedRunResult = EngineRunResult & {
  series: Record<string, (number | string | null)[]>;
  plots: (number | null)[];
  events: NonNullable<EngineRunResult['events']>;
};

// ── Plot sample / time coercion ─────────────────────────────────────

/**
 * Coerce a single plot sample to a finite number, or null (Pine `na`).
 * Accepts numbers, numeric strings; rejects NaN / ±Infinity / "na" / objects.
 */
export function coercePlotSample(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const lower = s.toLowerCase();
    if (lower === 'na' || lower === 'nan' || lower === 'null' || lower === 'none') {
      return null;
    }
    if (lower === 'infinity' || lower === '+infinity' || lower === '-infinity') {
      return null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * CSS color strings pass through untouched — Pine `bgcolor` / `barcolor`
 * series are per-bar color samples (`rgba(…)` / hex), not numbers. Numeric
 * coercion would turn every bar into `null` and silently drop the plot.
 */
const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color\()/i;

export function coerceSeriesSample(v: unknown): number | string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    if (CSS_COLOR_RE.test(s)) return s;
  }
  return coercePlotSample(v);
}

/**
 * Normalize a bar/plot time to LWC UTCTimestamp seconds.
 * Milliseconds (>1e12) → floor(ms/1000). Non-finite → null.
 */
export function normalizeBarTime(t: unknown): number | null {
  if (t == null) return null;
  const n = typeof t === 'number' ? t : Number(t);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * Map OHLCV times + parallel series values → line points.
 * One point per valid time; non-finite samples become whitespace `{ time }`.
 * Safe with empty arrays, sparse series, NaN, string numerics, ms times.
 * Pre-sizes for large bar windows to keep apply cheap.
 */
export function seriesValuesToLineData(
  times: ReadonlyArray<unknown>,
  values: unknown,
): { time: number; value?: number }[] {
  if (!Array.isArray(times) || times.length === 0) return [];
  const arr = Array.isArray(values) ? values : [];
  const out: { time: number; value?: number }[] = new Array(times.length);
  let n = 0;
  for (let i = 0; i < times.length; i++) {
    const time = normalizeBarTime(times[i]);
    if (time == null) continue;
    const v = coercePlotSample(arr[i]);
    if (v != null) out[n++] = { time, value: v };
    else out[n++] = { time };
  }
  out.length = n;
  return out;
}

/** True when line data has at least one finite sample value. */
export function lineDataHasSample(
  data: ReadonlyArray<{ time: number; value?: number }>,
): boolean {
  return data.some((d) => d.value != null && Number.isFinite(d.value));
}

// ── Engine payload normalization ────────────────────────────────────

/** Ensure series values are `(number|null)[]`; drop non-array entries. */
export function normalizeSeriesMap(
  series: unknown,
): Record<string, (number | string | null)[]> {
  if (!series || typeof series !== 'object' || Array.isArray(series)) return {};
  const out: Record<string, (number | string | null)[]> = {};
  for (const [key, raw] of Object.entries(series as Record<string, unknown>)) {
    if (!key || key.startsWith('__') || key.startsWith('_')) continue;
    if (!Array.isArray(raw)) continue;
    // Coerce samples so cache/consumers never see NaN garbage; CSS color
    // strings (bgcolor/barcolor) pass through untouched.
    out[key] = raw.map((v) => coerceSeriesSample(v));
  }
  return out;
}

/** Ensure top-level plots is a finite-coerced array (never undefined). */
export function normalizePlotsArray(plots: unknown): (number | null)[] {
  if (!Array.isArray(plots)) return [];
  return plots.map((v) => coercePlotSample(v));
}

/**
 * Ensure events is an array of objects with numeric `time` when possible.
 *
 * Pyne / Pro API strategy payloads use **`bar_time`** (not `time`). Dropping
 * those would empty Results, strategy markers, and the tester report.
 * Accept either field; always surface a finite unix-seconds `time` for LWC.
 */
export function normalizeEventsArray(
  events: unknown,
): NonNullable<EngineRunResult['events']> {
  if (!Array.isArray(events)) return [];
  const out: NonNullable<EngineRunResult['events']> = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    // Prefer explicit `time`, then parity `bar_time` (pyne StrategyEvent).
    const time = normalizeBarTime(
      rec.time != null && rec.time !== '' ? rec.time : rec.bar_time,
    );
    if (time == null) continue;
    const kindOrType =
      rec.type != null && String(rec.type).length
        ? String(rec.type)
        : rec.kind != null && String(rec.kind).length
          ? String(rec.kind)
          : rec.event != null && String(rec.event).length
            ? String(rec.event)
            : 'unknown';
    out.push({
      ...rec,
      time,
      // Keep bar_time aligned (ms→s) so later normalizers stay consistent
      bar_time:
        rec.bar_time != null && Number.isFinite(Number(rec.bar_time))
          ? (normalizeBarTime(rec.bar_time) ?? time)
          : time,
      type: kindOrType,
      kind: rec.kind != null && String(rec.kind).length ? String(rec.kind) : kindOrType,
    });
  }
  return out;
}

/**
 * Lift loose engine / fetch payloads into a stable {@link NormalizedRunResult}.
 * Never throws. Missing fields become empty containers; error status preserved.
 */
export function normalizeEngineResult(raw: unknown, ms?: number): NormalizedRunResult {
  if (!raw || typeof raw !== 'object') {
    return {
      status: 'error',
      plots: [],
      series: {},
      events: [],
      error: 'Empty or invalid engine response',
      meta: { ms },
    };
  }
  const r = raw as Record<string, unknown>;
  // Explicit error / failed / ok:false → error. Explicit success / ok → success
  // (never downgrade a successful run just because a non-fatal warning landed in
  // `error` / `message`). Missing status infers from error/message; any other
  // status string is treated as success (we have a payload to apply).
  const explicitError =
    r.status === 'error' || r.status === 'failed' || r.ok === false;
  const explicitSuccess = r.status === 'success' || r.status === 'ok';
  const status: 'success' | 'error' = explicitError
    ? 'error'
    : explicitSuccess
      ? 'success'
      : r.status == null
        ? r.error || r.message
          ? 'error'
          : 'success'
        : 'success';

  const series = normalizeSeriesMap(r.series);
  const plots = normalizePlotsArray(r.plots);
  const events = normalizeEventsArray(r.events);

  const metaRaw =
    r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta)
      ? { ...(r.meta as Record<string, unknown>) }
      : {};
  if (ms != null && Number.isFinite(ms)) {
    metaRaw.ms = typeof metaRaw.ms === 'number' ? metaRaw.ms : ms;
  }

  // Lift top-level common fields engines sometimes put outside meta
  if (r.plot_meta && !metaRaw.plot_meta) metaRaw.plot_meta = r.plot_meta;
  if (r.script_name != null && metaRaw.script_name == null) {
    metaRaw.script_name = r.script_name;
  }
  if (r.overlay !== undefined && metaRaw.overlay === undefined) {
    metaRaw.overlay = r.overlay;
  }
  if (r.transport != null && metaRaw.transport == null) {
    metaRaw.transport = r.transport;
  }

  const errorMsg =
    status === 'error'
      ? formatRunError(r.error ?? r.message ?? 'Engine error')
      : undefined;

  const result: NormalizedRunResult = {
    status,
    plots,
    series,
    events,
    meta: metaRaw as EngineRunResult['meta'],
  };

  if (errorMsg) result.error = errorMsg;

  if (Array.isArray(r.drawings)) {
    result.drawings = r.drawings as EngineRunResult['drawings'];
  }
  if (r.inputs !== undefined) result.inputs = r.inputs;
  if (Array.isArray(r.logs)) {
    result.logs = r.logs as EngineRunResult['logs'];
  } else if (Array.isArray(metaRaw.logs)) {
    result.logs = metaRaw.logs as EngineRunResult['logs'];
  }
  if (r.profile && typeof r.profile === 'object') {
    result.profile = r.profile as Record<string, unknown>;
  } else if (metaRaw.profile && typeof metaRaw.profile === 'object') {
    result.profile = metaRaw.profile as Record<string, unknown>;
  }

  return result;
}

// ── User-readable errors ────────────────────────────────────────────

/**
 * Map raw transport / AbortError / network strings to status-bar copy.
 * Script parse messages pass through mostly unchanged.
 */
export function formatRunError(err: unknown): string {
  if (err == null || err === '') return 'Engine error';
  const raw =
    err instanceof Error
      ? err.message || err.name || 'Engine error'
      : typeof err === 'string'
        ? err
        : String(err);
  const msg = raw.trim() || 'Engine error';
  const lower = msg.toLowerCase();

  // Abort / timeout (browser + AbortSignal.timeout)
  if (
    err instanceof DOMException &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  ) {
    if (err.name === 'TimeoutError' || /timeout/i.test(msg)) {
      return 'Engine timed out — try fewer bars, or check that the backend is reachable';
    }
    return 'Run cancelled';
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return /timeout/i.test(msg)
      ? 'Engine timed out — try fewer bars, or check that the backend is reachable'
      : 'Run cancelled';
  }
  if (
    /the operation was aborted due to timeout|signal timed out|timeouterror|timed?\s*out/i.test(
      msg,
    )
  ) {
    return 'Engine timed out — try fewer bars, or check that the backend is reachable';
  }
  if (/aborterror|the operation was aborted|request aborted|cancelled|canceled/i.test(lower)) {
    // Prefer timeout wording when both appear
    if (/timeout/i.test(lower)) {
      return 'Engine timed out — try fewer bars, or check that the backend is reachable';
    }
    return 'Run cancelled';
  }

  // Network
  if (
    /failed to fetch|networkerror|network request failed|load failed|err_connection|econnrefused|enotfound|fetch failed/i.test(
      lower,
    )
  ) {
    return 'Cannot reach the Pine engine — is the backend running and CORS allowed?';
  }
  if (/err_connection_refused|connection refused/i.test(lower)) {
    return 'Connection refused — start the Pine engine (e.g. pyne on :5002)';
  }

  // HTTP without body
  if (/^http\s*5\d\d/i.test(msg)) {
    return `Engine server error (${msg})`;
  }
  if (/^http\s*4\d\d/i.test(msg)) {
    return `Engine request failed (${msg})`;
  }

  // Cap extremely long stack-like blobs for status bar
  if (msg.length > 280) {
    return `${msg.slice(0, 277)}…`;
  }
  return msg;
}

// ── Concurrent run epochs ───────────────────────────────────────────

/** Monotonic epoch: each {@link beginRunEpoch} invalidates prior applies. */
let runEpoch = 0;

/**
 * Which run generation owns the interactive status bar (`running`).
 * Silent live re-runs must **not** advance {@link runEpoch} while this is set
 * (slow scripts like MTF `request.security` would otherwise show "Run superseded"
 * and never apply). Another interactive Run still supersedes via beginRunEpoch.
 */
let runStatusEpoch: number | null = null;

/** Start a new run generation; previous in-flight applies should no-op. */
export function beginRunEpoch(): number {
  runEpoch += 1;
  return runEpoch;
}

/** Current epoch (latest beginRunEpoch value). */
export function currentRunEpoch(): number {
  return runEpoch;
}

/** True when `epoch` is still the latest generation. */
export function isRunEpochCurrent(epoch: number): boolean {
  return epoch === runEpoch;
}

/** Epoch that currently owns interactive Run status, if any. */
export function getRunStatusEpoch(): number | null {
  return runStatusEpoch;
}

/**
 * True when an interactive (non-silent) Run owns the current epoch.
 * Silent live re-runs must defer instead of calling {@link beginRunEpoch}.
 */
export function isInteractiveRunInFlight(): boolean {
  return runStatusEpoch != null && runStatusEpoch === runEpoch;
}

/**
 * Mark `epoch` as owner of interactive status (`running` button).
 * Call when setting status to `running` for a non-silent run.
 */
export function claimRunStatus(epoch: number | undefined | null): void {
  if (epoch == null || !Number.isFinite(epoch)) return;
  runStatusEpoch = epoch;
}

/**
 * True when this epoch still owns the interactive Run status bar.
 * Used before setting ready/error, or to clear stuck `running` after supersede.
 */
export function ownsRunStatus(epoch: number | undefined | null): boolean {
  if (epoch == null) return runStatusEpoch == null;
  return runStatusEpoch === epoch;
}

/**
 * Release status ownership after a non-silent run finishes (ready/error) or is
 * cancelled. Only clears if `epoch` still owns the claim (or epoch is omitted).
 */
export function releaseRunStatus(epoch?: number | null): void {
  if (epoch == null || runStatusEpoch === epoch) {
    runStatusEpoch = null;
  }
}

/** @internal Test helper — reset epoch between cases. */
export function _resetRunEpochForTests(): void {
  runEpoch = 0;
  runStatusEpoch = null;
}
