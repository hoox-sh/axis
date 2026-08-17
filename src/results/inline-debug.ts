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
 * Collect **inline debug annotations** from a script run payload for the
 * CodeMirror editor (end-of-line chips + line highlights).
 *
 * Sources:
 * - Pine / engine `logs` with `line` / `lineno` / message line refs
 * - Top-level `error` / `message` with `line N` patterns
 * - Optional `diagnostics` / `meta.diagnostics` arrays
 *
 * @module results/inline-debug
 */

import { normalizePyneLogs, type PyneLogLevel } from './pyne-logs';
import { parseBarIndexFromText, parseTimeFromText, normalizePinTime } from './debug-pins';

export type InlineDebugLevel = PyneLogLevel | 'debug';

/** One inline annotation bound to a 1-based source line. */
export interface InlineDebugAnnotation {
  /** 1-based source line */
  line: number;
  level: InlineDebugLevel;
  message: string;
  barIndex?: number | null;
  /** Optional bar time (unix seconds or ms) when engine provided it */
  time?: number | null;
  /** Origin tag for tooltips */
  source?: 'log' | 'error' | 'diagnostic';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Parse a 1-based source line from free text / engine messages.
 * Examples: `line 12`, `Line:12`, `line #12`, `file:12:1`, `L12`, `L:12`,
 * `at 12`, `(line 12)`. Does not treat `RSI: 55` / `close: 14` as a line.
 */
export function parseSourceLine(text: string): number | null {
  if (!text) return null;
  const patterns = [
    /\bline\s*#?\s*[:=]?\s*(\d+)\b/i,
    /\bL:(\d+)\b/,
    /\bL(\d+)\b/,
    /:(\d+):\d+/, // file:line:col
    /\(line\s+(\d+)\)/i,
    /\bat\s+(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n < 1_000_000) return Math.trunc(n);
    }
  }
  return null;
}

/** True when an annotation can pin a chart bar (has bar_index and/or time). */
export function isPinableAnnotation(
  a: Pick<InlineDebugAnnotation, 'barIndex' | 'time'>,
): boolean {
  return a.barIndex != null || a.time != null;
}

/**
 * Annotations that can pin a chart bar (bar_index and/or time present).
 * Useful for editor pin gutters independent of severity chips.
 */
export function filterPinableAnnotations(
  anns: ReadonlyArray<InlineDebugAnnotation> | null | undefined,
): InlineDebugAnnotation[] {
  if (!anns?.length) return [];
  return anns.filter(isPinableAnnotation);
}

function lineFromRecord(item: Record<string, unknown>): number | null {
  const direct = asFiniteNumber(
    item.line ?? item.lineNumber ?? item.line_number ?? item.lineno ?? item.source_line ?? item.src_line,
  );
  if (direct != null && direct >= 1) return Math.trunc(direct);
  const msg = String(item.message ?? item.msg ?? item.text ?? item.error ?? '');
  return parseSourceLine(msg);
}

function levelFromPine(level: PyneLogLevel): InlineDebugLevel {
  return level;
}

/**
 * Build annotations from `store.lastRun` (or any engine-like payload).
 * Multiple messages on the same line are kept (editor shows the last / stacked).
 */
export function collectInlineDebugAnnotations(lastRun: unknown): InlineDebugAnnotation[] {
  if (lastRun == null) return [];
  const out: InlineDebugAnnotation[] = [];

  // ── Script logs ────────────────────────────────────────────────────
  const logs = normalizePyneLogs(lastRun);
  for (const e of logs) {
    const line =
      e.line != null && e.line >= 1 ? e.line : parseSourceLine(e.message);
    // barIndex-only logs belong in Scriptlogs, not inline chips
    if (line == null) continue;
    out.push({
      line,
      level: levelFromPine(e.level),
      message: e.message,
      barIndex: e.barIndex ?? parseBarIndexFromText(e.message),
      time: e.time ?? normalizePinTime(parseTimeFromText(e.message)),
      source: 'log',
    });
  }

  // Re-scan raw log objects for explicit line fields (normalize may drop them)
  if (isRecord(lastRun)) {
    const rawArrs: unknown[] = [];
    for (const key of ['logs', 'pine_logs', 'pineLogs', 'messages'] as const) {
      const v = lastRun[key];
      if (Array.isArray(v)) rawArrs.push(...v);
    }
    if (isRecord(lastRun.meta) && Array.isArray(lastRun.meta.logs)) {
      rawArrs.push(...(lastRun.meta.logs as unknown[]));
    }
    for (const item of rawArrs) {
      if (!isRecord(item)) continue;
      const line = lineFromRecord(item);
      if (line == null) continue;
      const message = String(item.message ?? item.msg ?? item.text ?? item.content ?? '');
      if (!message && item.level == null) continue;
      const lvlRaw = String(item.level ?? item.severity ?? 'info').toLowerCase();
      let level: InlineDebugLevel = 'info';
      if (lvlRaw.includes('err') || lvlRaw === 'fatal') level = 'error';
      else if (lvlRaw.includes('warn')) level = 'warning';
      else if (lvlRaw.includes('debug') || lvlRaw.includes('trace')) level = 'debug';
      // Avoid duplicates from normalize path
      if (out.some((a) => a.line === line && a.message === message)) continue;
      out.push({
        line,
        level,
        message: message || `(${level})`,
        barIndex:
          asFiniteNumber(item.barIndex ?? item.bar_index) ?? parseBarIndexFromText(message),
        time:
          asFiniteNumber(item.time ?? item.bar_time ?? item.barTime ?? item.ts) ??
          normalizePinTime(parseTimeFromText(message)),
        source: 'log',
      });
    }
  }

  // ── Top-level error / message ──────────────────────────────────────
  if (isRecord(lastRun)) {
    const errText = String(
      lastRun.error ?? lastRun.message ?? lastRun.err ?? lastRun.detail ?? '',
    ).trim();
    const status = String(lastRun.status ?? '').toLowerCase();
    if (errText && (status === 'error' || lastRun.error != null || /error|fail|exception/i.test(errText))) {
      const line = lineFromRecord(lastRun) ?? parseSourceLine(errText);
      if (line != null) {
        out.push({
          line,
          level: 'error',
          message: errText.slice(0, 240),
          source: 'error',
        });
      }
    }

    // diagnostics: [{ line, message, severity }]
    const diags = lastRun.diagnostics ?? (isRecord(lastRun.meta) ? lastRun.meta.diagnostics : null);
    if (Array.isArray(diags)) {
      for (const d of diags) {
        if (!isRecord(d)) continue;
        const line = lineFromRecord(d);
        if (line == null) continue;
        const message = String(d.message ?? d.msg ?? d.text ?? '');
        if (!message) continue;
        const sev = String(d.severity ?? d.level ?? 'info').toLowerCase();
        let level: InlineDebugLevel = 'info';
        if (sev.includes('err') || sev === 'fatal') level = 'error';
        else if (sev.includes('warn')) level = 'warning';
        else if (sev.includes('debug')) level = 'debug';
        out.push({ line, level, message, source: 'diagnostic' });
      }
    }
  }

  // Stable order: by line, then error first
  const rank = (l: InlineDebugLevel) =>
    l === 'error' ? 0 : l === 'warning' ? 1 : l === 'debug' ? 2 : 3;
  out.sort((a, b) => a.line - b.line || rank(a.level) - rank(b.level));
  return out;
}

/** One annotation per line (highest severity wins; messages joined). */
export function collapseAnnotationsByLine(
  anns: InlineDebugAnnotation[],
): InlineDebugAnnotation[] {
  const map = new Map<number, InlineDebugAnnotation>();
  const rank = (l: InlineDebugLevel) =>
    l === 'error' ? 0 : l === 'warning' ? 1 : l === 'debug' ? 2 : 3;
  for (const a of anns) {
    const prev = map.get(a.line);
    if (!prev) {
      map.set(a.line, { ...a });
      continue;
    }
    const better = rank(a.level) < rank(prev.level);
    const message =
      prev.message === a.message
        ? prev.message
        : `${prev.message} · ${a.message}`.slice(0, 280);
    map.set(a.line, {
      line: a.line,
      level: better ? a.level : prev.level,
      message,
      barIndex: a.barIndex ?? prev.barIndex,
      time: a.time ?? prev.time,
      source: better ? a.source : prev.source,
    });
  }
  return [...map.values()].sort((a, b) => a.line - b.line);
}
