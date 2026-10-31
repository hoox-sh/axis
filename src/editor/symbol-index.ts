// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pine symbol index: declarations + references with source offsets.
 *
 * Pure (no CodeMirror, no DOM) so navigation, references, rename and document
 * highlight share one parse and stay unit-testable. Mirrors the declarations
 * PYNE's language server understands: functions / methods, `type` and `enum`
 * bodies, variables (incl. `var` / `varip` and tuple destructuring), loop
 * bindings, and `import … as alias`.
 *
 * Scope is indentation-based, like Pine itself: a declaration belongs to the
 * innermost enclosing function body. `referencesOf` uses that to keep a
 * parameter rename inside its function.
 *
 * @module editor/symbol-index
 */

import builtinsJson from './data/pyne-builtins.json';
import { isQuoteChar, type QuoteChar, isQuoteClose } from './pine-scan-util';

export type SymbolKind =
  'function' | 'method' | 'type' | 'enum' | 'variable' | 'parameter' | 'field' | 'import';

/** One declaration site. */
export interface SymbolDecl {
  name: string;
  kind: SymbolKind;
  /** Absolute offset of the identifier start. */
  from: number;
  /** Absolute offset one past the identifier. */
  to: number;
  /** 1-based line. */
  line: number;
  /** Enclosing function / type / enum name, or null at script level. */
  scope: string | null;
  exported?: boolean;
}

/** One occurrence (declaration or use). */
export interface SymbolRef {
  name: string;
  from: number;
  to: number;
  line: number;
  kind: 'decl' | 'call' | 'read' | 'write' | 'member';
}

export interface ScopeRange {
  /** Function / type / enum name. */
  name: string;
  /** Body start (first line after the header). */
  from: number;
  /** Body end (exclusive). */
  to: number;
}

export interface SymbolIndex {
  declarations: SymbolDecl[];
  references: SymbolRef[];
  byName: Map<string, SymbolDecl[]>;
  scopes: Map<string, ScopeRange>;
}

/** Words that are never user symbols (Pine keywords / literals / qualifiers). */
const KEYWORDS = new Set([
  'and',
  'as',
  'break',
  'by',
  'const',
  'continue',
  'else',
  'enum',
  'export',
  'false',
  'for',
  'if',
  'import',
  'in',
  'input',
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
  'linefill',
  'array',
  'matrix',
  'map',
  'method',
  'na',
  'not',
  'or',
  'series',
  'simple',
  'switch',
  'to',
  'true',
  'type',
  'var',
  'varip',
  'void',
  'while',
]);

const BUILTIN_NAMES = new Set(Object.keys(builtinsJson as Record<string, unknown>));

const FUNC_HEAD_RE = /^\s*(export\s+)?(method\s+)?([A-Za-z_]\w*)\s*\(/;
const TYPE_RE = /^\s*(export\s+)?type\s+([A-Za-z_]\w*)/;
const ENUM_RE = /^\s*(export\s+)?enum\s+([A-Za-z_]\w*)/;
const IMPORT_RE = /^\s*import\s+[^\s]+\s+as\s+([A-Za-z_]\w*)/;
const FOR_RANGE_RE = /^\s*for\s+([A-Za-z_]\w*)\s*=\s*\S+\s+to\b/;
const FOR_IN_RE = /^\s*for\s+(?:var\s+)?([A-Za-z_]\w*)\s+in\b/;
const FOR_TUPLE_RE = /^\s*for\s+(?:var\s+)?\[([^\]]+)\]\s+in\b/;
const TUPLE_ASSIGN_RE = /^\s*(?:export\s+)?(?:var|varip)?\s*\[([^\]]+)\]\s*=(?!=)/;
/** `[var] [type] name =` — excludes `==`, `=>`, `>=`, `<=`, `!=`, `:=`. */
const ASSIGN_RE =
  /^\s*(?:export\s+)?(?:(?:var|varip)\s+)?(?:(?:simple|series|const)\s+)?(?:[A-Za-z_][\w.<>[\] ]*?\s+)?([A-Za-z_]\w*)\s*=(?![=>])/;
/** Field line inside a `type` body (`    float price`). */
const FIELD_RE =
  /^\s+(?:(?:series|simple|const)\s+)?[A-Za-z_][\w.]*(?:<[^=<>]*>)?(?:\[\])?\s+([A-Za-z_]\w*)\s*(?:=.*)?$/;
/** Enum member line (`    BUY`). */
const ENUM_MEMBER_RE = /^\s+([A-Za-z_]\w*)\s*(?:=.*)?$/;

type LineSpan = { text: string; from: number; to: number; indent: number };

function lineSpans(source: string): LineSpan[] {
  const out: LineSpan[] = [];
  let from = 0;
  for (const text of source.split('\n')) {
    out.push({
      text,
      from,
      to: from + text.length,
      indent: text.length - text.trimStart().length,
    });
    from += text.length + 1;
  }
  return out;
}

function isIdentStart(c: string): boolean {
  return /[A-Za-z_]/.test(c);
}

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

/** Absolute offset of `name` inside `text` at/after `minIndex`, else -1. */
function nameOffset(text: string, name: string, minIndex = 0): number {
  const i = text.indexOf(name, minIndex);
  return i;
}

/** Split a parameter list on top-level commas, keeping absolute offsets. */
function splitParams(header: string, open: number): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let depth = 1;
  let inStr: QuoteChar | null = null;
  let start = open + 1;
  for (let i = open + 1; i < header.length; i++) {
    const c = header[i]!;
    if (inStr) {
      if (c === '\\') i += 1;
      else if (isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push({ text: header.slice(start, i), at: start });
        break;
      }
    } else if (c === ',' && depth === 1) {
      out.push({ text: header.slice(start, i), at: start });
      start = i + 1;
    }
  }
  return out;
}

/** Index of the last identifier in `part` that ends at or before `limit`. */
function lastIdentIn(part: string, limit = part.length): { name: string; at: number } | null {
  let found: { name: string; at: number } | null = null;
  for (let i = 0; i < limit; i++) {
    if (!isIdentStart(part[i]!)) continue;
    const at = i;
    i += 1;
    while (i < part.length && isIdentChar(part[i]!)) i += 1;
    found = { name: part.slice(at, i), at };
    i -= 1;
  }
  return found;
}

/**
 * Collect the parameter identifiers of a function header.
 * Each top-level part is `[qualifier] [type] name [= default]`; the name is
 * the identifier before a top-level `=` when present, else the last one.
 */
function paramDecls(
  header: string,
  headerFrom: number,
  fnName: string,
  line: number,
): SymbolDecl[] {
  const open = header.indexOf('(');
  if (open < 0) return [];
  const out: SymbolDecl[] = [];
  for (const part of splitParams(header, open)) {
    if (!part.text.trim()) continue;
    const eq = topLevelEq(part.text);
    const ident = eq >= 0 ? lastIdentIn(part.text, eq) : lastIdentIn(part.text);
    if (!ident || KEYWORDS.has(ident.name)) continue;
    out.push({
      name: ident.name,
      kind: 'parameter',
      from: headerFrom + part.at + ident.at,
      to: headerFrom + part.at + ident.at + ident.name.length,
      line,
      scope: fnName,
    });
  }
  return out;
}

/** Index of a top-level `=` in a parameter part (`-1` when absent). */
function topLevelEq(part: string): number {
  let depth = 0;
  let inStr: QuoteChar | null = null;
  for (let i = 0; i < part.length; i++) {
    const c = part[i]!;
    if (inStr) {
      if (c === '\\') i += 1;
      else if (isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === '=' && depth === 0 && part[i + 1] !== '=' && part[i + 1] !== '>') return i;
  }
  return -1;
}

/**
 * Index declarations and references in Pine source.
 * Single pass over lines for declarations, single pass for references.
 */
export function buildSymbolIndex(source: string): SymbolIndex {
  const src = String(source ?? '');
  const lines = lineSpans(src);
  const declarations: SymbolDecl[] = [];
  const scopes = new Map<string, ScopeRange>();
  const declAt = new Map<number, SymbolDecl>();

  const pushDecl = (decl: SymbolDecl): void => {
    declarations.push(decl);
    declAt.set(decl.from, decl);
  };

  /** Innermost function/type/enum header shallower than `lineIndex`. */
  const enclosingScope = (lineIndex: number): string | null => {
    const targetIndent = lines[lineIndex]!.indent;
    for (let i = lineIndex - 1; i >= 0; i--) {
      const ln = lines[i]!;
      if (!ln.text.trim()) continue;
      if (ln.indent >= targetIndent) continue;
      const fn = FUNC_HEAD_RE.exec(ln.text);
      if (fn) return fn[3]!;
      const ty = TYPE_RE.exec(ln.text);
      if (ty) return ty[2]!;
      const en = ENUM_RE.exec(ln.text);
      if (en) return en[2]!;
      // A shallower non-declaration at script level ends the search.
      if (ln.indent === 0) return null;
    }
    return null;
  };

  // ── Declarations ──────────────────────────────────────────────────────────
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li]!;
    const text = ln.text;
    if (!text.trim() || /^\s*\/\//.test(text)) continue;

    const imp = IMPORT_RE.exec(text);
    if (imp) {
      const name = imp[1]!;
      const idx = nameOffset(text, name, imp[0].length - name.length - 1);
      if (idx >= 0) {
        pushDecl({
          name,
          kind: 'import',
          from: ln.from + idx,
          to: ln.from + idx + name.length,
          line: li + 1,
          scope: null,
        });
      }
      continue;
    }

    const fn = FUNC_HEAD_RE.exec(text);
    if (fn) {
      const name = fn[3]!;
      // Join a multi-line header until the parens balance.
      let header = text;
      let endLine = li;
      const balanced = () => {
        let depth = 0;
        let inStr: QuoteChar | null = null;
        for (const c of header) {
          if (inStr) {
            if (isQuoteClose(inStr, c)) inStr = null;
            continue;
          }
          if (isQuoteChar(c)) inStr = c as QuoteChar;
          else if (c === '(') depth += 1;
          else if (c === ')') depth -= 1;
        }
        return depth <= 0;
      };
      while (!balanced() && endLine + 1 < lines.length && endLine - li < 20) {
        endLine += 1;
        header += `\n${lines[endLine]!.text}`;
      }
      if (!/\)\s*=>/.test(header)) continue;
      const idx = nameOffset(text, name, text.indexOf('(') - name.length);
      if (idx < 0) continue;
      const kind: SymbolKind = fn[2] ? 'method' : 'function';
      pushDecl({
        name,
        kind,
        from: ln.from + idx,
        to: ln.from + idx + name.length,
        line: li + 1,
        scope: enclosingScope(li),
        ...(fn[1] ? { exported: true } : {}),
      });
      for (const p of paramDecls(header, ln.from, name, li + 1)) pushDecl(p);
      // Body range: following lines indented deeper than the header.
      let bodyEnd = lines.length ? lines[lines.length - 1]!.to : 0;
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) {
          bodyEnd = body.from;
          break;
        }
      }
      scopes.set(name, {
        name,
        // Include the header line: parameters are declared there.
        from: ln.from,
        to: bodyEnd,
      });
      li = endLine;
      continue;
    }

    const ty = TYPE_RE.exec(text);
    if (ty) {
      const name = ty[2]!;
      const idx = nameOffset(text, name, ty[1] ? ty[0].indexOf('type') : 0);
      if (idx >= 0) {
        pushDecl({
          name,
          kind: 'type',
          from: ln.from + idx,
          to: ln.from + idx + name.length,
          line: li + 1,
          scope: enclosingScope(li),
          ...(ty[1] ? { exported: true } : {}),
        });
      }
      // Fields on deeper-indented lines.
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) break;
        const f = FIELD_RE.exec(body.text);
        if (!f) continue;
        const fname = f[1]!;
        const fidx = f[0].lastIndexOf(fname);
        if (fidx < 0) continue;
        pushDecl({
          name: fname,
          kind: 'field',
          from: body.from + fidx,
          to: body.from + fidx + fname.length,
          line: j + 1,
          scope: name,
        });
      }
      continue;
    }

    const en = ENUM_RE.exec(text);
    if (en) {
      const name = en[2]!;
      const idx = nameOffset(text, name, en[1] ? en[0].indexOf('enum') : 0);
      if (idx >= 0) {
        pushDecl({
          name,
          kind: 'enum',
          from: ln.from + idx,
          to: ln.from + idx + name.length,
          line: li + 1,
          scope: enclosingScope(li),
          ...(en[1] ? { exported: true } : {}),
        });
      }
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) break;
        const m = ENUM_MEMBER_RE.exec(body.text);
        if (!m) continue;
        const mname = m[1]!;
        const midx = body.text.indexOf(mname);
        if (midx < 0) continue;
        pushDecl({
          name: mname,
          kind: 'field',
          from: body.from + midx,
          to: body.from + midx + mname.length,
          line: j + 1,
          scope: name,
        });
      }
      continue;
    }

    const tuple = TUPLE_ASSIGN_RE.exec(text);
    if (tuple) {
      const scope = enclosingScope(li);
      const inner = tuple[1]!;
      const base = text.indexOf('[') + 1;
      let cursor = 0;
      for (const part of inner.split(',')) {
        const nm = part.trim();
        const at = inner.indexOf(nm, cursor);
        cursor = at + nm.length;
        if (!/^[A-Za-z_]\w*$/.test(nm) || KEYWORDS.has(nm)) continue;
        pushDecl({
          name: nm,
          kind: 'variable',
          from: ln.from + base + at,
          to: ln.from + base + at + nm.length,
          line: li + 1,
          scope,
        });
      }
      continue;
    }

    const forTuple = FOR_TUPLE_RE.exec(text);
    if (forTuple) {
      const scope = enclosingScope(li);
      const inner = forTuple[1]!;
      const base = text.indexOf('[') + 1;
      let cursor = 0;
      for (const part of inner.split(',')) {
        const nm = part.trim();
        const at = inner.indexOf(nm, cursor);
        cursor = at + nm.length;
        if (!/^[A-Za-z_]\w*$/.test(nm) || KEYWORDS.has(nm)) continue;
        pushDecl({
          name: nm,
          kind: 'variable',
          from: ln.from + base + at,
          to: ln.from + base + at + nm.length,
          line: li + 1,
          scope,
        });
      }
      continue;
    }

    const forRange = FOR_RANGE_RE.exec(text) ?? FOR_IN_RE.exec(text);
    if (forRange) {
      const nm = forRange[1]!;
      const idx = nameOffset(text, nm, forRange[0].indexOf('for') + 3);
      if (idx >= 0) {
        pushDecl({
          name: nm,
          kind: 'variable',
          from: ln.from + idx,
          to: ln.from + idx + nm.length,
          line: li + 1,
          scope: enclosingScope(li),
        });
      }
      continue;
    }

    const assign = ASSIGN_RE.exec(text);
    if (assign) {
      const nm = assign[1]!;
      if (!KEYWORDS.has(nm)) {
        const idx = assign[0].lastIndexOf(nm);
        if (idx >= 0) {
          pushDecl({
            name: nm,
            kind: 'variable',
            from: ln.from + idx,
            to: ln.from + idx + nm.length,
            line: li + 1,
            scope: enclosingScope(li),
          });
        }
      }
    }
  }

  // ── References ────────────────────────────────────────────────────────────
  const references: SymbolRef[] = [];
  let inBlock = false;
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li]!;
    const text = ln.text;
    const imp = IMPORT_RE.exec(text);
    if (imp) {
      // Library coordinates (`a/b/C`) are not identifiers; only the alias is.
      const alias = imp[1]!;
      const at = text.lastIndexOf(alias);
      if (at >= 0) {
        references.push({
          name: alias,
          from: ln.from + at,
          to: ln.from + at + alias.length,
          line: li + 1,
          kind: 'decl',
        });
      }
      continue;
    }
    let i = 0;
    let inStr: QuoteChar | null = null;
    while (i < text.length) {
      const c = text[i]!;
      const n = text[i + 1];
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
        if (isQuoteClose(inStr, c)) inStr = null;
        i += 1;
        continue;
      }
      if (isQuoteChar(c)) {
        inStr = c as QuoteChar;
        i += 1;
        continue;
      }
      if (!isIdentStart(c)) {
        i += 1;
        continue;
      }
      const start = i;
      i += 1;
      while (i < text.length && isIdentChar(text[i]!)) i += 1;
      const name = text.slice(start, i);
      const prev = start > 0 ? text[start - 1]! : '';
      if (prev === '#') continue; // hex color tail
      if (KEYWORDS.has(name)) continue;

      const from = ln.from + start;
      const to = ln.from + i;
      const member = prev === '.';
      let j = i;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j += 1;
      const next = text[j] ?? '';
      const next2 = text[j + 1] ?? '';
      const kind: SymbolRef['kind'] = declAt.has(from)
        ? 'decl'
        : member
          ? 'member'
          : next === '('
            ? 'call'
            : next === '=' && next2 !== '=' && next2 !== '>'
              ? 'write'
              : 'read';
      references.push({ name, from, to, line: li + 1, kind });
    }
  }

  const byName = new Map<string, SymbolDecl[]>();
  for (const d of declarations) {
    const list = byName.get(d.name);
    if (list) list.push(d);
    else byName.set(d.name, [d]);
  }

  return { declarations, references, byName, scopes };
}

/** Occurrence (decl or use) containing `offset`, if any. */
export function symbolAt(index: SymbolIndex, offset: number): SymbolRef | null {
  let best: SymbolRef | null = null;
  for (const ref of index.references) {
    if (offset < ref.from || offset > ref.to) continue;
    if (!best || ref.to - ref.from < best.to - best.from) best = ref;
  }
  return best;
}

/** Innermost function/type/enum body containing `offset`. */
export function scopeAt(index: SymbolIndex, offset: number): ScopeRange | null {
  let best: ScopeRange | null = null;
  for (const scope of index.scopes.values()) {
    if (offset < scope.from || offset >= scope.to) continue;
    if (!best || scope.to - scope.from < best.to - best.from) best = scope;
  }
  return best;
}

function pickDecl(
  candidates: readonly SymbolDecl[],
  offset: number,
  scope: ScopeRange | null,
): SymbolDecl | null {
  if (!candidates.length) return null;
  const inScope = scope ? candidates.filter((d) => d.scope === scope.name) : [];
  const topLevel = candidates.filter((d) => d.scope === null);
  const pool = inScope.length ? inScope : topLevel.length ? topLevel : candidates;
  const before = pool.filter((d) => d.from <= offset);
  if (before.length) return before.reduce((a, b) => (b.from > a.from ? b : a));
  return pool.reduce((a, b) => (b.from < a.from ? b : a));
}

/**
 * Declaration for the symbol at `offset`.
 * Parameters and locals win over script-level names; a later declaration
 * shadows an earlier one (Pine requires declaration before use).
 */
export function definitionOf(index: SymbolIndex, offset: number): SymbolDecl | null {
  const occ = symbolAt(index, offset);
  if (!occ) return null;
  const own = index.declarations.find((d) => d.from === occ.from);
  if (own) return own;
  const candidates = index.byName.get(occ.name);
  if (!candidates?.length) return null;
  return pickDecl(candidates, offset, scopeAt(index, offset));
}

/**
 * All occurrences of the symbol at `offset`, declaration first.
 * A scoped declaration (parameter / local) limits the result to its function.
 */
export function referencesOf(index: SymbolIndex, offset: number): SymbolRef[] {
  const occ = symbolAt(index, offset);
  if (!occ) return [];
  const decl = definitionOf(index, offset);
  const scope = decl?.scope ? index.scopes.get(decl.scope) : null;
  const hits = index.references.filter((r) => {
    if (r.name !== occ.name) return false;
    // Dotted members are a different namespace (`obj.name` vs `name`).
    if (r.kind === 'member' && decl && decl.kind !== 'field') return false;
    if (scope && (r.from < scope.from || r.from >= scope.to)) return false;
    return true;
  });
  return hits.sort((a, b) => a.from - b.from);
}

/** Builtin namespaces (`ta`, `strategy`, `line`, …). */
const BUILTIN_NAMESPACES = new Set(
  [...BUILTIN_NAMES].filter((k) => k.includes('.')).map((k) => k.slice(0, k.indexOf('.'))),
);

/** True when `name` is a PYNE builtin name or namespace. */
export function isBuiltinName(name: string): boolean {
  if (BUILTIN_NAMES.has(name) || BUILTIN_NAMESPACES.has(name)) return true;
  if (!name.includes('.')) return BUILTIN_NAMES.has(`ta.${name}`);
  return false;
}

export type RenamePlan =
  | { ok: true; name: string; edits: Array<{ from: number; to: number }> }
  | { ok: false; reason: string };

const RENAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Plan a rename of the symbol at `offset`.
 * Rejects builtins, keywords, invalid identifiers and member renames (a field
 * name is shared by every value of its type, so a flat edit list is unsafe).
 */
export function planRename(index: SymbolIndex, offset: number, newName: string): RenamePlan {
  const decl = definitionOf(index, offset);
  if (!decl) return { ok: false, reason: 'No user declaration under the cursor.' };
  if (decl.kind === 'field') {
    return { ok: false, reason: 'Renaming type / enum members is not supported yet.' };
  }
  if (decl.kind === 'import')
    return { ok: false, reason: 'Rename the library alias in its import line.' };
  if (decl.name === newName) return { ok: false, reason: 'That is already the name.' };
  if (!RENAME_RE.test(newName)) {
    return {
      ok: false,
      reason: 'Use letters, digits and underscores (cannot start with a digit).',
    };
  }
  if (KEYWORDS.has(newName)) return { ok: false, reason: `'${newName}' is a Pine keyword.` };
  if (isBuiltinName(newName)) return { ok: false, reason: `'${newName}' is a builtin name.` };
  const taken = index.byName.get(newName);
  if (taken?.some((d) => d.scope === decl.scope)) {
    return { ok: false, reason: `'${newName}' is already declared in this scope.` };
  }

  const seen = new Set<number>();
  const edits: Array<{ from: number; to: number }> = [];
  for (const ref of referencesOf(index, offset)) {
    if (seen.has(ref.from)) continue;
    seen.add(ref.from);
    edits.push({ from: ref.from, to: ref.to });
  }
  if (!edits.length) return { ok: false, reason: 'No occurrences to rename.' };
  return { ok: true, name: decl.name, edits };
}

/** True when a source offset sits inside a string or comment. */
export function isInLiteral(source: string, offset: number): boolean {
  let inStr: QuoteChar | null = null;
  let inBlock = false;
  for (let i = 0; i < offset && i < source.length; i++) {
    const c = source[i]!;
    const n = source[i + 1];
    if (inStr) {
      if (c === '\\') i += 1;
      else if (c === '\n' || isQuoteClose(inStr, c)) inStr = null;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
      continue;
    }
    if (c === '/' && n === '/') {
      const nl = source.indexOf('\n', i);
      if (nl < 0 || nl >= offset) return true;
      i = nl;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 1;
    }
  }
  return inStr !== null || inBlock;
}
