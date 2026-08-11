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
 * 1. Mark wrong code in the editor (underlines / Problems) after **idle**,
 *    **Save**, or **Run** — not mid-keystroke (incomplete input is not finished)
 * 2. Disable Run when static errors are present (after a check has landed)
 *
 * Strategy (fast → authoritative):
 * - Always run {@link localPreevaluate}: brackets, strings, entry point, and
 *   **unknown builtin members** (`plt()` / `strategy.etry` → error via builtins)
 * - When server engine + Backend URL: merge with Pro API `POST /lsp/diagnostics`
 *   (parse + real syntax). Style-noise rules (C001–C004) are filtered out.
 *
 * Typing: {@link schedulePreeval} clears marks and re-checks after
 * {@link PREEVAL_IDLE_MS} of no edits. Save / Run use {@link runPreevalNow}.
 *
 * Does **not** execute against bars. Runtime errors still appear after Run.
 *
 * @module editor/preevaluate
 */

import {
  fetchRemoteDiagnostics,
  shouldUseRemoteLsp,
  type RemoteDiagnostic,
} from './pyne-lsp-client';
import {
  type DiagnosticSeverity,
  type EditorDiagnostic,
} from './diagnostics';
import { setPreEval, store } from '../store';
import builtinsJson from './data/pyne-builtins.json';
import { PINE_ENUM_PATHS } from './pine-enums';

/**
 * Quiet time after the last keystroke before idle lint runs (ms).
 * Incomplete mid-edit input is not flagged until the user pauses.
 */
export const PREEVAL_IDLE_MS = 2000;

/**
 * Default debounce for {@link schedulePreeval} — same as idle lint window.
 * Kept as an alias for older call sites / tests.
 */
export const PREEVAL_DEBOUNCE_MS = PREEVAL_IDLE_MS;

// ── Builtin member index (from pyne-builtins.json + runtime constants) ───────

/**
 * Runtime / style constants missing from the LSP metadata catalog
 * (`pyne-builtins.json` only ships callables + a few constants).
 *
 * Canonical list: {@link PINE_ENUM_PATHS} in `pine-enums.ts` (shared with
 * editor completions for all Pine named-arg enums).
 */
export const EXTRA_KNOWN_BUILTIN_PATHS: readonly string[] = PINE_ENUM_PATHS;

const BUILTIN_NAMES = new Set([
  ...Object.keys(builtinsJson as Record<string, unknown>),
  ...EXTRA_KNOWN_BUILTIN_PATHS,
]);

/** Paths that are parents of a known member (e.g. `strategy`, `strategy.closedtrades`). */
const BUILTIN_PREFIXES = new Set<string>();
/** Root modules that have dotted members (strategy, ta, math, …). */
const BUILTIN_MODULES = new Set<string>();

function indexBuiltinPath(name: string): void {
  if (!name.includes('.')) {
    BUILTIN_MODULES.add(name);
    return;
  }
  const parts = name.split('.');
  BUILTIN_MODULES.add(parts[0]!);
  for (let i = 1; i < parts.length; i++) {
    BUILTIN_PREFIXES.add(parts.slice(0, i).join('.'));
  }
}

for (const name of BUILTIN_NAMES) {
  indexBuiltinPath(name);
}

/** True if `path` is a known builtin, or a namespace prefix of one. */
export function isKnownBuiltinPath(path: string): boolean {
  if (!path) return false;
  if (BUILTIN_NAMES.has(path) || BUILTIN_PREFIXES.has(path)) return true;
  // Bare module name (ta, strategy, …)
  if (BUILTIN_MODULES.has(path)) return true;
  return false;
}

/** Small Levenshtein for typo suggestions (capped lengths). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > 32 || b.length > 32) return 99;
  const m = a.length;
  const n = b.length;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j]!;
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n]!;
}

/**
 * Suggest a close known path for a typo
 * (e.g. `strategy.etry` → `strategy.entry`, bare `plt` → `plot`).
 * Returns null when nothing is close enough.
 */
export function suggestBuiltinPath(path: string): string | null {
  const parts = path.split('.');
  // Bare top-level name (plt → plot)
  if (parts.length < 2) {
    const leaf = path.toLowerCase();
    if (!leaf) return null;
    let best: string | null = null;
    let bestD = 3; // only suggest if distance ≤ 2
    for (const k of BUILTIN_NAMES) {
      if (k.includes('.')) continue;
      const d = editDistance(leaf, k.toLowerCase());
      if (d > 0 && d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }
  const leaf = parts[parts.length - 1]!;
  const parent = parts.slice(0, -1).join('.');
  const depth = parts.length;
  let best: string | null = null;
  let bestD = 3; // only suggest if distance ≤ 2
  for (const k of BUILTIN_NAMES) {
    if (!k.startsWith(parent + '.')) continue;
    const kp = k.split('.');
    if (kp.length !== depth) continue;
    const candLeaf = kp[kp.length - 1]!;
    const d = editDistance(leaf.toLowerCase(), candLeaf.toLowerCase());
    if (d > 0 && d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Pine keywords / control forms that look like calls but are not builtins. */
const BARE_CALL_SKIP = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'type',
  'method',
  'export',
  'import',
  'and',
  'or',
  'not',
  'true',
  'false',
  'na',
  'var',
  'varip',
  'matrix',
  'array',
  'map',
  'int',
  'float',
  'bool',
  'string',
  'color',
  'line',
  'label',
  'box',
  'table',
  'polyline',
  'chart',
  'point',
]);

export type DottedRef = {
  /** Full path e.g. strategy.etry */
  path: string;
  /** 1-based line */
  line: number;
  /** 0-based start column of the full path */
  col: number;
  /** 0-based end column (exclusive) */
  endCol: number;
};

/**
 * Scan source for `module.member` references (skips strings / comments).
 * Only yields paths whose root is a known builtin module.
 */
export function scanBuiltinMemberRefs(source: string): DottedRef[] {
  const out: DottedRef[] = [];
  const lines = source.split('\n');
  let inBlock = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    let i = 0;
    let inStr: '"' | "'" | null = null;
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
        i += 1;
        continue;
      }

      // Identifier start
      if (/[A-Za-z_]/.test(c)) {
        const start = i;
        i += 1;
        while (i < line.length && /[A-Za-z0-9_]/.test(line[i]!)) i += 1;
        // Consume .member chains
        while (i < line.length && line[i] === '.') {
          const afterDot = i + 1;
          if (afterDot >= line.length || !/[A-Za-z_]/.test(line[afterDot]!)) break;
          i = afterDot + 1;
          while (i < line.length && /[A-Za-z0-9_]/.test(line[i]!)) i += 1;
        }
        const path = line.slice(start, i);
        if (path.includes('.')) {
          const root = path.split('.')[0]!;
          if (BUILTIN_MODULES.has(root)) {
            out.push({
              path,
              line: li + 1,
              col: start,
              endCol: i,
            });
          }
        }
        continue;
      }
      i += 1;
    }
  }
  return out;
}

/**
 * Scan for bare call sites `name(` (not dotted). Used for top-level typos
 * like `plt(close)` → `plot`. Skips strings / comments.
 */
export function scanBareCallRefs(source: string): DottedRef[] {
  const out: DottedRef[] = [];
  const lines = source.split('\n');
  let inBlock = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    let i = 0;
    let inStr: '"' | "'" | null = null;
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
        i += 1;
        continue;
      }

      if (/[A-Za-z_]/.test(c)) {
        const start = i;
        i += 1;
        while (i < line.length && /[A-Za-z0-9_]/.test(line[i]!)) i += 1;
        // Dotted paths are handled by {@link scanBuiltinMemberRefs}
        if (i < line.length && line[i] === '.') {
          while (i < line.length && line[i] === '.') {
            const afterDot = i + 1;
            if (afterDot >= line.length || !/[A-Za-z_]/.test(line[afterDot]!)) break;
            i = afterDot + 1;
            while (i < line.length && /[A-Za-z0-9_]/.test(line[i]!)) i += 1;
          }
          continue;
        }
        // Optional whitespace then '('
        let j = i;
        while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j += 1;
        if (j >= line.length || line[j] !== '(') continue;
        const path = line.slice(start, i);
        if (!path || BARE_CALL_SKIP.has(path)) continue;
        out.push({
          path,
          line: li + 1,
          col: start,
          endCol: i,
        });
        continue;
      }
      i += 1;
    }
  }
  return out;
}

/**
 * Flag unknown `module.member` paths and bare call typos against the builtins catalog.
 * e.g. `strategy.etry` / `plt(close)` → typo with optional “Did you mean …?”
 */
export function checkUnknownBuiltinMembers(source: string): EditorDiagnostic[] {
  const refs = [
    ...scanBuiltinMemberRefs(source),
    ...scanBareCallRefs(source),
  ];
  const out: EditorDiagnostic[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (isKnownBuiltinPath(ref.path)) continue;
    const key = `${ref.line}:${ref.col}:${ref.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hint = suggestBuiltinPath(ref.path);
    // Bare user-defined helpers (`myFunc()`) stay quiet unless a close builtin exists
    if (!ref.path.includes('.') && !hint) continue;
    const msg = hint
      ? `Unknown \`${ref.path}\` — did you mean \`${hint}\`?`
      : `Unknown \`${ref.path}\` (not a built-in member)`;
    out.push(
      diag(source, {
        line: ref.line,
        col: ref.col,
        endLine: ref.line,
        endCol: ref.endCol,
        message: msg,
        // Non-blocking: violet “typo” mark — PYNE may autocorrect at run time
        severity: 'typo',
        source: 'preeval-typo',
      }),
    );
  }
  return out;
}

/**
 * Remote style rules that are noisy / wrong for Pine (C001 camelCase flags
 * every `rsi = ta.rsi`, C004 trailing newline is editor-buffer noise).
 */
export function isRemoteStyleNoise(d: EditorDiagnostic | RemoteDiagnostic): boolean {
  const code =
    'code' in d && d.code
      ? String(d.code)
      : (() => {
          const m = String((d as EditorDiagnostic).message || '').match(/\[([A-Z]\d{3})\]/);
          return m?.[1] ?? '';
        })();
  if (/^C00[1-4]$/.test(code)) return true;
  const msg = String((d as EditorDiagnostic).message || (d as RemoteDiagnostic).message || '');
  if (/should use camelCase/i.test(msg)) return true;
  if (/end with a newline/i.test(msg)) return true;
  if (/exceeds 120 characters/i.test(msg)) return true;
  if (/single-line if statements without braces/i.test(msg)) return true;
  return false;
}

function diagKey(d: EditorDiagnostic): string {
  return `${d.line}|${d.severity}|${d.message}`;
}

function dedupeDiagnostics(list: EditorDiagnostic[]): EditorDiagnostic[] {
  const seen = new Set<string>();
  const out: EditorDiagnostic[] = [];
  for (const d of list) {
    const k = diagKey(d);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(d);
  }
  out.sort((a, b) => a.line - b.line || a.from - b.from || a.message.localeCompare(b.message));
  return out;
}

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
        message: "Missing //@version declaration. Add '//@version=6' at the top.",
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

  // Unknown builtin members (strategy.etry, ta.smma, …) — not catchable by parse alone
  out.push(...checkUnknownBuiltinMembers(source));

  return out;
}

/** Convert remote diagnostic rows to editor ranges for *doc*. */
export function remoteToEditorDiagnostics(
  doc: string,
  remote: readonly RemoteDiagnostic[],
): EditorDiagnostic[] {
  const out: EditorDiagnostic[] = [];
  for (const r of remote) {
    // Drop pyne style noise before it hits the editor (false “wrong code”)
    if (isRemoteStyleNoise(r)) continue;
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
 * Union local structural/member checks with remote parse diagnostics.
 * Local is never discarded when remote is present (remote does not know
 * `strategy.etry`-style typos). Style noise is filtered on the remote side.
 */
export function mergePreevalDiagnostics(
  local: readonly EditorDiagnostic[],
  remote: readonly EditorDiagnostic[] | null,
): EditorDiagnostic[] {
  if (remote == null) return dedupeDiagnostics([...local]);
  return dedupeDiagnostics([...remote, ...local]);
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
 * Clear underlines while the user is still typing.
 * Incomplete input is not treated as finished until idle / Save / Run.
 * No-ops when already clear (avoids store + CM thrash every keystroke).
 */
export function clearPreevalOnEdit(source: string): void {
  lastSource = source;
  const pe = store.preEval;
  if (
    pe &&
    !pe.pending &&
    !pe.hasErrors &&
    (!pe.diagnostics || pe.diagnostics.length === 0)
  ) {
    // Still cancel any in-flight timer/request from a prior check
    cancelPreeval();
    return;
  }
  cancelPreeval();
  setPreEval({
    diagnostics: [],
    hasErrors: false,
    pending: false,
    source,
  });
}

/**
 * Debounced pre-eval after the user stops typing.
 *
 * - Clears stale underlines immediately (no mid-keystroke noise)
 * - Does **not** set `pending` for the whole idle window (avoids a 2s “checking…” flash)
 * - Runs {@link runPreevalNow} after `debounceMs` (default {@link PREEVAL_IDLE_MS})
 *
 * Save / Run should still call {@link runPreevalNow} for an immediate gate.
 */
export function schedulePreeval(
  source: string,
  debounceMs: number = PREEVAL_IDLE_MS,
): void {
  lastSource = source;
  // Drop any prior idle timer / in-flight request
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  if (abort) {
    abort.abort();
    abort = null;
  }

  // Clear marks while typing; keep pending=false until the idle check starts
  const pe = store.preEval;
  const alreadyClear =
    pe &&
    !pe.pending &&
    !pe.hasErrors &&
    (!pe.diagnostics || pe.diagnostics.length === 0);
  if (!alreadyClear) {
    setPreEval({
      diagnostics: [],
      hasErrors: false,
      pending: false,
      source,
    });
  } else if (pe.source !== source) {
    // Keep store source in sync for tab/doc identity without thrashing
    setPreEval({
      diagnostics: [],
      hasErrors: false,
      pending: false,
      source,
    });
  }

  const delay = Math.max(0, Number(debounceMs) || 0);
  timer = setTimeout(() => {
    timer = null;
    // Ignore if a newer keystroke updated lastSource
    if (source !== lastSource) return;
    void runPreevalNow(source);
  }, delay);
}

/** Immediate pre-eval (no debounce) — Save / Run gate. */
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
 * Pending checks do **not** block. Typing clears diagnostics until the idle
 * check (or Save / Run) lands again.
 */
export function isScriptRunBlocked(): boolean {
  const pe = store.preEval;
  if (!pe || pe.pending) return false;
  return !!pe.hasErrors;
}
