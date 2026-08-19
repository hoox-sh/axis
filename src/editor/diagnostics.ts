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
 * Run-error / diagnostic reporting for the Pine CodeMirror editor.
 *
 * Parses engine payloads into {@link EditorDiagnostic}s and surfaces them with
 * underlines, gutter markers, and hover tooltips (no `@codemirror/lint` —
 * decorations + gutter, same pattern as inline-debug).
 *
 * @module editor/diagnostics
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
  hoverTooltip,
  type Tooltip,
} from '@codemirror/view';
import {
  StateField,
  StateEffect,
  RangeSetBuilder,
  Prec,
  type Extension,
  type Transaction,
  type Text,
} from '@codemirror/state';
import { parseSourceLine } from '../results/inline-debug';
import { normalizePyneLogs } from '../results/pyne-logs';
import { store } from '../store';
import { intelShowsSeverity, readEditorIntel } from './editor-intel';

function diagIntel() {
  return readEditorIntel(store.editorIntel);
}

/**
 * Diagnostic severity (IDE-style).
 * - `error` — blocks Run (syntax / hard failures)
 * - `warning` — style / deprecation
 * - `typo` — unknown builtin member; non-blocking (engine may autocorrect)
 * - `info` — soft notes
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'typo' | 'info';

/**
 * One diagnostic bound to a CM document range.
 * `line` is 1-based; `from`/`to` are absolute document offsets.
 */
export interface EditorDiagnostic {
  from: number;
  to: number;
  /** 1-based source line */
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  /** Origin tag for tooltips / filtering */
  source?: string;
}

// ── Pure helpers (tested without CM) ─────────────────────────────────────────

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
 * Parse a 1-based source line from free text / engine messages / stack traces.
 *
 * Supports: `line 12:`, `line:12`, `at line 12`, `L12:`, `File "...", line 12`,
 * plus patterns from {@link parseSourceLine}.
 */
export function parseDiagnosticLine(text: string): number | null {
  if (!text) return null;
  const extra: RegExp[] = [
    /\bat\s+line\s+(\d+)\b/i,
    /\bL(\d+)\s*:/,
    /File\s+"[^"]*",\s*line\s+(\d+)/i,
    /,\s*line\s+(\d+)\b/i,
    /\bline\s+(\d+)\s*:/i,
  ];
  for (const re of extra) {
    const m = re.exec(text);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n < 1_000_000) return Math.trunc(n);
    }
  }
  return parseSourceLine(text);
}

/** Line field from a structured diagnostic / log record. */
export function lineFromDiagnosticRecord(item: Record<string, unknown>): number | null {
  const direct = asFiniteNumber(
    item.line ??
      item.lineNumber ??
      item.line_number ??
      item.lineno ??
      item.source_line ??
      item.src_line ??
      item.row,
  );
  if (direct != null && direct >= 1) return Math.trunc(direct);
  const msg = String(
    item.message ?? item.msg ?? item.text ?? item.error ?? item.detail ?? '',
  );
  return parseDiagnosticLine(msg);
}

/**
 * 0-based start offsets for each 1-based line in `doc`, plus a sentinel at
 * `doc.length` (end of last line / EOF).
 */
export function lineStartOffsets(doc: string): number[] {
  const starts = [0];
  for (let i = 0; i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/**
 * Map a 1-based line (and optional column / end column / token) to a CM range.
 * Falls back to the full non-empty line span when no column is known.
 */
export function mapLineToRange(
  doc: string,
  line1: number,
  opts?: {
    col?: number | null;
    endCol?: number | null;
    /** Prefer underlining this token if found on the line */
    word?: string | null;
  },
): { from: number; to: number; line: number } | null {
  if (line1 < 1 || !Number.isFinite(line1)) return null;
  const starts = lineStartOffsets(doc);
  const lineCount = starts.length;
  if (line1 > lineCount) return null;

  const fromLine = starts[line1 - 1]!;
  const nextStart = line1 < lineCount ? starts[line1]! : doc.length;
  // Exclude trailing newline from the underline span
  let lineEnd = nextStart;
  if (lineEnd > fromLine && doc.charCodeAt(lineEnd - 1) === 10) lineEnd -= 1;
  if (lineEnd > fromLine && doc.charCodeAt(lineEnd - 1) === 13) lineEnd -= 1;

  const lineText = doc.slice(fromLine, lineEnd);

  // Explicit word/token on the line
  const word = opts?.word?.trim();
  if (word) {
    const idx = lineText.indexOf(word);
    if (idx >= 0) {
      return {
        from: fromLine + idx,
        to: fromLine + idx + word.length,
        line: line1,
      };
    }
  }

  const col = opts?.col != null && Number.isFinite(opts.col) ? Math.trunc(opts.col) : null;
  const endCol =
    opts?.endCol != null && Number.isFinite(opts.endCol) ? Math.trunc(opts.endCol) : null;

  // 1-based column (common in engine diagnostics)
  if (col != null && col >= 1) {
    const startOff = Math.min(lineText.length, Math.max(0, col - 1));
    let endOff: number;
    if (endCol != null && endCol > col) {
      endOff = Math.min(lineText.length, endCol - 1);
    } else {
      // Word at column, or single character / rest of non-space token
      const rest = lineText.slice(startOff);
      const m = /^[\w.$]+/.exec(rest);
      endOff = startOff + (m ? m[0].length : Math.min(1, rest.length || 0));
      if (endOff <= startOff) endOff = Math.min(lineText.length, startOff + 1);
    }
    return {
      from: fromLine + startOff,
      to: fromLine + Math.max(startOff, endOff),
      line: line1,
    };
  }

  // Full line (trim leading/trailing whitespace for a tighter underline)
  const lead = lineText.match(/^\s*/)?.[0].length ?? 0;
  const trail = lineText.match(/\s*$/)?.[0].length ?? 0;
  let from = fromLine + lead;
  let to = lineEnd - trail;
  if (to <= from) {
    from = fromLine;
    to = Math.max(fromLine, lineEnd);
  }
  // Empty line: zero-width at line start is invalid for marks — use 1-char if possible
  if (to === from && from < doc.length) to = from + 1;
  if (to === from && from > 0) {
    from = from - 1;
    to = from + 1;
  }
  return { from, to: Math.max(from, to), line: line1 };
}

function normalizeSeverity(raw: unknown): DiagnosticSeverity {
  const s = String(raw ?? 'error').trim().toLowerCase();
  if (s.includes('warn') || s === '1') return 'warning';
  if (s.includes('info') || s.includes('hint') || s.includes('note') || s === '0') return 'info';
  if (s.includes('err') || s.includes('fatal') || s.includes('critical') || s === '2' || s === '3') {
    return 'error';
  }
  // default for unknown: error when it looks serious, else info
  if (/error|fail|exception|syntax/i.test(s)) return 'error';
  return 'info';
}

function messageFromRecord(item: Record<string, unknown>): string {
  return String(
    item.message ?? item.msg ?? item.text ?? item.error ?? item.detail ?? item.content ?? '',
  ).trim();
}

function pushDiag(
  out: EditorDiagnostic[],
  doc: string,
  partial: {
    line: number;
    severity: DiagnosticSeverity;
    message: string;
    source?: string;
    col?: number | null;
    endCol?: number | null;
    word?: string | null;
    from?: number | null;
    to?: number | null;
  },
): void {
  if (!partial.message) return;
  const line = Math.trunc(partial.line);
  if (line < 1) return;

  let from = partial.from;
  let to = partial.to;
  if (
    from == null ||
    to == null ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to < from
  ) {
    const range = mapLineToRange(doc, line, {
      col: partial.col,
      endCol: partial.endCol,
      word: partial.word,
    });
    if (!range) return;
    from = range.from;
    to = range.to;
  } else {
    from = Math.max(0, Math.min(Math.trunc(from), doc.length));
    to = Math.max(from, Math.min(Math.trunc(to), doc.length));
  }

  // Dedup identical range + message
  if (
    out.some(
      (d) =>
        d.line === line &&
        d.from === from &&
        d.to === to &&
        d.message === partial.message &&
        d.severity === partial.severity,
    )
  ) {
    return;
  }

  out.push({
    from: from!,
    to: to!,
    line,
    severity: partial.severity,
    // Keep the engine text — hover / Problems show this verbatim
    // (including last-run "Did you mean …" / runtime detail).
    message: partial.message.slice(0, 2000),
    source: partial.source,
  });
}

function recordToPartial(
  d: Record<string, unknown>,
  fallbackSeverity: DiagnosticSeverity,
  source: string,
): {
  line: number;
  severity: DiagnosticSeverity;
  message: string;
  source: string;
  col?: number | null;
  endCol?: number | null;
  word?: string | null;
  from?: number | null;
  to?: number | null;
} | null {
  const line = lineFromDiagnosticRecord(d);
  if (line == null) return null;
  const message = messageFromRecord(d);
  if (!message) return null;
  const sevRaw = d.severity ?? d.level ?? d.type ?? fallbackSeverity;
  return {
    line,
    severity: normalizeSeverity(sevRaw),
    message,
    source: String(d.source ?? source),
    col: asFiniteNumber(d.col ?? d.column ?? d.character ?? d.startColumn),
    endCol: asFiniteNumber(d.endCol ?? d.endColumn ?? d.end_character),
    word: d.token != null ? String(d.token) : d.word != null ? String(d.word) : null,
    from: asFiniteNumber(d.from ?? d.start),
    to: asFiniteNumber(d.to ?? d.end),
  };
}

/**
 * Build editor diagnostics from a last-run / engine payload and the current
 * document text (for line → offset mapping).
 *
 * Sources:
 * - Top-level `error` / `message` / `err` / `detail` (status error)
 * - `meta.errors` / top-level `errors`
 * - `diagnostics` / `meta.diagnostics`
 * - Logs with line / `bar_index` (error & warning levels)
 */
export function diagnosticsFromLastRun(
  lastRun: unknown,
  doc: string,
): EditorDiagnostic[] {
  if (lastRun == null) return [];
  const out: EditorDiagnostic[] = [];
  const text = doc ?? '';

  if (!isRecord(lastRun)) {
    // String-only error payload
    if (typeof lastRun === 'string' && lastRun.trim()) {
      const line = parseDiagnosticLine(lastRun);
      if (line != null) {
        pushDiag(out, text, {
          line,
          severity: 'error',
          message: lastRun.trim().slice(0, 2000),
          source: 'error',
        });
      }
    }
    return sortDiagnostics(out);
  }

  // ── Structured diagnostics arrays ──────────────────────────────────
  const diagArrays: unknown[] = [];
  if (Array.isArray(lastRun.diagnostics)) diagArrays.push(...lastRun.diagnostics);
  if (isRecord(lastRun.meta) && Array.isArray(lastRun.meta.diagnostics)) {
    diagArrays.push(...lastRun.meta.diagnostics);
  }
  for (const item of diagArrays) {
    if (!isRecord(item)) {
      if (typeof item === 'string' && item.trim()) {
        const line = parseDiagnosticLine(item);
        if (line != null) {
          pushDiag(out, text, {
            line,
            severity: 'error',
            message: item.trim(),
            source: 'diagnostic',
          });
        }
      }
      continue;
    }
    const p = recordToPartial(item, 'error', 'diagnostic');
    if (p) pushDiag(out, text, p);
  }

  // ── meta.errors / errors ───────────────────────────────────────────
  const errArrays: unknown[] = [];
  if (Array.isArray(lastRun.errors)) errArrays.push(...lastRun.errors);
  if (isRecord(lastRun.meta) && Array.isArray(lastRun.meta.errors)) {
    errArrays.push(...lastRun.meta.errors);
  }
  for (const item of errArrays) {
    if (typeof item === 'string' && item.trim()) {
      const line = parseDiagnosticLine(item);
      if (line != null) {
        pushDiag(out, text, {
          line,
          severity: 'error',
          message: item.trim(),
          source: 'meta.errors',
        });
      }
      continue;
    }
    if (!isRecord(item)) continue;
    const p = recordToPartial(item, 'error', 'meta.errors');
    if (p) pushDiag(out, text, p);
  }

  // ── Top-level engine error ─────────────────────────────────────────
  const errText = String(
    lastRun.error ?? lastRun.err ?? lastRun.detail ?? '',
  ).trim();
  const msgText =
    !errText && lastRun.message != null ? String(lastRun.message).trim() : '';
  const combined = errText || msgText;
  const status = String(lastRun.status ?? '').toLowerCase();
  const looksError =
    Boolean(errText) ||
    status === 'error' ||
    status === 'failed' ||
    (combined.length > 0 && /error|fail|exception|syntax/i.test(combined));

  if (combined && looksError) {
    const line =
      lineFromDiagnosticRecord(lastRun) ?? parseDiagnosticLine(combined);
    if (line != null) {
      pushDiag(out, text, {
        line,
        severity: 'error',
        message: combined.slice(0, 2000),
        source: 'error',
        col: asFiniteNumber(lastRun.col ?? lastRun.column ?? lastRun.character),
      });
    } else {
      // No line — still surface as line 1 so the badge is useful
      pushDiag(out, text, {
        line: 1,
        severity: 'error',
        message: combined.slice(0, 2000),
        source: 'error',
      });
    }
  }

  // Multi-line stack / error body (scan each line for line refs)
  if (combined.includes('\n')) {
    for (const stackLine of combined.split(/\r?\n/)) {
      const line = parseDiagnosticLine(stackLine);
      if (line == null) continue;
      const trimmed = stackLine.trim();
      if (!trimmed) continue;
      pushDiag(out, text, {
        line,
        severity: 'error',
        message: trimmed.slice(0, 2000),
        source: 'stack',
      });
    }
  }

  // ── Logs with line / bar_index (error & warning) ────────────────────
  const logs = normalizePyneLogs(lastRun);
  for (const e of logs) {
    if (e.level !== 'error' && e.level !== 'warning') continue;
    const line = parseDiagnosticLine(e.message);
    if (line == null) continue;
    pushDiag(out, text, {
      line,
      severity: e.level === 'warning' ? 'warning' : 'error',
      message: e.message,
      source: 'log',
    });
  }

  // Raw log objects for explicit line fields normalize may not carry
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
      const sev = normalizeSeverity(item.level ?? item.severity ?? 'info');
      if (sev === 'info') continue;
      const line = lineFromDiagnosticRecord(item);
      if (line == null) continue;
      const message = messageFromRecord(item);
      if (!message) continue;
      pushDiag(out, text, {
        line,
        severity: sev,
        message,
        source: 'log',
        col: asFiniteNumber(item.col ?? item.column),
      });
    }
  }

  return sortDiagnostics(out);
}

function severityRank(s: DiagnosticSeverity): number {
  switch (s) {
    case 'error':
      return 0;
    case 'warning':
      return 1;
    case 'typo':
      return 2;
    default:
      return 3;
  }
}

function sortDiagnostics(list: EditorDiagnostic[]): EditorDiagnostic[] {
  return list.sort(
    (a, b) =>
      a.line - b.line ||
      severityRank(a.severity) - severityRank(b.severity) ||
      a.from - b.from,
  );
}

/**
 * Pine source stamped onto a last-run payload (`meta.axisSource`) so editor
 * underlines can drop after the buffer diverges from the run.
 */
export function lastRunScriptSource(lastRun: unknown): string | null {
  if (!isRecord(lastRun)) return null;
  const meta = isRecord(lastRun.meta) ? lastRun.meta : null;
  if (meta && typeof meta.axisSource === 'string' && meta.axisSource.length) {
    return meta.axisSource;
  }
  if (typeof lastRun.script === 'string' && lastRun.script.length) {
    return lastRun.script;
  }
  return null;
}

function diagMergeKey(d: EditorDiagnostic): string {
  return `${d.line}|${d.severity}|${d.message}`;
}

/**
 * Union pre-eval marks with last-run engine errors.
 * Pre-eval for the current buffer is listed first (Problems / hover).
 * Last-run engine messages are still kept when they add detail — they are
 * only dropped when the buffer no longer matches the stamped run source.
 * Dedupes by line + severity + message (pre-eval wins on exact collision).
 */
export function combineEditorDiagnostics(
  pre: readonly EditorDiagnostic[],
  lastRun: unknown,
  sourceDoc: string,
  preSource?: string | null,
): EditorDiagnostic[] {
  const preFresh =
    preSource == null || preSource === '' || preSource === sourceDoc ? pre : [];
  const runSrc = lastRunScriptSource(lastRun);
  const includeLast = runSrc != null && runSrc === sourceDoc;
  const last = includeLast ? diagnosticsFromLastRun(lastRun, sourceDoc) : [];
  if (!preFresh.length) return last;
  if (!last.length) return [...preFresh];
  const seen = new Set(preFresh.map(diagMergeKey));
  const out: EditorDiagnostic[] = [...preFresh];
  for (const d of last) {
    const k = diagMergeKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  return sortDiagnostics(out);
}

/** Count diagnostics by severity. */
export function countDiagnostics(diags: EditorDiagnostic[]): {
  errors: number;
  warnings: number;
  typos: number;
  infos: number;
  total: number;
} {
  let errors = 0;
  let warnings = 0;
  let typos = 0;
  let infos = 0;
  for (const d of diags) {
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
    else if (d.severity === 'typo') typos++;
    else infos++;
  }
  return { errors, warnings, typos, infos, total: diags.length };
}

/** Human label for the status strip badge (e.g. `3 errors`, `1 warning`). */
export function formatDiagnosticCount(diags: EditorDiagnostic[]): string {
  const { errors, warnings, typos, infos, total } = countDiagnostics(diags);
  if (total === 0) return '';
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  if (typos) parts.push(`${typos} typo${typos === 1 ? '' : 's'}`);
  if (infos && !errors && !warnings && !typos) {
    parts.push(`${infos} info`);
  } else if (infos && parts.length === 0) {
    parts.push(`${infos} info`);
  }
  return parts.join(', ') || `${total} issue${total === 1 ? '' : 's'}`;
}

// ── CodeMirror 6 integration (decorations + gutter + hover) ──────────────────

/** Push diagnostics (or null to clear). */
export const setDiagnosticsData = StateEffect.define<EditorDiagnostic[] | null>();

interface DiagnosticsState {
  diags: EditorDiagnostic[];
  decorations: DecorationSet;
}

const emptyState: DiagnosticsState = {
  diags: [],
  decorations: Decoration.none,
};

function buildDecorations(diags: EditorDiagnostic[], doc: Text): DecorationSet {
  if (!diags.length) return Decoration.none;

  // RangeSetBuilder requires adds in sorted (from, to) order
  type Entry =
    | { kind: 'line'; from: number; severity: DiagnosticSeverity }
    | {
        kind: 'mark';
        from: number;
        to: number;
        severity: DiagnosticSeverity;
        message: string;
      };

  const entries: Entry[] = [];
  const lineSev = new Map<number, DiagnosticSeverity>();

  const intel = diagIntel();
  for (const d of diags) {
    if (d.line < 1 || d.line > doc.lines) continue;
    if (!intelShowsSeverity(intel, d.severity)) continue;
    const prev = lineSev.get(d.line);
    if (prev == null || severityRank(d.severity) < severityRank(prev)) {
      lineSev.set(d.line, d.severity);
    }
    const from = Math.max(0, Math.min(d.from, doc.length));
    const to = Math.max(from, Math.min(d.to, doc.length));
    if (to > from) {
      entries.push({
        kind: 'mark',
        from,
        to,
        severity: d.severity,
        message: d.message,
      });
    }
  }

  for (const [lineNo, sev] of lineSev) {
    const line = doc.line(lineNo);
    entries.push({ kind: 'line', from: line.from, severity: sev });
  }

  entries.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    // line decorations before marks at same pos
    if (a.kind !== b.kind) return a.kind === 'line' ? -1 : 1;
    if (a.kind === 'mark' && b.kind === 'mark') return a.to - b.to;
    return 0;
  });

  const builder = new RangeSetBuilder<import('@codemirror/view').Decoration>();
  if (!intel.diagUnderlines) return builder.finish();
  for (const e of entries) {
    if (e.kind === 'line') {
      builder.add(
        e.from,
        e.from,
        Decoration.line({
          class: `cm-diag-line cm-diag-line-${e.severity}`,
        }),
      );
    } else {
      builder.add(
        e.from,
        e.to,
        Decoration.mark({
          class: `cm-diag-mark cm-diag-mark-${e.severity}`,
          attributes: {
            title: e.message,
            'data-diag-severity': e.severity,
          },
        }),
      );
    }
  }
  return builder.finish();
}

export const diagnosticsStateField = StateField.define<DiagnosticsState>({
  create() {
    return emptyState;
  },
  update(value: DiagnosticsState, tr: Transaction): DiagnosticsState {
    let diags = value.diags;
    let assigned = false;
    for (const e of tr.effects) {
      if (e.is(setDiagnosticsData)) {
        diags = e.value ?? [];
        assigned = true;
      }
    }
    // Typing must not keep remapped leftovers (plt → plot would otherwise
    // keep the typo underline on the fixed token). Solid re-applies after combine.
    if (tr.docChanged && !assigned) return emptyState;
    if (!assigned && !tr.docChanged) return value;
    if (!diags.length) return emptyState;
    return {
      diags,
      decorations: buildDecorations(diags, tr.state.doc),
    };
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.decorations),
});

class DiagGutterMarker extends GutterMarker {
  constructor(
    readonly severity: DiagnosticSeverity,
    readonly title: string,
  ) {
    super();
  }

  eq(other: DiagGutterMarker) {
    return other.severity === this.severity && other.title === this.title;
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-diag-gutter cm-diag-gutter-${this.severity}`;
    el.title = this.title;
    el.setAttribute('aria-label', this.title);
    el.textContent =
      this.severity === 'error'
        ? '●'
        : this.severity === 'warning'
          ? '▲'
          : this.severity === 'typo'
            ? '✦'
            : '■';
    return el;
  }
}

function diagnosticsGutterMarkers(view: EditorView) {
  const st = view.state.field(diagnosticsStateField, false);
  const builder = new RangeSetBuilder<GutterMarker>();
  if (!st?.diags.length || !diagIntel().diagGutter) return builder.finish();

  // One marker per line (highest severity), tooltip lists all messages
  const byLine = new Map<
    number,
    { severity: DiagnosticSeverity; messages: string[] }
  >();
  const intel = diagIntel();
  for (const d of st.diags) {
    if (d.line < 1 || d.line > view.state.doc.lines) continue;
    if (!intelShowsSeverity(intel, d.severity)) continue;
    const prev = byLine.get(d.line);
    if (!prev) {
      byLine.set(d.line, { severity: d.severity, messages: [d.message] });
      continue;
    }
    if (severityRank(d.severity) < severityRank(prev.severity)) {
      prev.severity = d.severity;
    }
    if (!prev.messages.includes(d.message)) prev.messages.push(d.message);
  }

  const lines = [...byLine.keys()].sort((a, b) => a - b);
  for (const lineNo of lines) {
    const info = byLine.get(lineNo)!;
    const line = view.state.doc.line(lineNo);
    const title = `Line ${lineNo} · ${info.severity}\n${info.messages.join('\n')}`;
    builder.add(line.from, line.from, new DiagGutterMarker(info.severity, title));
  }
  return builder.finish();
}

const diagnosticsGutterExt = gutter({
  class: 'cm-diag-gutter-col',
  markers: (view) => diagnosticsGutterMarkers(view),
});

/** Hover tooltip when the cursor rests on a diagnostic underline. */
function diagnosticHover(view: EditorView, pos: number): Tooltip | null {
  if (!diagIntel().diagHover) return null;
  const st = view.state.field(diagnosticsStateField, false);
  if (!st?.diags.length) return null;
  const intel = diagIntel();
  const shown = (d: EditorDiagnostic) => intelShowsSeverity(intel, d.severity);
  const hits = st.diags.filter((d) => shown(d) && pos >= d.from && pos <= d.to);
  if (!hits.length) {
    // Also match full line when only line highlight is present
    const line = view.state.doc.lineAt(pos);
    const lineHits = st.diags.filter((d) => shown(d) && d.line === line.number);
    if (!lineHits.length) return null;
    hits.push(...lineHits);
  }
  // Highest severity first
  hits.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const primary = hits[0]!;
  return {
    pos: primary.from,
    end: primary.to,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = `cm-diag-tooltip cm-diag-tooltip-${primary.severity}`;
      for (const h of hits.slice(0, 6)) {
        const row = document.createElement('div');
        row.className = 'cm-diag-tooltip-row';
        const badge = document.createElement('span');
        badge.className = `cm-diag-tooltip-sev cm-diag-tooltip-sev-${h.severity}`;
        badge.textContent = h.severity;
        const msg = document.createElement('span');
        msg.className = 'cm-diag-tooltip-msg';
        msg.textContent = h.message;
        row.appendChild(badge);
        row.appendChild(msg);
        if (h.source) {
          const src = document.createElement('span');
          src.className = 'cm-diag-tooltip-src';
          src.textContent = h.source;
          row.appendChild(src);
        }
        dom.appendChild(row);
        // Typo foot-note: engine autocorrect, Run not blocked
        if (h.severity === 'typo') {
          const note = document.createElement('div');
          note.className = 'cm-diag-tooltip-note cm-diag-tooltip-note-typo';
          note.textContent =
            'PYNE autocorrects this on the fly · Run is not blocked';
          dom.appendChild(note);
        }
      }
      return { dom };
    },
  };
}

/** Squiggle underline via repeating SVG (same recipe as @codemirror/lint). */
function diagSquiggle(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 2.5 l1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5" stroke="${color}" fill="none" stroke-width="1.2"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function diagMarkSpec(color: string, wash: string): Record<string, string> {
  return {
    backgroundImage: diagSquiggle(color),
    backgroundColor: wash,
    // Solid fallback — wavy text-decoration is often reset by Tailwind preflight
    boxShadow: `inset 0 -2px 0 0 ${color}`,
    textDecoration: `underline wavy ${color}`,
    textUnderlineOffset: '2px',
    textDecorationSkipInk: 'none',
  };
}

/**
 * High-precedence theme (not baseTheme / Prec.lowest) so squiggles are not
 * wiped by Tailwind preflight or the void editor theme.
 */
export const diagnosticsTheme = Prec.high(
  EditorView.theme({
  '.cm-diag-mark': {
    backgroundRepeat: 'repeat-x',
    backgroundPosition: 'left bottom',
    backgroundSize: '6px 3px',
    paddingBottom: '3px',
  },
  '.cm-diag-mark-error': diagMarkSpec('#e85d4c', 'rgba(232, 93, 76, 0.12)'),
  '.cm-diag-mark-warning': diagMarkSpec('#e8a03a', 'rgba(232, 160, 58, 0.12)'),
  /* Builtin typos — distinct violet, not an error (engine may autocorrect) */
  '.cm-diag-mark-typo': diagMarkSpec('#c084fc', 'rgba(192, 132, 252, 0.14)'),
  '.cm-diag-mark-info': diagMarkSpec('#8b8e9c', 'rgba(139, 142, 156, 0.10)'),
  '.cm-diag-line-error': {
    backgroundColor: 'rgba(232, 93, 76, 0.07)',
  },
  '.cm-diag-line-warning': {
    backgroundColor: 'rgba(232, 160, 58, 0.06)',
  },
  '.cm-diag-line-typo': {
    backgroundColor: 'rgba(192, 132, 252, 0.07)',
  },
  '.cm-diag-line-info': {
    backgroundColor: 'rgba(139, 142, 156, 0.04)',
  },
  /* Hidden until diagnostics exist (profiler-style on-demand column) */
  '.cm-diag-gutter-col': {
    display: 'none',
    minWidth: '0',
    width: '0',
  },
  '&.cm-has-diag-gutter .cm-diag-gutter-col': {
    display: 'flex',
    width: '16px',
    minWidth: '16px',
  },
  '.cm-diag-gutter-col .cm-gutterElement': {
    minWidth: '16px',
    padding: '0 1px',
  },
  '.cm-diag-gutter': {
    fontSize: '11px',
    lineHeight: '1.35',
    textAlign: 'center',
    width: '100%',
    minHeight: '14px',
    padding: '1px 0',
    opacity: '0.95',
    cursor: 'default',
  },
  '.cm-diag-gutter-error': { color: '#e85d4c', fontWeight: '700' },
  '.cm-diag-gutter-warning': { color: '#e8a03a', fontWeight: '700' },
  '.cm-diag-gutter-typo': { color: '#c084fc', fontWeight: '700' },
  '.cm-diag-gutter-info': { color: '#8b8e9c' },
  '.cm-diag-tooltip': {
    fontSize: '11px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    maxWidth: '360px',
    padding: '6px 8px',
    borderRadius: '4px',
    backgroundColor: '#1e1f26',
    color: '#e8e8ed',
    border: '1px solid #3a3c48',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    lineHeight: '1.35',
  },
  '.cm-diag-tooltip-row': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: '6px',
    marginTop: '2px',
  },
  '.cm-diag-tooltip-row:first-child': { marginTop: '0' },
  '.cm-diag-tooltip-sev': {
    fontSize: '9px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    flexShrink: '0',
  },
  '.cm-diag-tooltip-sev-error': { color: '#e85d4c' },
  '.cm-diag-tooltip-sev-warning': { color: '#e8a03a' },
  '.cm-diag-tooltip-sev-typo': { color: '#c084fc' },
  '.cm-diag-tooltip-sev-info': { color: '#8b8e9c' },
  '.cm-diag-tooltip-msg': {
    flex: '1 1 auto',
    minWidth: '0',
    wordBreak: 'break-word',
  },
  '.cm-diag-tooltip-src': {
    fontSize: '9px',
    color: '#6b6e7c',
    flexShrink: '0',
  },
  '.cm-diag-tooltip-note': {
    fontSize: '10px',
    marginTop: '4px',
    paddingTop: '4px',
    borderTop: '1px solid #3a3c48',
    color: '#a1a1aa',
    lineHeight: '1.3',
  },
  '.cm-diag-tooltip-note-typo': {
    color: '#d8b4fe',
  },
  }),
);

/** Mount always; drive with {@link applyDiagnostics}. */
export function diagnosticsExtension(): Extension {
  return [
    diagnosticsStateField,
    diagnosticsGutterExt,
    diagnosticsTheme,
    hoverTooltip(diagnosticHover, { hideOn: (tr) => tr.docChanged }),
    // Show diag gutter column only when markers exist (no empty reserved width)
    EditorView.editorAttributes.of((view) => {
      const st = view.state.field(diagnosticsStateField, false);
      if (!st?.diags?.length || !diagIntel().diagGutter) return null;
      return { class: 'cm-has-diag-gutter' };
    }),
  ];
}

function diagnosticsSignature(diags: readonly EditorDiagnostic[]): string {
  return diags
    .map((d) => `${d.line}|${d.from}|${d.to}|${d.severity}|${d.message}|${d.source ?? ''}`)
    .join('\n');
}

/** Apply or clear diagnostics on a view. */
export function applyDiagnostics(
  view: EditorView,
  diags: EditorDiagnostic[] | null,
) {
  const next = diags && diags.length ? diags : [];
  const st = view.state.field(diagnosticsStateField, false);
  const intel = diagIntel();
  const sigMatch =
    !!st && diagnosticsSignature(st.diags) === diagnosticsSignature(next);
  if (sigMatch) {
    const painted = st.decorations.size > 0;
    const shouldPaint =
      next.length > 0 &&
      intel.diagUnderlines &&
      next.some((d) => intelShowsSeverity(intel, d.severity));
    // Skip only when paint already matches intent. Empty decorations with
    // live diags (underlines were off, then on) must rebuild.
    if (painted === shouldPaint) return;
  }
  view.dispatch({
    effects: setDiagnosticsData.of(next.length ? next : null),
  });
}

/**
 * Select the diagnostic range and scroll it into view (center).
 * Returns false if the range is out of document bounds.
 */
export function jumpToDiagnostic(
  view: EditorView,
  diag: EditorDiagnostic,
): boolean {
  const len = view.state.doc.length;
  if (diag.from < 0 || diag.from > len) return false;
  const from = Math.min(diag.from, len);
  const to = Math.max(from, Math.min(diag.to, len));
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  });
  view.focus();
  return true;
}

/** Jump to the first error (or first diagnostic of any severity). */
export function jumpToFirstDiagnostic(
  view: EditorView,
  diags: EditorDiagnostic[],
): boolean {
  if (!diags.length) return false;
  const first =
    diags.find((d) => d.severity === 'error') ??
    diags.find((d) => d.severity === 'warning') ??
    diags.find((d) => d.severity === 'typo') ??
    diags[0]!;
  return jumpToDiagnostic(view, first);
}
