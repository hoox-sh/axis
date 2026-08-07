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
 * **Pre-evaluate** Pine source before a full engine run.
 *
 * Goals:
 * 1. Mark wrong code in the editor (underlines / Problems)
 * 2. Disable Run when static errors are present
 *
 * Strategy (fast → authoritative):
 * - Always run {@link localPreevaluate} (brackets, strings, entry point)
 * - When server engine + Backend URL: merge with Pro API `POST /lsp/diagnostics`
 *   (parse + linter — same rules as `pynescript-lsp`)
 *
 * Does **not** execute against bars. Runtime errors still appear after Run.
 *
 * @module editor/preevaluate
 */

import {
  fetchRemoteDiagnostics,
  shouldUseRemoteLsp,
  type RemoteDiagnostic,
} from './pine-lsp-client';
import {
  type DiagnosticSeverity,
  type EditorDiagnostic,
} from './diagnostics';
import { setPreEval, store } from '../store';

/** Debounce for as-you-type pre-eval (ms). */
export const PREEVAL_DEBOUNCE_MS = 350;

export type PreevalResult = {
  diagnostics: EditorDiagnostic[];
  hasErrors: boolean;
  /** `local` | `remote` | `local+remote` */
  source: string;
};

// ── Line / range helpers ─────────────────────────────────────────────────────

function lineOffsets(doc: string): number[] {
  const offsets = [0];
  for (let i = 0; i < doc.length; i++) {
    if (doc.charCodeAt(i) === 10 /* \n */) offsets.push(i + 1);
  }
  return offsets;
}

/**
 * Map 1-based line (+ optional 0-based cols) to absolute CM offsets.
 */
export function rangeFromLineCols(
  doc: string,
  line1: number,
  col0 = 0,
  endLine1?: number,
  endCol0?: number,
): { from: number; to: number; line: number } {
  const offs = lineOffsets(doc);
  const lineCount = offs.length;
  const line = Math.max(1, Math.min(line1, lineCount || 1));
  const lineStart = offs[line - 1] ?? 0;
  const nextStart = offs[line] ?? doc.length;
  const lineLen = Math.max(0, nextStart - lineStart - (doc[nextStart - 1] === '\n' ? 1 : 0));
  const fromCol = Math.max(0, Math.min(col0, lineLen));
  const from = lineStart + fromCol;

  let to: number;
  if (endLine1 != null && endCol0 != null) {
    const el = Math.max(1, Math.min(endLine1, lineCount || 1));
    const elStart = offs[el - 1] ?? 0;
    const elNext = offs[el] ?? doc.length;
    const elLen = Math.max(0, elNext - elStart - (doc[elNext - 1] === '\n' ? 1 : 0));
    to = elStart + Math.max(0, Math.min(endCol0, elLen));
    if (to <= from) to = Math.min(from + 1, elNext > elStart ? elNext - (doc[elNext - 1] === '\n' ? 1 : 0) : from + 1);
  } else {
    // Highlight rest of line (at least one char when possible)
    to = lineStart + lineLen;
    if (to <= from) to = Math.min(from + 1, doc.length);
  }
  if (from >= doc.length && doc.length > 0) {
    return { from: Math.max(0, doc.length - 1), to: doc.length, line };
  }
  return { from, to: Math.max(from, to), line };
}

function normalizeSeverity(raw: unknown): DiagnosticSeverity {
  const s = String(raw ?? 'warning').toLowerCase();
  if (s === 'error' || s === 'fatal') return 'error';
  if (s === 'info' || s === 'information' || s === 'hint') return 'info';
  return 'warning';
}

function diag(
  doc: string,
  opts: {
    line: number;
    col?: number;
    endLine?: number;
    endCol?: number;
    message: string;
    severity: DiagnosticSeverity;
    source?: string;
  },
): EditorDiagnostic {
  const { from, to, line } = rangeFromLineCols(
    doc,
    opts.line,
    opts.col ?? 0,
    opts.endLine,
    opts.endCol,
  );
  return {
    from,
    to,
    line,
    severity: opts.severity,
    message: opts.message,
    source: opts.source ?? 'preeval',
  };
}

// ── Local static checks ──────────────────────────────────────────────────────

/**
 * Fast client-side checks (no engine). Catches unbalanced brackets, unclosed
 * strings, missing entry point — enough to mark wrong code offline.
 */
export function localPreevaluate(source: string): EditorDiagnostic[] {
  if (!source.trim()) return [];

  const out: EditorDiagnostic[] = [];
  const lines = source.split('\n');

  // Unclosed block comment
  let inBlock = false;
  let blockStartLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let j = 0;
    while (j < line.length) {
      if (!inBlock && line.startsWith('//', j)) break; // line comment
      if (!inBlock && line.startsWith('/*', j)) {
        inBlock = true;
        blockStartLine = i + 1;
        j += 2;
        continue;
      }
      if (inBlock && line.startsWith('*/', j)) {
        inBlock = false;
        j += 2;
        continue;
      }
      j += 1;
    }
  }
  if (inBlock) {
    out.push(
      diag(source, {
        line: blockStartLine,
        message: 'Unclosed block comment (/* … */)',
        severity: 'error',
        source: 'preeval-local',
      }),
    );
  }

  // Strings + bracket balance (ignore comments)
  type Frame = { ch: string; line: number; col: number };
  const stack: Frame[] = [];
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const openers = new Set(['(', '[', '{']);

  let inStr: '"' | "'" | null = null;
  let strLine = 1;
  let strCol = 0;
  inBlock = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    let i = 0;
    while (i < line.length) {
      const c = line[i]!;
      const n = line[i + 1];

      if (!inStr && !inBlock && c === '/' && n === '/') break;
      if (!inStr && !inBlock && c === '/' && n === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      if (inBlock) {
        if (c === '*' && n === '/') {
          inBlock = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }

      if (inStr) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === inStr) inStr = null;
        i += 1;
        continue;
      }

      if (c === '"' || c === "'") {
        inStr = c;
        strLine = li + 1;
        strCol = i;
        i += 1;
        continue;
      }

      if (openers.has(c)) {
        stack.push({ ch: c, line: li + 1, col: i });
        i += 1;
        continue;
      }
      if (c in pairs) {
        const want = pairs[c]!;
        const top = stack.pop();
        if (!top || top.ch !== want) {
          out.push(
            diag(source, {
              line: li + 1,
              col: i,
              endLine: li + 1,
              endCol: i + 1,
              message: top
                ? `Mismatched '${c}' (expected close for '${top.ch}' from line ${top.line})`
                : `Unexpected '${c}'`,
              severity: 'error',
              source: 'preeval-local',
            }),
          );
        }
        i += 1;
        continue;
      }
      i += 1;
    }
  }

  if (inStr) {
    out.push(
      diag(source, {
        line: strLine,
        col: strCol,
        message: `Unclosed string literal (${inStr})`,
        severity: 'error',
        source: 'preeval-local',
      }),
    );
  }

  while (stack.length) {
    const f = stack.pop()!;
    out.push(
      diag(source, {
        line: f.line,
        col: f.col,
        endLine: f.line,
        endCol: f.col + 1,
        message: `Unclosed '${f.ch}'`,
        severity: 'error',
        source: 'preeval-local',
      }),
    );
  }

  // Entry point / version (warnings — do not block Run alone if remote will decide)
  if (!/\/\/\s*@version\s*=\s*\d+/m.test(source)) {
    out.push(
      diag(source, {
        line: 1,
        message: "Missing //@version declaration. Add '//@version=5' at the top.",
        severity: 'warning',
        source: 'preeval-local',
      }),
    );
  }
  if (!/\b(indicator|strategy|library)\s*\(/.test(source)) {
    out.push(
      diag(source, {
        line: 1,
        message: 'Script needs indicator(), strategy(), or library() declaration.',
        severity: 'error',
        source: 'preeval-local',
      }),
    );
  }

  return out;
}

/** Convert remote diagnostic rows to editor ranges for *doc*. */
export function remoteToEditorDiagnostics(
  doc: string,
  remote: readonly RemoteDiagnostic[],
): EditorDiagnostic[] {
  const out: EditorDiagnostic[] = [];
  for (const r of remote) {
    const line = typeof r.line === 'number' && r.line > 0 ? r.line : 1;
    const col = typeof r.character === 'number' && r.character >= 0 ? r.character : 0;
    const endLine =
      typeof r.endLine === 'number' && r.endLine > 0 ? r.endLine : undefined;
    const endCol =
      typeof r.endCharacter === 'number' && r.endCharacter >= 0
        ? r.endCharacter
        : undefined;
    const msg = String(r.message || '').trim();
    if (!msg) continue;
    const code = r.code ? `[${r.code}] ` : '';
    out.push(
      diag(doc, {
        line,
        col,
        endLine,
        endCol,
        message: `${code}${msg}`,
        severity: normalizeSeverity(r.severity),
        source: r.source || 'preeval',
      }),
    );
  }
  return out;
}

/**
 * Prefer remote (full parse) over local for the same line+severity class;
 * always keep remote errors; keep local-only findings when remote is absent.
 */
export function mergePreevalDiagnostics(
  local: readonly EditorDiagnostic[],
  remote: readonly EditorDiagnostic[] | null,
): EditorDiagnostic[] {
  if (!remote || !remote.length) return [...local];
  // Remote is authoritative for parse/lint; still keep local structural if remote missed
  // (usually remote supersets). Prefer remote entirely when present to avoid double marks.
  return [...remote];
}

export function hasErrorDiagnostics(diags: readonly EditorDiagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error');
}

/**
 * Run local + optional remote pre-eval for *source*.
 */
export async function preevaluateSource(
  source: string,
  opts?: { signal?: AbortSignal },
): Promise<PreevalResult> {
  const local = localPreevaluate(source);
  let remote: EditorDiagnostic[] | null = null;
  let tag = 'local';

  if (shouldUseRemoteLsp()) {
    const res = await fetchRemoteDiagnostics({ source, signal: opts?.signal });
    if (res) {
      remote = remoteToEditorDiagnostics(source, res.diagnostics);
      tag = 'local+remote';
    }
  }

  const diagnostics = mergePreevalDiagnostics(local, remote);
  return {
    diagnostics,
    hasErrors: hasErrorDiagnostics(diagnostics),
    source: tag,
  };
}

// ── Debounced scheduler (singleton) ──────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let abort: AbortController | null = null;
let seq = 0;
let lastSource = '';

/** Cancel pending / in-flight pre-eval. */
export function cancelPreeval(): void {
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (abort) {
    abort.abort();
    abort = null;
  }
}

/**
 * Debounced pre-eval → {@link setPreEval} on the app store.
 * Call from editor `onDocChange` and once on mount with the active doc.
 */
export function schedulePreeval(source: string, debounceMs = PREEVAL_DEBOUNCE_MS): void {
  lastSource = source;
  if (timer != null) clearTimeout(timer);
  // Mark pending so UI can show checking state (still allow Run until errors land)
  setPreEval({
    diagnostics: [],
    hasErrors: false,
    pending: true,
    source,
  });

  timer = setTimeout(() => {
    timer = null;
    void runPreevalNow(source);
  }, debounceMs);
}

/** Immediate pre-eval (no debounce) — used before Run as a final gate. */
export async function runPreevalNow(source: string): Promise<PreevalResult> {
  if (abort) abort.abort();
  abort = new AbortController();
  const mySeq = ++seq;
  const signal = abort.signal;

  setPreEval({
    diagnostics: [],
    hasErrors: false,
    pending: true,
    source,
  });

  try {
    const result = await preevaluateSource(source, { signal });
    if (mySeq !== seq || signal.aborted) return result;
    // Stale if user typed again during await
    if (source !== lastSource && lastSource !== '') {
      // still publish if this was the latest scheduled source
    }
    setPreEval({
      diagnostics: result.diagnostics,
      hasErrors: result.hasErrors,
      pending: false,
      source,
    });
    return result;
  } catch {
    if (mySeq !== seq) {
      return { diagnostics: [], hasErrors: false, source: 'local' };
    }
    // On failure, fall back to local-only so offline still works
    const local = localPreevaluate(source);
    const result: PreevalResult = {
      diagnostics: local,
      hasErrors: hasErrorDiagnostics(local),
      source: 'local',
    };
    setPreEval({
      diagnostics: result.diagnostics,
      hasErrors: result.hasErrors,
      pending: false,
      source,
    });
    return result;
  }
}

/**
 * True when Run should be blocked by pre-eval errors.
 * Pending checks do **not** block (avoid flicker while typing).
 */
export function isScriptRunBlocked(): boolean {
  const pe = store.preEval;
  if (!pe || pe.pending) return false;
  return !!pe.hasErrors;
}
