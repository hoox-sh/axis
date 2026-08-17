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
 * Pine Logs helpers — normalize engine log payloads into a stable
 * {@link PyneLogEntry} list, filter by level, and export TSV for clipboard.
 *
 * Accepts top-level `logs`, `meta.logs`, arrays of `[level, msg]` tuples, or
 * `{ level, message }` objects (plus common snake_case aliases).
 *
 * @module results/pyne-logs
 */

export type PyneLogLevel = 'info' | 'warning' | 'error';

export interface PyneLogEntry {
  id: string;
  level: PyneLogLevel;
  message: string;
  /** Optional 1-based source line if the engine provided it */
  line?: number | null;
  /** Optional bar index if engine provided it */
  barIndex?: number | null;
  /** Optional bar time ms if engine provided it */
  time?: number | null;
}

const LEVELS: readonly PyneLogLevel[] = ['info', 'warning', 'error'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeLevel(raw: unknown): PyneLogLevel {
  if (raw == null) return 'info';
  const s = String(raw).trim().toLowerCase();
  if (s === 'warn' || s === 'warning') return 'warning';
  if (s === 'error' || s === 'err' || s === 'fatal' || s === 'critical') return 'error';
  if (s === 'info' || s === 'log' || s === 'debug' || s === 'trace') return 'info';
  // numeric severities (common in some runtimes)
  if (s === '2' || s === '3') return 'error';
  if (s === '1') return 'warning';
  return 'info';
}

function asFiniteNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asMessage(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Pull a log array from various engine payload shapes. */
function extractLogArray(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (!isRecord(raw)) return [];

  // Direct fields
  for (const key of ['logs', 'pine_logs', 'pineLogs', 'messages'] as const) {
    const v = raw[key];
    if (Array.isArray(v)) return v;
  }

  // Nested under meta
  const meta = raw.meta;
  if (isRecord(meta)) {
    for (const key of ['logs', 'pine_logs', 'pineLogs', 'messages'] as const) {
      const v = meta[key];
      if (Array.isArray(v)) return v;
    }
  }

  // result.logs / data.logs
  for (const nest of ['result', 'data'] as const) {
    const inner = raw[nest];
    if (isRecord(inner)) {
      for (const key of ['logs', 'pine_logs', 'pineLogs'] as const) {
        const v = inner[key];
        if (Array.isArray(v)) return v;
      }
      if (isRecord(inner.meta)) {
        const v = inner.meta.logs;
        if (Array.isArray(v)) return v;
      }
    }
  }

  return [];
}

function entryFromObject(item: Record<string, unknown>, index: number): PyneLogEntry | null {
  const message = asMessage(
    item.message ?? item.msg ?? item.text ?? item.content ?? item.body ?? '',
  );
  // Skip completely empty objects with no message-ish field
  const hasLevel = item.level != null || item.severity != null || item.type != null;
  if (!message && !hasLevel) return null;

  const level = normalizeLevel(item.level ?? item.severity ?? item.type);
  const line = asFiniteNumber(
    item.line ?? item.lineNumber ?? item.line_number ?? item.lineno ?? item.source_line,
  );
  const barIndex = asFiniteNumber(
    item.barIndex ?? item.bar_index ?? item.bar ?? item.index,
  );
  const time = asFiniteNumber(item.time ?? item.bar_time ?? item.barTime ?? item.ts);
  const idRaw = item.id ?? item.uid ?? item.key;
  const id = idRaw != null && String(idRaw).length > 0 ? String(idRaw) : `log-${index}`;

  return {
    id,
    level,
    message,
    line: line != null && line >= 1 ? Math.trunc(line) : null,
    barIndex,
    time,
  };
}

function entryFromTuple(item: unknown[], index: number): PyneLogEntry | null {
  if (item.length === 0) return null;
  // [level, message] or [level, message, barIndex] or [level, message, barIndex, time]
  // Also tolerate [message] only
  if (item.length === 1) {
    const message = asMessage(item[0]);
    if (!message) return null;
    return { id: `log-${index}`, level: 'info', message, barIndex: null, time: null };
  }

  const first = item[0];
  const second = item[1];
  // Heuristic: if first looks like a level, treat as [level, msg, ...]
  const firstStr = first == null ? '' : String(first).trim().toLowerCase();
  const looksLikeLevel =
    LEVELS.includes(firstStr as PyneLogLevel) ||
    firstStr === 'warn' ||
    firstStr === 'err' ||
    firstStr === 'log' ||
    firstStr === 'debug' ||
    firstStr === 'fatal' ||
    firstStr === 'critical' ||
    firstStr === '0' ||
    firstStr === '1' ||
    firstStr === '2' ||
    firstStr === '3';

  if (looksLikeLevel) {
    return {
      id: `log-${index}`,
      level: normalizeLevel(first),
      message: asMessage(second),
      barIndex: asFiniteNumber(item[2]),
      time: asFiniteNumber(item[3]),
    };
  }

  // [message, level] swap, or bare message-first
  return {
    id: `log-${index}`,
    level: normalizeLevel(second),
    message: asMessage(first),
    barIndex: asFiniteNumber(item[2]),
    time: asFiniteNumber(item[3]),
  };
}

function entryFromPrimitive(item: unknown, index: number): PyneLogEntry | null {
  if (item == null) return null;
  if (typeof item === 'string') {
    const message = item.trim();
    if (!message) return null;
    // Optional "level: message" prefix
    const m = /^(info|warn(?:ing)?|error|err|debug|log)\s*:\s*(.*)$/i.exec(message);
    if (m) {
      return {
        id: `log-${index}`,
        level: normalizeLevel(m[1]),
        message: m[2] ?? '',
        barIndex: null,
        time: null,
      };
    }
    return { id: `log-${index}`, level: 'info', message, barIndex: null, time: null };
  }
  if (typeof item === 'number' || typeof item === 'boolean') {
    return {
      id: `log-${index}`,
      level: 'info',
      message: String(item),
      barIndex: null,
      time: null,
    };
  }
  return null;
}

/**
 * Accept engine payload shapes: top-level logs, meta.logs, arrays of
 * `[level, msg]` tuples, or `{ level, message }` objects.
 */
export function normalizePyneLogs(raw: unknown): PyneLogEntry[] {
  const arr = extractLogArray(raw);
  if (!arr.length) return [];

  const out: PyneLogEntry[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    let entry: PyneLogEntry | null = null;
    if (Array.isArray(item)) {
      entry = entryFromTuple(item, i);
    } else if (isRecord(item)) {
      entry = entryFromObject(item, i);
    } else {
      entry = entryFromPrimitive(item, i);
    }
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * Filter by level set; empty set or `'all'` means no filter.
 */
export function filterPyneLogs(
  entries: PyneLogEntry[],
  levels: Set<PyneLogLevel> | 'all',
): PyneLogEntry[] {
  if (!entries?.length) return [];
  if (levels === 'all') return entries.slice();
  if (!(levels instanceof Set) || levels.size === 0) return entries.slice();
  return entries.filter((e) => levels.has(e.level));
}

/**
 * TSV/text export for clipboard.
 * Columns: level, message, barIndex, time
 */
export function pyneLogsToText(entries: PyneLogEntry[]): string {
  if (!entries?.length) return '';
  const lines = ['level\tmessage\tbarIndex\ttime'];
  for (const e of entries) {
    const msg = String(e.message ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
    const bi = e.barIndex == null ? '' : String(e.barIndex);
    const t = e.time == null ? '' : String(e.time);
    lines.push(`${e.level}\t${msg}\t${bi}\t${t}`);
  }
  return lines.join('\n');
}
