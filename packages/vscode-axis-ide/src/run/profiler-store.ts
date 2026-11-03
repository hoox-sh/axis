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
 * In-memory last-run profiler (timing + plot/series counts + top hot lines).
 * Pure store — no vscode. Never throws. Does not import host/.
 */

/** Per-line timing row for the Profiler hot-lines list (1-based). */
export interface ProfilerHotLine {
  line: number;
  ms: number;
  execs: number;
  pct: number;
}

/** Compact phase timing from `meta.profile.phases` (e.g. parse_ms / eval_ms). */
export interface ProfilerPhase {
  name: string;
  ms: number;
}

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
  /** Top hot lines by ms (at most 5). Empty when the engine omitted line data. */
  topLines: ProfilerHotLine[];
  /** Total profiled line rows before top-N truncation. */
  lineCount: number;
  /** Present only when `meta.profile.phases` has numeric entries. */
  phases?: ProfilerPhase[];
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
const DEFAULT_TOP_N = 5;
const LINE_KEYS = ['line', 'line_no', 'lineno'] as const;
const MS_KEYS = ['ms', 'time_ms', 'time'] as const;
const EXEC_KEYS = ['execs', 'count'] as const;

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

function isPlain(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickMs(meta: unknown): number {
  try {
    if (!isPlain(meta)) return 0;
    const ms = meta.ms;
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

/** `meta.profile` when it looks like a profile body; else null. */
function pickProfileBody(meta: unknown): Record<string, unknown> | null {
  try {
    if (!isPlain(meta)) return null;
    const profile = meta.profile;
    if (!isPlain(profile)) return null;
    return profile;
  } catch {
    return null;
  }
}

function pickRows(profile: Record<string, unknown>): unknown[] | null {
  for (const key of ['lines', 'line_stats'] as const) {
    try {
      const rows = profile[key];
      if (Array.isArray(rows)) return rows;
    } catch {
      // hostile collection — try the next key
    }
  }
  return null;
}

function firstNonNegative(row: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    try {
      const n = asFiniteNumber(row[key]);
      if (n != null && n >= 0) return n;
    } catch {
      // hostile getter — try next alias
    }
  }
  return null;
}

function draftFromRow(row: unknown): { line: number; ms: number; execs: number; pct: number | null } | null {
  if (!isPlain(row)) return null;
  let line: number | null = null;
  for (const key of LINE_KEYS) {
    try {
      const n = asFiniteNumber(row[key]);
      if (n == null) continue;
      const trunc = Math.trunc(n);
      if (trunc >= 1) {
        line = trunc;
        break;
      }
    } catch {
      // hostile line alias
    }
  }
  if (line == null) return null;
  const ms = firstNonNegative(row, MS_KEYS) ?? 0;
  const execs = Math.trunc(firstNonNegative(row, EXEC_KEYS) ?? 0);
  let pct: number | null = null;
  try {
    const rawPct = asFiniteNumber(row.pct);
    if (rawPct != null && rawPct >= 0) pct = rawPct;
  } catch {
    pct = null;
  }
  return { line, ms, execs, pct };
}

function readTotalMs(profile: Record<string, unknown>): number | null {
  for (const key of ['totalMs', 'total_ms'] as const) {
    try {
      const n = asFiniteNumber(profile[key]);
      if (n != null && n >= 0) return n;
    } catch {
      // hostile total
    }
  }
  return null;
}

/**
 * Top-N hot lines from `meta.profile.lines` or `line_stats`.
 * Empty / missing lines → `[]` (never invents percents).
 */
export function topHotLines(meta: unknown, n = DEFAULT_TOP_N): ProfilerHotLine[] {
  try {
    const limit = typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_TOP_N;
    const profile = pickProfileBody(meta);
    if (!profile) return [];
    const rows = pickRows(profile);
    if (!rows || rows.length === 0) return [];

    const byLine = new Map<number, { line: number; ms: number; execs: number; pct: number | null }>();
    const max = Math.min(rows.length, 100_000);
    for (let i = 0; i < max; i += 1) {
      let row: unknown;
      try {
        row = rows[i];
      } catch {
        continue;
      }
      const draft = draftFromRow(row);
      if (!draft) continue;
      const prev = byLine.get(draft.line);
      if (!prev) {
        byLine.set(draft.line, draft);
        continue;
      }
      prev.ms += draft.ms;
      prev.execs += draft.execs;
      prev.pct = null;
    }
    if (byLine.size === 0) return [];

    let sum = 0;
    for (const d of byLine.values()) sum += d.ms;
    const total = readTotalMs(profile) ?? sum;

    const ranked: ProfilerHotLine[] = [];
    for (const d of byLine.values()) {
      const pct =
        d.pct != null ? d.pct : total > 0 && d.ms > 0 ? (d.ms / total) * 100 : 0;
      ranked.push({ line: d.line, ms: d.ms, execs: d.execs, pct });
    }
    ranked.sort((a, b) => b.ms - a.ms || a.line - b.line);
    return ranked.slice(0, limit);
  } catch {
    return [];
  }
}

/** Count of usable line rows in `meta.profile` (before top-N). */
export function profileLineCount(meta: unknown): number {
  try {
    const profile = pickProfileBody(meta);
    if (!profile) return 0;
    const rows = pickRows(profile);
    if (!rows || rows.length === 0) return 0;
    const seen = new Set<number>();
    const max = Math.min(rows.length, 100_000);
    for (let i = 0; i < max; i += 1) {
      let row: unknown;
      try {
        row = rows[i];
      } catch {
        continue;
      }
      const draft = draftFromRow(row);
      if (draft) seen.add(draft.line);
    }
    return seen.size;
  } catch {
    return 0;
  }
}

/**
 * Compact phase list from `meta.profile.phases` (object of name → ms).
 * Returns undefined when missing / empty so the snapshot omits the field.
 */
export function pickPhases(meta: unknown): ProfilerPhase[] | undefined {
  try {
    const profile = pickProfileBody(meta);
    if (!profile) return undefined;
    let phases: unknown;
    try {
      phases = profile.phases;
    } catch {
      return undefined;
    }
    if (!isPlain(phases)) return undefined;
    const out: ProfilerPhase[] = [];
    // Object.keys may throw on hostile proxies — outer catch returns undefined.
    const keys = Object.keys(phases);
    for (const name of keys) {
      try {
        const ms = asFiniteNumber(phases[name]);
        if (ms == null || ms < 0) continue;
        const label = String(name).trim();
        if (!label) continue;
        out.push({ name: label, ms });
      } catch {
        // hostile phase entry
      }
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Build a snapshot from a run-shaped record. Returns null on unusable input. */
export function snapshotFromRun(record: unknown): ProfilerSnapshot | null {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const rec = record as ProfilerRunInput;
    const runId = asText(rec.id).trim();
    if (!runId) return null;
    const error = pickError(rec.error);
    const meta = rec.meta;
    const snapshot: ProfilerSnapshot = {
      runId,
      status: pickStatus(rec.status),
      ms: pickMs(meta),
      engineId: asText(rec.engineId),
      seriesKey: asText(rec.seriesKey),
      plotCount: countPlots(rec.plots),
      seriesCount: countSeries(rec.series),
      createdAt: pickCreatedAt(rec.createdAt, Date.now()),
      topLines: topHotLines(meta, DEFAULT_TOP_N),
      lineCount: profileLineCount(meta),
    };
    const phases = pickPhases(meta);
    if (phases) snapshot.phases = phases;
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
