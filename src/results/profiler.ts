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
 * Run-profile types + helpers for the Pine editor Profiler gutter.
 *
 * Accepts loose API / runtime shapes and normalizes into {@link RunProfile}
 * with per-line ms, exec counts, and % of total. Used by
 * `editor/profiler-gutter` (CodeMirror markers) and Results wiring.
 *
 * ## Public API
 *
 * - {@link RunProfile}, {@link ProfileLineStat}
 * - {@link normalizeRunProfile}
 * - {@link profileLineMap}
 *
 * @module results/profiler
 */

/** Per-line timing / exec stats (1-based line numbers). */
export interface ProfileLineStat {
  /** 1-based source line */
  line: number;
  /** Cumulative time spent on this line (milliseconds) */
  ms: number;
  /** How many times this line executed */
  execs: number;
  /** Share of total profile time (0–100). Filled by normalize when missing. */
  pct: number;
}

/**
 * Full profiler snapshot for one script run.
 *
 * `lines` may be sparse (only hot / instrumented lines) or empty when the
 * engine only reports phase / total timings (current pyne default).
 */
export interface RunProfile {
  /** Wall or cumulative total ms for the run (optional; derived from lines when absent). */
  totalMs?: number;
  /** Bars evaluated (engine profile.bars when present). */
  bars?: number;
  /** Engine mode (interpret / compile / auto). */
  mode?: string;
  /** Phase timings from engine (parse_ms / eval_ms, etc.). */
  phases?: Record<string, number>;
  /** Per-line stats */
  lines: ProfileLineStat[];
  /** Optional engine / run id for correlation */
  runId?: string;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asLineNumber(v: unknown): number | null {
  const n = asFiniteNumber(v);
  if (n == null) return null;
  const line = Math.trunc(n);
  return line >= 1 ? line : null;
}

/**
 * Normalize a loose runtime / API payload into a {@link RunProfile}.
 *
 * Accepts shapes like:
 * - `{ lines: [{ line, ms, execs, pct? }], totalMs? }`
 * - `{ total_ms, bars, mode, phases, lines: [] }` (pyne phase profile)
 * - `{ profile: { … } }` / `{ meta: { profile } }`
 * - `{ line_stats: [{ line_no / lineno / line, time_ms / ms / time, count / execs }] }`
 * - `Array<line stat>`
 *
 * Returns `null` when neither line data nor total/phase timing is present.
 */
export function normalizeRunProfile(raw: unknown, fallbackTotalMs?: number): RunProfile | null {
  if (raw == null) {
    if (fallbackTotalMs != null && Number.isFinite(fallbackTotalMs) && fallbackTotalMs >= 0) {
      return { totalMs: fallbackTotalMs, lines: [] };
    }
    return null;
  }

  let body: unknown = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (o.profile != null && typeof o.profile === 'object') body = o.profile;
    else if (o.runProfile != null && typeof o.runProfile === 'object') body = o.runProfile;
    else if (
      o.meta != null &&
      typeof o.meta === 'object' &&
      !Array.isArray(o.meta) &&
      (o.meta as Record<string, unknown>).profile != null &&
      typeof (o.meta as Record<string, unknown>).profile === 'object'
    ) {
      body = (o.meta as Record<string, unknown>).profile;
    }
  }

  let totalMs: number | undefined;
  let runId: string | undefined;
  let bars: number | undefined;
  let mode: string | undefined;
  let phases: Record<string, number> | undefined;
  let lineRows: unknown[] = [];

  if (Array.isArray(body)) {
    lineRows = body;
  } else if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const t = asFiniteNumber(o.totalMs ?? o.total_ms ?? o.totalTimeMs ?? o.total_time_ms);
    if (t != null && t >= 0) totalMs = t;
    if (typeof o.runId === 'string') runId = o.runId;
    else if (typeof o.run_id === 'string') runId = o.run_id;
    const b = asFiniteNumber(o.bars ?? o.bar_count ?? o.count);
    if (b != null && b >= 0) bars = Math.trunc(b);
    if (typeof o.mode === 'string') mode = o.mode;

    const ph = o.phases;
    if (ph && typeof ph === 'object' && !Array.isArray(ph)) {
      phases = {};
      for (const [k, v] of Object.entries(ph as Record<string, unknown>)) {
        const n = asFiniteNumber(v);
        if (n != null) phases[k] = n;
        // accept parse_ms style keys as-is
      }
      // also promote common snake aliases into camel if only snake present
      const parseMs = asFiniteNumber(
        (ph as Record<string, unknown>).parse_ms ?? (ph as Record<string, unknown>).parseMs,
      );
      const evalMs = asFiniteNumber(
        (ph as Record<string, unknown>).eval_ms ?? (ph as Record<string, unknown>).evalMs,
      );
      if (parseMs != null) phases.parse_ms = parseMs;
      if (evalMs != null) phases.eval_ms = evalMs;
      if (!Object.keys(phases).length) phases = undefined;
    }

    const candidates = [o.lines, o.line_stats, o.lineStats, o.stats, o.by_line, o.byLine];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        lineRows = c;
        break;
      }
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        // Map form: { "12": { ms, execs }, … } or { "12": ms }
        lineRows = Object.entries(c as Record<string, unknown>).map(([k, v]) => {
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            return { line: Number(k), ...(v as object) };
          }
          return { line: Number(k), ms: v };
        });
        break;
      }
    }
  } else {
    return null;
  }

  const byLine = new Map<number, { ms: number; execs: number; pct?: number }>();

  for (const row of lineRows) {
    if (row == null) continue;
    // Tuple form: [line, ms, execs?]
    if (Array.isArray(row)) {
      const line = asLineNumber(row[0]);
      if (line == null) continue;
      const ms = asFiniteNumber(row[1]) ?? 0;
      const execs = asFiniteNumber(row[2]) ?? 0;
      const prev = byLine.get(line);
      if (prev) {
        prev.ms += Math.max(0, ms);
        prev.execs += Math.max(0, Math.trunc(execs));
      } else {
        byLine.set(line, { ms: Math.max(0, ms), execs: Math.max(0, Math.trunc(execs)) });
      }
      continue;
    }
    if (typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const line = asLineNumber(r.line ?? r.line_no ?? r.lineNo ?? r.lineno ?? r.ln);
    if (line == null) continue;

    const ms =
      asFiniteNumber(r.ms ?? r.time_ms ?? r.timeMs ?? r.time ?? r.elapsed_ms ?? r.elapsedMs) ?? 0;
    const execs =
      asFiniteNumber(
        r.execs ?? r.executions ?? r.count ?? r.calls ?? r.n ?? r.exec_count ?? r.execCount,
      ) ?? 0;
    const pctRaw = asFiniteNumber(r.pct ?? r.percent ?? r.percentage ?? r.pct_of_total);

    const prev = byLine.get(line);
    if (prev) {
      prev.ms += Math.max(0, ms);
      prev.execs += Math.max(0, Math.trunc(execs));
      if (pctRaw != null && prev.pct == null) prev.pct = pctRaw;
    } else {
      byLine.set(line, {
        ms: Math.max(0, ms),
        execs: Math.max(0, Math.trunc(execs)),
        pct: pctRaw != null ? pctRaw : undefined,
      });
    }
  }

  let sumMs = 0;
  for (const s of byLine.values()) sumMs += s.ms;
  const denom = totalMs != null && totalMs > 0 ? totalMs : sumMs > 0 ? sumMs : 0;

  const lines: ProfileLineStat[] = [];
  for (const [line, s] of byLine) {
    let pct: number;
    if (s.pct != null) {
      // Accept fraction (0–1) or percent (0–100)
      pct = s.pct >= 0 && s.pct <= 1 ? s.pct * 100 : s.pct;
    } else {
      pct = denom > 0 ? (s.ms / denom) * 100 : 0;
    }
    lines.push({
      line,
      ms: s.ms,
      execs: s.execs,
      pct: Math.max(0, pct),
    });
  }

  lines.sort((a, b) => a.line - b.line);

  const resolvedTotal =
    totalMs ??
    (sumMs > 0 ? sumMs : undefined) ??
    (fallbackTotalMs != null && Number.isFinite(fallbackTotalMs) && fallbackTotalMs >= 0
      ? fallbackTotalMs
      : undefined);

  // Phase-only profiles (empty lines) are still useful for the editor chip
  if (lines.length === 0 && resolvedTotal == null && !phases && bars == null) {
    return null;
  }

  return {
    totalMs: resolvedTotal,
    bars,
    mode,
    phases,
    lines,
    runId,
  };
}

/**
 * Map 1-based line number → {@link ProfileLineStat} for gutter lookups.
 * Empty map when profile is null or has no lines.
 */
export function profileLineMap(profile: RunProfile | null | undefined): Map<number, ProfileLineStat> {
  const map = new Map<number, ProfileLineStat>();
  if (!profile?.lines?.length) return map;
  for (const row of profile.lines) {
    if (!row || row.line < 1) continue;
    const prev = map.get(row.line);
    if (prev) {
      map.set(row.line, {
        line: row.line,
        ms: prev.ms + row.ms,
        execs: prev.execs + row.execs,
        pct: prev.pct + row.pct,
      });
    } else {
      map.set(row.line, { ...row });
    }
  }
  return map;
}
