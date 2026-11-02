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
 * Loose host→webview decode for Profiler.
 * Accepts local `{ type: 'profiler.set', payload }` and v1 `results.set`.
 * Not part of axis.webview.v1 ALL_MESSAGE_TYPES.
 */

export const PROTOCOL_VERSION = 1 as const;

export type ProfilerViewSnapshot = {
  runId: string;
  status: string;
  ms: number;
  engineId: string;
  seriesKey: string;
  plotCount: number;
  seriesCount: number;
  createdAt?: number;
  error?: string;
};

export type WebviewDecodeOk = {
  ok: true;
  type: string;
  payload: Record<string, unknown> | null;
};
export type WebviewDecodeErr = { ok: false; error: string };
export type WebviewDecodeResult = WebviewDecodeOk | WebviewDecodeErr;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function countLike(value: unknown): number {
  try {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object') return Object.keys(value as object).length;
    return 0;
  } catch {
    return 0;
  }
}

/** Bar width percent: min(100%, ms/1000*100), never negative. */
export function barWidthPct(ms: unknown): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(100, (ms / 1000) * 100);
}

function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numOf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Derive a view snapshot from profiler.set payload or results.set lastRun. */
export function snapshotFromPayload(payload: unknown): ProfilerViewSnapshot | null {
  try {
    if (!isPlainObject(payload)) return null;
    if ('lastRun' in payload) {
      return snapshotFromPayload(payload.lastRun);
    }
    const runId = textOf(payload.runId) || textOf(payload.id);
    if (!runId) return null;
    const meta = isPlainObject(payload.meta) ? payload.meta : null;
    const ms =
      typeof payload.ms === 'number' && Number.isFinite(payload.ms)
        ? payload.ms
        : numOf(meta?.ms, 0);
    const plotCount =
      typeof payload.plotCount === 'number' && Number.isFinite(payload.plotCount)
        ? payload.plotCount
        : countLike(payload.plots);
    const seriesCount =
      typeof payload.seriesCount === 'number' && Number.isFinite(payload.seriesCount)
        ? payload.seriesCount
        : countLike(payload.series);
    const error = textOf(payload.error).trim();
    const out: ProfilerViewSnapshot = {
      runId,
      status: textOf(payload.status, 'unknown'),
      ms,
      engineId: textOf(payload.engineId),
      seriesKey: textOf(payload.seriesKey),
      plotCount,
      seriesCount,
    };
    const createdAt = numOf(payload.createdAt, 0);
    if (createdAt > 0) out.createdAt = createdAt;
    if (error) out.error = error;
    return out;
  } catch {
    return null;
  }
}

/** Never-throw decode of untrusted host postMessage data. */
export function decodeHostMessage(raw: unknown): WebviewDecodeResult {
  try {
    if (!isPlainObject(raw)) {
      return { ok: false, error: 'envelope must be a non-null object' };
    }
    if (typeof raw.type !== 'string' || raw.type.length === 0) {
      return { ok: false, error: 'type must be a non-empty string' };
    }
    if (raw.type !== 'profiler.set' && raw.type !== 'results.set') {
      return { ok: false, error: `unexpected type: ${raw.type}` };
    }
    if ('payload' in raw && raw.payload != null && !isPlainObject(raw.payload)) {
      return { ok: false, error: 'payload must be a plain object or null' };
    }
    const payload = isPlainObject(raw.payload) ? raw.payload : null;
    return { ok: true, type: raw.type, payload };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `decode failed: ${message}` };
  }
}

export function encodeProfilerReady(ts = Date.now()): {
  type: 'profiler.ready';
  payload: Record<string, never>;
  ts: number;
} {
  return { type: 'profiler.ready', payload: {}, ts };
}
