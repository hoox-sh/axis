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
 * In-memory last-run profiler (timing + plot/series counts).
 * Pure store — no vscode. Never throws.
 */

/** Last-run timing snapshot posted to the Profiler webview. */
export interface ProfilerSnapshot {
  runId: string;
  status: 'success' | 'error';
  ms: number;
  engineId: string;
  seriesKey: string;
  plotCount: number;
  seriesCount: number;
  createdAt: number;
  error?: string;
}

/** Run-shaped input (Results lastRun / orchestrator publish). */
export interface ProfilerRunInput {
  id: string;
  status: 'success' | 'error' | string;
  engineId: string;
  seriesKey: string;
  plots?: unknown;
  series?: unknown;
  meta?: unknown;
  error?: unknown;
  createdAt?: unknown;
}

export type ProfilerListener = (snapshot: ProfilerSnapshot | null) => void;

const PROFILER_SET_TYPE = 'profiler.set' as const;

/**
 * Count plots like `src/mcp/lm-tools.ts` countPlots:
 * array → length; object → own enumerable keys; else 0.
 */
export function countPlots(plots: unknown): number {
  try {
    if (plots == null) return 0;
    if (Array.isArray(plots)) return plots.length;
    if (typeof plots === 'object') return Object.keys(plots as object).length;
    return 0;
  } catch {
    return 0;
  }
}

/** Series count: array length or object keys (same rule as {@link countPlots}). */
export function countSeries(series: unknown): number {
  return countPlots(series);
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function pickMs(meta: unknown): number {
  try {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 0;
    const ms = (meta as { ms?: unknown }).ms;
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return 0;
    return ms < 0 ? 0 : ms;
  } catch {
    return 0;
  }
}

function pickCreatedAt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return fallback;
}

function pickStatus(value: unknown): 'success' | 'error' {
  return value === 'error' ? 'error' : 'success';
}

function pickError(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Build a snapshot from a run-shaped record. Returns null on unusable input. */
export function snapshotFromRun(record: unknown): ProfilerSnapshot | null {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const rec = record as ProfilerRunInput;
    const runId = asText(rec.id).trim();
    if (!runId) return null;
    const error = pickError(rec.error);
    const snapshot: ProfilerSnapshot = {
      runId,
      status: pickStatus(rec.status),
      ms: pickMs(rec.meta),
      engineId: asText(rec.engineId),
      seriesKey: asText(rec.seriesKey),
      plotCount: countPlots(rec.plots),
      seriesCount: countSeries(rec.series),
      createdAt: pickCreatedAt(rec.createdAt, Date.now()),
    };
    if (error) snapshot.error = error;
    return snapshot;
  } catch {
    return null;
  }
}

/** Host → profiler webview envelope (not axis.webview.v1). */
export function encodeProfilerSet(snapshot: ProfilerSnapshot | null): {
  type: typeof PROFILER_SET_TYPE;
  payload: ProfilerSnapshot | null;
  ts: number;
} {
  return {
    type: PROFILER_SET_TYPE,
    payload: snapshot,
    ts: Date.now(),
  };
}

export class ProfilerStore {
  private snapshot: ProfilerSnapshot | null = null;
  private readonly listeners = new Set<ProfilerListener>();

  /** Subscribe to snapshot changes. Returns unsubscribe. Hostile listeners swallowed. */
  subscribe(listener: ProfilerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Record last-run timing / counts from a run-shaped object.
   * Never throws. No-ops on unusable input (keeps previous snapshot).
   */
  recordFromRun(record: ProfilerRunInput | unknown): ProfilerSnapshot | null {
    try {
      const next = snapshotFromRun(record);
      if (!next) return this.snapshot;
      this.snapshot = next;
      this.emit();
      return this.snapshot;
    } catch {
      return this.snapshot;
    }
  }

  getSnapshot(): ProfilerSnapshot | null {
    return this.snapshot;
  }

  /** Test helper. */
  clear(): void {
    this.snapshot = null;
  }

  private emit(): void {
    const snap = this.snapshot;
    for (const listener of [...this.listeners]) {
      try {
        listener(snap);
      } catch {
        // never break record on hostile listeners
      }
    }
  }
}

type ResultsLike = {
  subscribe?(
    listener: (snapshot: { lastRun?: unknown }, reason?: unknown) => void,
  ): unknown;
  getLastRun?(): unknown;
};

type ProfilerLike = {
  recordFromRun?(record: unknown): unknown;
};

/**
 * Subscribe a profiler to a ResultsFocusStore (or structural lookalike).
 * Records current lastRun immediately, then on each emit with a lastRun.
 * Never throws. Returns unsubscribe (no-op on hostile store).
 */
export function attachProfiler(store: unknown, profiler: unknown): () => void {
  const noop = (): void => {};
  try {
    if (!store || typeof store !== 'object' || Array.isArray(store)) return noop;
    if (!profiler || typeof profiler !== 'object' || Array.isArray(profiler)) {
      return noop;
    }
    const s = store as ResultsLike;
    const p = profiler as ProfilerLike;
    const record = p.recordFromRun;
    if (typeof record !== 'function') return noop;
    const recordFromRun = record.bind(p) as (rec: unknown) => unknown;

    try {
      const last = typeof s.getLastRun === 'function' ? s.getLastRun() : undefined;
      if (last != null) recordFromRun(last);
    } catch {
      // keep going — still attach subscribe
    }

    if (typeof s.subscribe !== 'function') return noop;
    const unsub = s.subscribe((snapshot) => {
      try {
        const last =
          snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
            ? snapshot.lastRun
            : undefined;
        if (last != null) recordFromRun(last);
      } catch {
        // swallow
      }
    });
    return typeof unsub === 'function' ? (unsub as () => void) : noop;
  } catch {
    return noop;
  }
}
