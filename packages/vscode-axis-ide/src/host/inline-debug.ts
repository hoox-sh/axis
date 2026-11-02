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
 * End-of-line inline log / debug chips for a Pine run record.
 * Pure — no vscode. Never throws.
 *
 * Mirrors AXIS PWA `collectInlineDebugAnnotations` + chip truncation
 * (`src/results/inline-debug.ts`, `src/editor/inline-debug.ts`) without
 * importing them. One chip per source line; full text stays on `message`.
 */

export type InlineDebugLevel = 'error' | 'warning' | 'info' | 'debug';

export type InlineDebugSource = 'log' | 'error' | 'diagnostic';

/** One inline annotation bound to a 1-based source line. */
export interface InlineDebugAnnotation {
  /** 1-based source line */
  line: number;
  level: InlineDebugLevel;
  /** Full text for the hover. Chip rendering truncates separately. */
  message: string;
  source?: InlineDebugSource;
}

/** Max visible chip characters (including the ellipsis). */
export const INLINE_DEBUG_CHIP_MAX = 48;

/** Max chips stamped for one run (noisy logs must not cover every line). */
export const INLINE_DEBUG_MAX_ANNOTATIONS = 40;

/**
 * Bearer tokens, `api key` assignments, and `sk-` secrets.
 * Chip + hover must not echo these; the annotation `message` stays intact.
 */
const SECRET_TEXT =
  /bearer\s+\S{8,}|api[\s_-]?key\s*[:=]\s*\S{6,}|\bsk-[A-Za-z0-9]{8,}/i;

/** Hover / chip text. Original `message` is not modified. */
export function redactInlineDebugText(message: string): string {
  if (typeof message !== 'string' || message.length === 0) return '';
  if (SECRET_TEXT.test(message)) return '[redacted]';
  return message;
}

const LEVEL_RANK: Record<InlineDebugLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

const LINE_PATTERNS: readonly RegExp[] = [
  /\bline\s*#?\s*[:=]?\s*(\d+)\b/i,
  /\bL:(\d+)\b/,
  /\bL(\d+)\b/,
  /:(\d+):\d+/,
  /\(line\s+(\d+)\)/i,
  /\bat\s+(\d+)\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse a 1-based source line from free text.
 * Matches `line 12`, `Line:12`, `line #12`, `L12`, `L:12`, `file:12:1`,
 * `(line 12)`, `at 12`. Does not treat `RSI: 55` or `close: 14` as a line.
 */
export function parseSourceLine(text: string): number | null {
  if (!text) return null;
  for (const re of LINE_PATTERNS) {
    const match = re.exec(text);
    if (!match?.[1]) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n >= 1 && n < 1_000_000) return Math.trunc(n);
  }
  return null;
}

/**
 * Truncate a log / error chip. Collapses whitespace; ellipsizes past `maxLen`.
 * The annotation `message` is left intact for the hover.
 */
export function truncateInlineDebugChip(
  message: string,
  maxLen: number = INLINE_DEBUG_CHIP_MAX,
): string {
  const collapsed = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (maxLen <= 0 || collapsed.length <= maxLen) return collapsed;
  if (maxLen <= 1) return '…';
  return `${collapsed.slice(0, maxLen - 1)}…`;
}

function normalizeLevel(raw: unknown): InlineDebugLevel {
  if (typeof raw !== 'string') return 'info';
  const s = raw.trim().toLowerCase();
  if (!s) return 'info';
  if (s.includes('err') || s === 'fatal' || s === 'critical') return 'error';
  if (s.includes('warn')) return 'warning';
  if (s.includes('debug') || s.includes('trace')) return 'debug';
  return 'info';
}

function pickLine(value: unknown): number | null {
  let n: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) n = value;
  else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n == null) return null;
  const line = Math.trunc(n);
  if (line < 1 || line >= 1_000_000) return null;
  return line;
}

function explicitLine(item: Record<string, unknown>): number | null {
  for (const key of ['line', 'lineno', 'line_no'] as const) {
    const value = item[key];
    if (value == null || value === '') continue;
    const line = pickLine(value);
    if (line != null) return line;
  }
  return null;
}

function asMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

const LEVEL_PREFIX =
  /^(error|err|fatal|critical|warn(?:ing)?|debug|trace|info|log)\s*:\s*([\s\S]*)$/i;

function annotationFromString(
  text: string,
  source: InlineDebugSource,
): InlineDebugAnnotation | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let level: InlineDebugLevel = 'info';
  let body = trimmed;
  const prefixed = LEVEL_PREFIX.exec(trimmed);
  if (prefixed) {
    level = normalizeLevel(prefixed[1]);
    body = (prefixed[2] ?? '').trim();
  }
  if (!body) return null;
  const line = parseSourceLine(body);
  if (line == null) return null;
  return { line, level, message: body, source };
}

function annotationFromUnknown(
  item: unknown,
  source: InlineDebugSource,
): InlineDebugAnnotation | null {
  if (typeof item === 'string') return annotationFromString(item, source);
  if (!isRecord(item)) return null;
  const message = asMessage(item.message ?? item.msg ?? item.text).trim();
  if (!message) return null;
  const line = explicitLine(item) ?? parseSourceLine(message);
  if (line == null) return null;
  return {
    line,
    level: normalizeLevel(item.level ?? item.severity),
    message,
    source,
  };
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function readMetaArray(record: Record<string, unknown>, key: string): unknown[] {
  const meta = record.meta;
  if (!isRecord(meta)) return [];
  const value = meta[key];
  return Array.isArray(value) ? value : [];
}

function annotationFromError(record: Record<string, unknown>): InlineDebugAnnotation | null {
  if (typeof record.error !== 'string') return null;
  const message = record.error.trim();
  if (!message) return null;
  const line = parseSourceLine(message);
  if (line == null) return null;
  return { line, level: 'error', message, source: 'error' };
}

function take(
  read: () => unknown[],
  source: InlineDebugSource,
  out: InlineDebugAnnotation[],
): void {
  let items: unknown[] = [];
  let count = 0;
  try {
    items = read();
    count = items.length;
  } catch {
    return;
  }
  for (let i = 0; i < count; i++) {
    try {
      const ann = annotationFromUnknown(items[i], source);
      if (ann) out.push(ann);
    } catch {
      // One hostile log must not drop the rest of the run.
    }
  }
}

function takeError(record: Record<string, unknown>, out: InlineDebugAnnotation[]): void {
  try {
    const err = annotationFromError(record);
    if (err) out.push(err);
  } catch {
    // Hostile `error` getter — keep logs / diagnostics already collected.
  }
}

function collapse(anns: InlineDebugAnnotation[]): InlineDebugAnnotation[] {
  const byLine = new Map<number, InlineDebugAnnotation>();
  for (const ann of anns) {
    const prev = byLine.get(ann.line);
    if (!prev) {
      byLine.set(ann.line, { ...ann });
      continue;
    }
    const prevWins = LEVEL_RANK[prev.level] <= LEVEL_RANK[ann.level];
    const primary = prevWins ? prev : ann;
    const secondary = prevWins ? ann : prev;
    const message =
      secondary.message === primary.message
        ? primary.message
        : `${primary.message} · ${secondary.message}`;
    byLine.set(ann.line, {
      line: ann.line,
      level: primary.level,
      message,
      source: primary.source,
    });
  }
  const sorted = [...byLine.values()].sort((a, b) => a.line - b.line);
  if (sorted.length <= INLINE_DEBUG_MAX_ANNOTATIONS) return sorted;
  return sorted.slice(0, INLINE_DEBUG_MAX_ANNOTATIONS);
}

/**
 * Build at most {@link INLINE_DEBUG_MAX_ANNOTATIONS} chips from a run record.
 * Sources: `logs`, `meta.logs`, `diagnostics`, `meta.diagnostics`, `error`.
 * Empty / unusable input returns `[]`. Hostile getters are skipped, not thrown.
 */
export function collectInlineDebug(record: unknown): InlineDebugAnnotation[] {
  if (!isRecord(record)) return [];
  const out: InlineDebugAnnotation[] = [];
  take(() => readArray(record, 'logs'), 'log', out);
  take(() => readMetaArray(record, 'logs'), 'log', out);
  take(() => readArray(record, 'diagnostics'), 'diagnostic', out);
  take(() => readMetaArray(record, 'diagnostics'), 'diagnostic', out);
  takeError(record, out);
  return collapse(out);
}
