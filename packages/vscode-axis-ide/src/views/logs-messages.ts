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
 * Pure script-log model for the Logs panel.
 * Reads an unknown last-run record (logs / diagnostics may be absent).
 * Never throws.
 */

/** Hard cap so a hostile payload cannot flood the webview. */
export const LOG_ROW_CAP = 200;

export type LogLevel = 'error' | 'warning' | 'info' | 'debug';

export type LogFilter = LogLevel | 'all';

export type LogRow = {
  level: LogLevel;
  message: string;
  line: number | null;
  time: string | null;
};

export type LogsSetMessage = {
  type: 'logs.set';
  rows: LogRow[];
  runId: string | null;
  status: string | null;
};

export type LogsWebMessage =
  | { type: 'logs.ready' }
  | { type: 'logs.reveal'; line: number }
  | { type: 'logs.filter'; level: LogFilter };

const LEVEL_BY_NAME: Record<string, LogLevel> = {
  error: 'error',
  err: 'error',
  fatal: 'error',
  critical: 'error',
  warning: 'warning',
  warn: 'warning',
  info: 'info',
  log: 'info',
  information: 'info',
  debug: 'debug',
  trace: 'debug',
  hint: 'debug',
  '0': 'error',
  '1': 'warning',
  '2': 'info',
  '3': 'debug',
};

const LEVEL_NAMES = new Set(Object.keys(LEVEL_BY_NAME));

/** Same free-text shapes as PWA `parseSourceLine`. `RSI: 55` is not a line. */
const LINE_PATTERNS: readonly RegExp[] = [
  /\bline\s*#?\s*[:=]?\s*(\d+)\b/i,
  /\bL:(\d+)\b/,
  /\bL(\d+)\b/,
  /:(\d+):\d+/,
  /\(line\s+(\d+)\)/i,
  /\bat\s+(\d+)\b/i,
];

const LEVEL_PREFIX =
  /^(error|err|fatal|critical|warning|warn|info|log|information|debug|trace|hint)\s*:\s*([\s\S]*)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readProp(value: unknown, key: string): unknown {
  try {
    if (value == null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function safeLength(list: unknown[]): number {
  try {
    const len = list.length;
    if (typeof len !== 'number' || !Number.isFinite(len) || len <= 0) return 0;
    return Math.min(Math.trunc(len), LOG_ROW_CAP);
  } catch {
    return 0;
  }
}

function safeIndex(list: unknown[], index: number): unknown {
  try {
    return list[index];
  } catch {
    return undefined;
  }
}

/** Replace secret-looking tokens. The surrounding text stays. */
export function scrubLogMessage(message: string): string {
  return message
    .replace(/pyn_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/pn_[a-fA-F0-9]{20,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/g, 'Bearer [redacted]')
    .replace(/api_key(\s*[:=]\s*["']?)([^\s"',}]+)/gi, (_match, sep: string) => {
      return `api_key${sep}[redacted]`;
    });
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(values: readonly unknown[]): string | null {
  for (const value of values) {
    const text = textOf(value);
    if (text) return text;
  }
  return null;
}

function normalizeLevel(raw: unknown): LogLevel {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    if (n === 0) return 'error';
    if (n === 1) return 'warning';
    if (n === 2) return 'info';
    if (n >= 3) return 'debug';
    return 'info';
  }
  if (typeof raw !== 'string') return 'info';
  return LEVEL_BY_NAME[raw.trim().toLowerCase()] ?? 'info';
}

function levelNameOf(value: unknown): LogLevel | null {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeLevel(value);
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (!LEVEL_NAMES.has(key)) return null;
  return normalizeLevel(key);
}

/**
 * 1-based source line from free text.
 * Patterns: `line 12`, `Line:12`, `line #12`, `L12`, `L:12`, `file:12:1`,
 * `(line 12)`, `at 12`. Does not treat `RSI: 55` / `close: 14` as a line.
 */
export function parseLogLine(text: string): number | null {
  if (!text) return null;
  for (const pattern of LINE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n >= 1 && n < 1_000_000) return Math.trunc(n);
  }
  return null;
}

function lineFromValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value >= 1 && value < 1_000_000) return value;
    return null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (n >= 1 && n < 1_000_000) return n;
  }
  return null;
}

function timeFromValue(value: unknown): string | null {
  const text = textOf(value);
  if (!text) return null;
  return scrubLogMessage(text);
}

function rowFromString(text: string, forceError: boolean): LogRow | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const prefixed = LEVEL_PREFIX.exec(trimmed);
  let level: LogLevel = 'info';
  let body = trimmed;
  if (prefixed) {
    level = normalizeLevel(prefixed[1]);
    const rest = (prefixed[2] ?? '').trim();
    body = rest || trimmed;
  }
  return {
    level: forceError ? 'error' : level,
    message: scrubLogMessage(body),
    line: parseLogLine(trimmed),
    time: null,
  };
}

function rowFromObject(item: Record<string, unknown>, forceError: boolean): LogRow | null {
  const raw = firstText([
    readProp(item, 'message'),
    readProp(item, 'msg'),
    readProp(item, 'text'),
  ]);
  if (!raw) return null;
  const message = scrubLogMessage(raw);
  const line =
    lineFromValue(readProp(item, 'line')) ??
    lineFromValue(readProp(item, 'lineno')) ??
    lineFromValue(readProp(item, 'line_no')) ??
    parseLogLine(message);
  return {
    level: forceError ? 'error' : normalizeLevel(readProp(item, 'level') ?? readProp(item, 'severity')),
    message,
    line,
    time: timeFromValue(readProp(item, 'time')) ?? timeFromValue(readProp(item, 'ts')),
  };
}

function rowFromNonTuple(item: unknown, forceError: boolean): LogRow | null {
  if (typeof item === 'string') return rowFromString(item, forceError);
  if (typeof item === 'number' && Number.isFinite(item)) {
    return {
      level: forceError ? 'error' : 'info',
      message: scrubLogMessage(String(item)),
      line: null,
      time: null,
    };
  }
  if (isRecord(item)) return rowFromObject(item, forceError);
  return null;
}

function rowFromTuple(item: unknown[], forceError: boolean): LogRow | null {
  const count = safeLength(item);
  if (count === 0) return null;
  const first = safeIndex(item, 0);
  if (count === 1) return rowFromNonTuple(first, forceError);
  const second = safeIndex(item, 1);
  const named = levelNameOf(first);
  if (named) {
    const raw = textOf(second);
    if (!raw) return null;
    const message = scrubLogMessage(raw);
    const structured = count > 2 ? lineFromValue(safeIndex(item, 2)) : null;
    return {
      level: forceError ? 'error' : named,
      message,
      line: structured ?? parseLogLine(message),
      time: count > 3 ? timeFromValue(safeIndex(item, 3)) : null,
    };
  }
  const raw = textOf(first);
  if (!raw) return null;
  const message = scrubLogMessage(raw);
  const secondLevel = levelNameOf(second);
  return {
    level: forceError ? 'error' : secondLevel ?? 'info',
    message,
    line: parseLogLine(message),
    time: null,
  };
}

function rowFromItem(item: unknown, forceError: boolean): LogRow | null {
  if (typeof item === 'string') return rowFromString(item, forceError);
  if (typeof item === 'number' && Number.isFinite(item)) {
    return {
      level: forceError ? 'error' : 'info',
      message: scrubLogMessage(String(item)),
      line: null,
      time: null,
    };
  }
  if (Array.isArray(item)) return rowFromTuple(item, forceError);
  if (isRecord(item)) return rowFromObject(item, forceError);
  return null;
}

function pushFrom(value: unknown, out: LogRow[]): void {
  if (out.length >= LOG_ROW_CAP) return;
  if (typeof value === 'string' || isRecord(value)) {
    const row = rowFromItem(value, false);
    if (row) out.push(row);
    return;
  }
  if (!Array.isArray(value)) return;
  const count = safeLength(value);
  for (let i = 0; i < count && out.length < LOG_ROW_CAP; i++) {
    const row = rowFromItem(safeIndex(value, i), false);
    if (row) out.push(row);
  }
}

function errorRow(value: unknown): LogRow | null {
  return rowFromItem(value, true);
}

/**
 * Log rows from an unknown run record.
 * Sources, in order: `logs`, `meta.logs`, `diagnostics`, `meta.diagnostics`,
 * then a single `error` row. Items are strings, tuples, or
 * `{ level|severity, message|msg|text, line|lineno|line_no, time|ts }`.
 * At most {@link LOG_ROW_CAP} rows. Never throws.
 */
export function logsFromRun(record: unknown): LogRow[] {
  const out: LogRow[] = [];
  pushFrom(readProp(record, 'logs'), out);
  const meta = readProp(record, 'meta');
  pushFrom(readProp(meta, 'logs'), out);
  pushFrom(readProp(record, 'diagnostics'), out);
  pushFrom(readProp(meta, 'diagnostics'), out);
  if (out.length < LOG_ROW_CAP) {
    const row = errorRow(readProp(record, 'error'));
    if (row) out.push(row);
  }
  return out;
}

function normalizeFilter(level: unknown): LogFilter | null {
  if (level == null) return 'all';
  if (typeof level !== 'string') return null;
  const key = level.trim().toLowerCase();
  if (key === '') return 'all';
  if (key === 'all' || key === 'error' || key === 'warning' || key === 'info' || key === 'debug') {
    return key;
  }
  return null;
}

function coerceExistingRow(value: unknown): LogRow | null {
  if (!isRecord(value)) return null;
  const level = readProp(value, 'level');
  if (level !== 'error' && level !== 'warning' && level !== 'info' && level !== 'debug') return null;
  const message = readProp(value, 'message');
  if (typeof message !== 'string') return null;
  const line = lineFromValue(readProp(value, 'line'));
  const timeRaw = readProp(value, 'time');
  return {
    level,
    message,
    line,
    time: typeof timeRaw === 'string' ? timeRaw : null,
  };
}

/** Keep rows of one level, or every row when `level` is `'all'`. Caps at 200. */
export function filterLogs(rows: unknown, level: unknown): LogRow[] {
  const key = normalizeFilter(level);
  if (key == null) return [];
  if (!Array.isArray(rows)) return [];
  const count = safeLength(rows);
  const out: LogRow[] = [];
  for (let i = 0; i < count; i++) {
    const row = coerceExistingRow(safeIndex(rows, i));
    if (!row) continue;
    if (key === 'all' || row.level === key) out.push(row);
  }
  return out;
}

function readRunId(record: unknown): string | null {
  return textOf(readProp(record, 'id')) ?? textOf(readProp(record, 'runId'));
}

function readStatus(record: unknown): string | null {
  const status = readProp(record, 'status');
  if (typeof status !== 'string') return null;
  const trimmed = status.trim();
  return trimmed ? trimmed : null;
}

/** Host → webview `logs.set`. */
export function encodeLogsSet(record: unknown): LogsSetMessage {
  return {
    type: 'logs.set',
    rows: logsFromRun(record),
    runId: readRunId(record),
    status: readStatus(record),
  };
}

function messageBag(raw: Record<string, unknown>): Record<string, unknown> {
  const payload = readProp(raw, 'payload');
  return isRecord(payload) ? payload : raw;
}

/** Webview → host. `logs.filter` is optional; the view filters locally. */
export function parseLogsWebMessage(raw: unknown): LogsWebMessage | null {
  if (!isRecord(raw)) return null;
  const type = readProp(raw, 'type');
  if (type === 'logs.ready') return { type: 'logs.ready' };
  const bag = messageBag(raw);
  if (type === 'logs.reveal') {
    const line = lineFromValue(readProp(bag, 'line'));
    if (line == null) return null;
    return { type: 'logs.reveal', line };
  }
  if (type === 'logs.filter') {
    const level = normalizeFilter(readProp(bag, 'level'));
    if (level == null) return null;
    return { type: 'logs.filter', level };
  }
  return null;
}

/** Current last run, or null. Never throws. */
export function readLastRun(store: unknown): unknown {
  if (!isRecord(store)) return null;
  const fn = readProp(store, 'getLastRun');
  if (typeof fn !== 'function') return null;
  try {
    return fn.call(store);
  } catch {
    return null;
  }
}

function recordFromResultsSnapshot(snapshot: unknown, store: unknown): unknown {
  if (!isRecord(snapshot)) return readLastRun(store);
  let owns = false;
  try {
    owns = Object.prototype.hasOwnProperty.call(snapshot, 'lastRun');
  } catch {
    return readLastRun(store);
  }
  if (!owns) return readLastRun(store);
  const last = readProp(snapshot, 'lastRun');
  return last ?? null;
}

/**
 * Subscribe like `attachProfiler`: read `getLastRun` immediately, then each
 * results snapshot's `lastRun`. Returns an unsubscribe. Never throws.
 */
export function attachLogsStore(
  store: unknown,
  onRecord: (record: unknown) => void,
): () => void {
  const noop = (): void => {};
  if (typeof onRecord !== 'function') return noop;
  try {
    onRecord(readLastRun(store));
  } catch {
    // listener failed; still try to subscribe
  }
  if (!isRecord(store)) return noop;
  const subscribe = readProp(store, 'subscribe');
  if (typeof subscribe !== 'function') return noop;
  let unsub: unknown;
  try {
    unsub = subscribe.call(store, (snapshot: unknown) => {
      try {
        onRecord(recordFromResultsSnapshot(snapshot, store));
      } catch {
        // hostile listener
      }
    });
  } catch {
    return noop;
  }
  if (typeof unsub !== 'function') return noop;
  return () => {
    try {
      unsub();
    } catch {
      // hostile unsubscribe
    }
  };
}
