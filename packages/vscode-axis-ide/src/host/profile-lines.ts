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
 * Per-line profiler normalizer for the Pine editor.
 * Pure — no vscode import. Never throws. Hostile getters are skipped.
 *
 * Accepts loose run records (`meta.profile`, `meta.runProfile`, `profile`)
 * and engine shapes (`lines`, `line_stats`, pyne `{ total_ms, phases, lines }`).
 * An empty `lines` array is a valid phase-only profile: callers get `[]`
 * and no invented percents.
 */

/** Per-line timing (1-based source line). */
export interface ProfileLineStat {
  line: number;
  ms: number;
  execs: number;
  pct: number;
}

/** Cap so a hostile `length` cannot pin the extension host. */
const MAX_PROFILE_LINES = 100_000;

const LINE_KEYS = ['line', 'line_no', 'lineno'] as const;
const MS_KEYS = ['ms', 'time_ms', 'time'] as const;
const EXEC_KEYS = ['execs', 'count'] as const;
const TOTAL_KEYS = ['totalMs', 'total_ms'] as const;
const NEST_KEYS = ['profile', 'runProfile'] as const;
const ROW_KEYS = ['lines', 'line_stats'] as const;

interface LineDraft {
  line: number;
  ms: number;
  execs: number;
  pct: number | null;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function prop(obj: object, key: string): unknown {
  return (obj as Record<string, unknown>)[key];
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

function asLineNumber(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null) return null;
  const line = Math.trunc(n);
  return line >= 1 ? line : null;
}

function looksLikeProfile(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (!isPlain(value)) return false;
  try {
    return (
      'lines' in value ||
      'line_stats' in value ||
      'totalMs' in value ||
      'total_ms' in value ||
      'phases' in value
    );
  } catch {
    return false;
  }
}

/** `meta.profile` / `meta.runProfile` / `profile` / `runProfile`, else the record. */
function unwrapProfile(raw: unknown): unknown {
  if (!isPlain(raw)) return raw;
  let meta: unknown;
  try {
    meta = prop(raw, 'meta');
  } catch {
    meta = undefined;
  }
  if (isPlain(meta)) {
    for (const key of NEST_KEYS) {
      try {
        const nested = prop(meta, key);
        if (looksLikeProfile(nested)) return nested;
      } catch {
        // hostile nested profile — try the next source
      }
    }
  }
  for (const key of NEST_KEYS) {
    try {
      const nested = prop(raw, key);
      if (looksLikeProfile(nested)) return nested;
    } catch {
      // hostile profile — try the next source
    }
  }
  return raw;
}

function pickRows(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!isPlain(body)) return null;
  for (const key of ROW_KEYS) {
    try {
      const rows = prop(body, key);
      if (Array.isArray(rows)) return rows;
    } catch {
      // hostile collection — try the next key
    }
  }
  return null;
}

function readTotal(body: unknown): number | null {
  if (!isPlain(body)) return null;
  for (const key of TOTAL_KEYS) {
    try {
      const n = asFiniteNumber(prop(body, key));
      if (n != null && n >= 0) return n;
    } catch {
      // hostile total — try the other alias
    }
  }
  return null;
}

function firstLine(row: object): number | null {
  for (const key of LINE_KEYS) {
    try {
      const line = asLineNumber(prop(row, key));
      if (line != null) return line;
    } catch {
      // hostile getter — try the next alias
    }
  }
  return null;
}

/** First finite alias that is >= 0. Null when every alias is missing or hostile. */
function firstNonNegative(row: object, keys: readonly string[]): number | null {
  for (const key of keys) {
    try {
      const n = asFiniteNumber(prop(row, key));
      if (n != null && n >= 0) return n;
    } catch {
      // hostile getter — try the next alias
    }
  }
  return null;
}

function readPct(row: object): number | null {
  try {
    const n = asFiniteNumber(prop(row, 'pct'));
    if (n != null && n >= 0) return n;
  } catch {
    return null;
  }
  return null;
}

function draftFromRow(row: unknown): LineDraft | null {
  if (!isPlain(row)) return null;
  const line = firstLine(row);
  if (line == null) return null;
  const ms = firstNonNegative(row, MS_KEYS) ?? 0;
  const execs = firstNonNegative(row, EXEC_KEYS) ?? 0;
  return {
    line,
    ms,
    execs: Math.trunc(execs),
    pct: readPct(row),
  };
}

function eachRow(rows: unknown[], visit: (row: unknown) => void): void {
  let count = 0;
  try {
    const len = rows.length;
    if (typeof len !== 'number' || !Number.isInteger(len) || len < 0) return;
    count = Math.min(len, MAX_PROFILE_LINES);
  } catch {
    return;
  }
  for (let i = 0; i < count; i++) {
    try {
      visit(rows[i]);
    } catch {
      // hostile index — skip
    }
  }
}

function fillPct(ms: number, pct: number | null, total: number): number {
  if (pct != null) return pct;
  if (!(total > 0) || !(ms > 0)) return 0;
  return (ms / total) * 100;
}

/**
 * Normalize a run record or profile payload into per-line stats.
 * Sorted by line. Empty / phase-only input returns `[]` (no invented rows).
 */
export function normalizeProfileLines(raw: unknown): ProfileLineStat[] {
  const body = unwrapProfile(raw);
  const rows = pickRows(body);
  if (!rows) return [];
  const byLine = new Map<number, LineDraft>();
  eachRow(rows, (row) => {
    const draft = draftFromRow(row);
    if (!draft) return;
    const prev = byLine.get(draft.line);
    if (!prev) {
      byLine.set(draft.line, draft);
      return;
    }
    prev.ms += draft.ms;
    prev.execs += draft.execs;
    prev.pct = null;
  });
  let sum = 0;
  for (const draft of byLine.values()) sum += draft.ms;
  const explicit = readTotal(body);
  const total = explicit != null ? explicit : sum;
  const stats: ProfileLineStat[] = [];
  for (const draft of byLine.values()) {
    stats.push({
      line: draft.line,
      ms: draft.ms,
      execs: draft.execs,
      pct: fillPct(draft.ms, draft.pct, total),
    });
  }
  stats.sort((a, b) => a.line - b.line);
  return stats;
}

/** Compact percent chip: `0%`, `<0.1%`, one decimal under 10, else a rounded integer. */
export function formatPct(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  if (pct < 10) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

const EMPTY_TOOLTIP = 'Line 0 · 0.0 ms · 0 execs · 0% of script body';

/** `Line N · X.X ms · Y execs · Z% of script body` (Z from {@link formatPct}). */
export function profileLineTooltip(stat: ProfileLineStat): string {
  try {
    const line = Number.isFinite(stat.line) ? Math.trunc(stat.line) : 0;
    const ms = Number.isFinite(stat.ms) ? stat.ms : 0;
    const execs = Number.isFinite(stat.execs) ? Math.trunc(stat.execs) : 0;
    return `Line ${line} · ${ms.toFixed(1)} ms · ${execs} execs · ${formatPct(stat.pct)} of script body`;
  } catch {
    return EMPTY_TOOLTIP;
  }
}

/**
 * Line numbers of the hottest rows: top 3 by `ms` among lines with `ms > 0`.
 * Ties break toward the smaller line number. Empty input returns `[]`.
 */
export function hotProfileLineNumbers(lines: readonly ProfileLineStat[]): number[] {
  if (!Array.isArray(lines)) return [];
  const ranked: { line: number; ms: number }[] = [];
  let count = 0;
  try {
    const len = lines.length;
    if (typeof len !== 'number' || !Number.isInteger(len) || len < 0) return [];
    count = Math.min(len, MAX_PROFILE_LINES);
  } catch {
    return [];
  }
  for (let i = 0; i < count; i++) {
    try {
      const row = lines[i];
      if (row == null || typeof row !== 'object') continue;
      const ms = row.ms;
      const line = row.line;
      if (typeof ms !== 'number' || !(ms > 0)) continue;
      if (typeof line !== 'number' || !Number.isFinite(line) || line < 1) continue;
      ranked.push({ line: Math.trunc(line), ms });
    } catch {
      // hostile element — skip
    }
  }
  ranked.sort((a, b) => b.ms - a.ms || a.line - b.line);
  const hot: number[] = [];
  const limit = Math.min(3, ranked.length);
  for (let i = 0; i < limit; i++) hot.push(ranked[i].line);
  return hot;
}
