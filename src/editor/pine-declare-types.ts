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
 * Add missing Pine **type1** (qualifier: `series` / `simple` / `const`) and
 * **type2** (`int` / `float` / `bool` / `string` / `color` / …) declarations
 * on untyped `name = expr` bindings.
 *
 * Pure source transform — safe to run after a successful engine pass when
 * plot series names are known (optional {@link DeclareTypesOptions.seriesNames}).
 *
 * Does **not** touch `:=` reassignments, function params, or already-typed
 * declarations. Skips lines inside comments / strings.
 *
 * @module editor/pine-declare-types
 */

import {
  advancePineLineState,
  type PineHighlightState,
} from './pyne-language';

/** Pine type qualifier (TV type1). */
export type PineType1 = 'series' | 'simple' | 'const';

/**
 * Built-in type names we will insert (TV type2).
 * UDTs / collections are left alone (need explicit author types).
 */
export type PineType2 =
  | 'int'
  | 'float'
  | 'bool'
  | 'string'
  | 'color'
  | 'label'
  | 'line'
  | 'box'
  | 'table'
  | 'polyline';

const TYPE1 = new Set<string>(['series', 'simple', 'const']);
const TYPE2 = new Set<string>([
  'int',
  'float',
  'bool',
  'string',
  'color',
  'label',
  'line',
  'box',
  'table',
  'polyline',
  'array',
  'matrix',
  'map',
  'chart.point',
  'linefill',
]);

/** Built-in series identifiers (always series-typed). */
const SERIES_IDENTS = new Set([
  'open',
  'high',
  'low',
  'close',
  'volume',
  'time',
  'hl2',
  'hlc3',
  'ohlc4',
  'hlcc4',
  'bar_index',
  'last_bar_index',
  'timenow',
]);

/** Keywords that must never be treated as variable names. */
const RESERVED = new Set([
  'if',
  'else',
  'for',
  'while',
  'switch',
  'type',
  'enum',
  'export',
  'import',
  'method',
  'and',
  'or',
  'not',
  'true',
  'false',
  'na',
  'var',
  'varip',
  ...TYPE1,
  ...TYPE2,
]);

export type DeclareTypesOptions = {
  /** Plot / series names from last run — force `series float` when name matches. */
  seriesNames?: Iterable<string> | null;
  /** Insert type1 qualifier when missing (default true). */
  addType1?: boolean;
  /** Insert type2 when missing (default true). */
  addType2?: boolean;
};

export type TypeDeclareEdit = {
  /** 1-based line number */
  line: number;
  name: string;
  before: string;
  after: string;
  type1: PineType1 | null;
  type2: PineType2 | null;
};

export type DeclareTypesResult = {
  source: string;
  changed: number;
  edits: TypeDeclareEdit[];
};

/**
 * One top-level (or indented) assignment candidate.
 * `:=` reassignments are excluded by the line matcher.
 */
type AssignHit = {
  indent: string;
  exportKw: boolean;
  mode: 'var' | 'varip' | null;
  type1: PineType1 | null;
  type2: string | null;
  name: string;
  rhs: string;
  /** Full original line (no trailing newline) */
  raw: string;
};

/**
 * Match a single-line assignment declaration.
 * Groups: indent, export?, var/varip?, type1?, type2?, name, rhs
 */
const ASSIGN_RE =
  /^(\s*)(export\s+)?(varip|var)?\s*(?:(series|simple|const)\s+)?(?:(int|float|bool|string|color|label|line|box|table|polyline|array|matrix|map|linefill)\s+)?([A-Za-z_][\w]*)\s*=\s*(.+)$/;

/** Parse one line into an assign hit, or null. */
export function parseAssignLine(line: string): AssignHit | null {
  const m = line.match(ASSIGN_RE);
  if (!m) return null;
  const name = m[6]!;
  if (RESERVED.has(name.toLowerCase())) return null;
  // Skip compound / reassignment that slipped through (shouldn’t)
  if (line.includes(':=')) return null;
  const modeRaw = m[3] ? m[3].toLowerCase() : null;
  const type1Raw = m[4] ? (m[4].toLowerCase() as PineType1) : null;
  const type2Raw = m[5] ? m[5].toLowerCase() : null;
  return {
    indent: m[1] || '',
    exportKw: Boolean(m[2]),
    mode: modeRaw === 'var' || modeRaw === 'varip' ? modeRaw : null,
    type1: type1Raw && TYPE1.has(type1Raw) ? type1Raw : null,
    type2: type2Raw && TYPE2.has(type2Raw) ? type2Raw : null,
    name,
    rhs: (m[7] || '').trim(),
    raw: line,
  };
}

/** Infer type2 from a RHS expression (best-effort). */
export function inferType2(rhs: string): PineType2 | null {
  const s = rhs.trim();
  if (!s) return null;

  // string literal
  if (/^["']/.test(s)) return 'string';
  // bool literal
  if (/^(true|false)\b/i.test(s)) return 'bool';
  // bool series helpers / pure comparisons
  if (/^(?:ta\.)?(?:crossover|crossunder|cross|rising|falling)\s*\(/i.test(s)) {
    return 'bool';
  }
  if (
    /(?:==|!=|<=|>=|<|>)/.test(s) &&
    !/[+\-*/%]/.test(s.replace(/"[^"]*"|'[^']*'/g, ''))
  ) {
    return 'bool';
  }
  if (/^\s*not\s+/i.test(s) || /\b(and|or)\b/i.test(s)) {
    // logical combine — still bool when no arithmetic
    if (!/[+\-*/%]/.test(s.replace(/"[^"]*"|'[^']*'/g, ''))) return 'bool';
  }

  // color.* / #hex / color.rgb / color.new
  if (
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/.test(s) ||
    /\bcolor\.(rgb|new|r|g|b|t|from_gradient)\s*\(/i.test(s) ||
    /\bcolor\.(red|green|blue|black|white|gray|grey|orange|purple|yellow|aqua|fuchsia|lime|maroon|navy|olive|silver|teal)\b/i.test(
      s,
    )
  ) {
    return 'color';
  }

  // drawing constructors
  if (/\b(line|label|box|table|polyline)\.new\s*\(/i.test(s)) {
    const m = s.match(/\b(line|label|box|table|polyline)\.new\s*\(/i);
    return (m?.[1]?.toLowerCase() as PineType2) || null;
  }

  // string helpers
  if (/\bstr\.\w+\s*\(/i.test(s) || /\bsyminfo\.\w+\b/i.test(s) || /\btimeframe\.\w+\b/i.test(s)) {
    if (/\bstr\.(tonumber|format)\s*\(/i.test(s)) return 'float';
    return 'string';
  }

  // input.* typed helpers
  if (/\binput\.int\s*\(/i.test(s)) return 'int';
  if (/\binput\.(float|price)\s*\(/i.test(s)) return 'float';
  if (/\binput\.bool\s*\(/i.test(s)) return 'bool';
  if (/\binput\.(string|text_area|timeframe|symbol|session)\s*\(/i.test(s)) return 'string';
  if (/\binput\.(color|source)\s*\(/i.test(s)) {
    return /\binput\.color\s*\(/i.test(s) ? 'color' : 'float';
  }
  if (/\binput\s*\(/i.test(s)) return 'float'; // bare input() → float-ish

  // int literal (no decimal)
  if (/^[+-]?\d+\s*$/.test(s)) return 'int';
  // float literal
  if (/^[+-]?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(s)) return 'float';
  if (/^[+-]?\d+[eE][+-]?\d+\s*$/.test(s)) return 'float';

  // bar_index → int series
  if (/^bar_index\b/.test(s) || /\bbarssince\s*\(/i.test(s) || /\bta\.barssince\s*\(/i.test(s)) {
    return 'int';
  }

  // numeric series / math / ta.*
  if (
    /\bta\.\w+\s*\(/i.test(s) ||
    /\bmath\.\w+\s*\(/i.test(s) ||
    SERIES_IDENTS.has(s.split(/[^\w.]/)[0] || '') ||
    /\b(open|high|low|close|volume|hl2|hlc3|ohlc4)\b/.test(s)
  ) {
    // bool series ops already handled; default float
    if (/\bta\.(crossover|crossunder|cross|rising|falling)\s*\(/i.test(s)) return 'bool';
    return 'float';
  }

  // ternary: prefer non-null branch types
  if (s.includes('?') && s.includes(':')) {
    const parts = s.split('?');
    if (parts.length >= 2) {
      const rest = parts.slice(1).join('?');
      const colon = rest.lastIndexOf(':');
      if (colon >= 0) {
        const a = inferType2(rest.slice(0, colon));
        const b = inferType2(rest.slice(colon + 1));
        if (a && b && a === b) return a;
        if (a === 'float' || b === 'float') return 'float';
        if (a === 'int' || b === 'int') return a === 'int' && b === 'int' ? 'int' : 'float';
        return a || b;
      }
    }
  }

  // arithmetic → float if any float-ish operand, else int if all int-looking
  if (/[+\-*/%]/.test(s) && !/["']/.test(s)) {
    if (/\d+\.\d|\b(open|high|low|close|volume|hl2)\b|\bta\./i.test(s)) return 'float';
    if (/^\s*[+\-]?[\d\s+\-*/%()]+\s*$/.test(s)) return 'int';
    return 'float';
  }

  return null;
}

/** Infer type1 qualifier from RHS + type2. */
export function inferType1(rhs: string, type2: PineType2 | null): PineType1 | null {
  const s = rhs.trim();
  if (!s) return null;

  // Compile-time constants
  if (
    /^(true|false|na)\b/i.test(s) ||
    /^["']/.test(s) ||
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(s) ||
    /^#([0-9a-fA-F]{3,8})\b/.test(s) ||
    /^color\.(red|green|blue|black|white|gray|grey|orange|purple|yellow|aqua|fuchsia|lime|maroon|navy|olive|silver|teal)\s*$/i.test(
      s,
    )
  ) {
    return 'const';
  }

  // Inputs are simple (per-bar constant from user)
  if (/\binput(\.|\s*\()/i.test(s)) return 'simple';

  // Series sources / ta / bar state series
  if (
    /\b(open|high|low|close|volume|time|hl2|hlc3|ohlc4|bar_index|last_bar_index)\b/.test(s) ||
    /\bta\.\w+\s*\(/i.test(s) ||
    /\brequest\.\w+\s*\(/i.test(s)
  ) {
    return 'series';
  }

  // Drawing constructors → series of that object type
  if (/\b(line|label|box|table|polyline)\.new\s*\(/i.test(s)) return 'series';

  // Default: simple for pure math on literals, series if unknown float-ish
  if (type2 === 'int' || type2 === 'bool' || type2 === 'string' || type2 === 'color') {
    // If RHS only uses consts / simple names, prefer simple
    if (!/\b(open|high|low|close|volume|ta\.|request\.)/i.test(s)) return 'simple';
  }
  if (type2 === 'float') return 'series';
  return null;
}

/** Build the type prefix string to insert (may be empty). */
export function buildTypePrefix(
  hit: AssignHit,
  inferred1: PineType1 | null,
  inferred2: PineType2 | null,
  opts: DeclareTypesOptions,
): { type1: PineType1 | null; type2: PineType2 | null; prefix: string } | null {
  const want1 = opts.addType1 !== false;
  const want2 = opts.addType2 !== false;

  let type1: PineType1 | null = hit.type1;
  let type2: PineType2 | null = (hit.type2 as PineType2 | null) || null;

  if (want2 && !type2 && inferred2) type2 = inferred2;
  if (want1 && !type1 && inferred1) type1 = inferred1;

  // Nothing new to add
  if (type1 === hit.type1 && type2 === hit.type2) return null;
  if (!type1 && !type2) return null;
  // Need at least type2 to form a valid typed declaration when adding types
  if (!type2 && !hit.type2) return null;

  const parts: string[] = [];
  if (type1) parts.push(type1);
  if (type2) parts.push(type2);
  return { type1, type2, prefix: parts.join(' ') };
}

function rebuildLine(
  hit: AssignHit,
  type1: PineType1 | null,
  type2: PineType2 | null,
): string {
  const parts: string[] = [];
  if (hit.exportKw) parts.push('export');
  if (hit.mode) parts.push(hit.mode);
  if (type1) parts.push(type1);
  if (type2) parts.push(type2);
  parts.push(hit.name);
  return `${hit.indent}${parts.join(' ')} = ${hit.rhs}`;
}

/**
 * Add missing type1 / type2 declarations across the document.
 * Returns original source when nothing changes.
 */
export function addMissingTypeDeclarations(
  source: string,
  opts: DeclareTypesOptions = {},
): DeclareTypesResult {
  const raw = String(source ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw) return { source: raw, changed: 0, edits: [] };

  const seriesSet = new Set<string>();
  if (opts.seriesNames) {
    for (const n of opts.seriesNames) {
      if (n && typeof n === 'string') seriesSet.add(n);
    }
  }

  const lines = raw.split('\n');
  const out: string[] = [];
  const edits: TypeDeclareEdit[] = [];
  let scan: PineHighlightState = {
    inBlockComment: false,
    stringQuote: null,
    afterDot: false,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const startedInLiteral = Boolean(scan.stringQuote || scan.inBlockComment);
    scan = advancePineLineState(line, scan);

    // Skip comment-only lines and lines inside block comments / strings
    if (startedInLiteral || scan.inBlockComment) {
      out.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('//@')) {
      out.push(line);
      continue;
    }
    // Skip control / declaration keywords that aren't simple assigns
    if (
      /^(if|else|for|while|switch|type|enum|import|export\s+(type|enum|method)|method)\b/.test(
        trimmed,
      )
    ) {
      out.push(line);
      continue;
    }
    // Function definitions: name(...) =>
    if (/^[A-Za-z_][\w]*\s*\([^)]*\)\s*=>/.test(trimmed) || /^export\s+/.test(trimmed) && /=>/.test(trimmed)) {
      out.push(line);
      continue;
    }

    const hit = parseAssignLine(line);
    if (!hit) {
      out.push(line);
      continue;
    }
    // Already fully typed
    if (hit.type1 && hit.type2) {
      out.push(line);
      continue;
    }

    let inferred2 = inferType2(hit.rhs);
    let inferred1 = inferType1(hit.rhs, inferred2);

    // Last-run plot series → series float
    if (seriesSet.has(hit.name)) {
      inferred2 = inferred2 || 'float';
      inferred1 = 'series';
    }

    const built = buildTypePrefix(hit, inferred1, inferred2, opts);
    if (!built) {
      out.push(line);
      continue;
    }

    const next = rebuildLine(hit, built.type1, built.type2);
    if (next === line) {
      out.push(line);
      continue;
    }
    out.push(next);
    edits.push({
      line: i + 1,
      name: hit.name,
      before: line,
      after: next,
      type1: built.type1,
      type2: built.type2,
    });
  }

  // Preserve whether original ended with newline
  let result = out.join('\n');
  if (raw.endsWith('\n') && !result.endsWith('\n')) result += '\n';
  if (!raw.endsWith('\n') && result.endsWith('\n') && raw.length > 0) {
    result = result.replace(/\n$/, '');
  }

  return { source: result, changed: edits.length, edits };
}

/** True when {@link addMissingTypeDeclarations} would change the document. */
export function wouldAddTypeDeclarations(
  source: string,
  opts: DeclareTypesOptions = {},
): boolean {
  return addMissingTypeDeclarations(source, opts).changed > 0;
}
