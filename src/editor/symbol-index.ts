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
 * innermost enclosing function body. Every reference is resolved to the
 * declaration it actually names (parameters/locals shadow script-level names,
 * `obj.field` resolves through the receiver's declared type), so references
 * and rename stay inside the right symbol even when names collide across
 * scopes or types.
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
  /** Declared type (`Point`, `array<float>`, `float`, …) when the source names one. */
  typeName?: string;
  exported?: boolean;
}

/** One occurrence (declaration or use). */
export interface SymbolRef {
  name: string;
  from: number;
  to: number;
  line: number;
  kind: 'decl' | 'call' | 'read' | 'write' | 'member';
  /** Declaration this occurrence resolves to; null for builtins / ambiguous members. */
  decl: SymbolDecl | null;
  /** Receiver identifier for member occurrences (`p` in `p.price`). */
  receiver?: { name: string; from: number };
  /** Declaration of that receiver (null when builtin / unknown). */
  receiverDecl?: SymbolDecl | null;
}

export interface ScopeRange {
  /** Function / type / enum name. */
  name: string;
  /** Body start (first line after the header). */
  from: number;
  /** Body end (exclusive, except at EOF where it is one past the last character). */
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
  /^\s*(?:export\s+)?(?:(?:var|varip)\s+)?(?:(?:simple|series|const)\s+)?(?:([A-Za-z_][\w.<>[\] ,]*?)\s+)?([A-Za-z_]\w*)\s*=(?![=>])/;
/** Field line inside a `type` body (`    float price`), with optional default / comment. */
const FIELD_RE =
  /^\s+(?:(?:series|simple|const)\s+)?([A-Za-z_][\w.]*(?:<[^=<>]*>)?(?:\[\])?)\s+([A-Za-z_]\w*)\s*(?:=.*)?(?:\s*(?:\/\/.*|\/\*.*\*\/))?$/;
/** Enum member line (`    BUY`), with optional value / comment. */
const ENUM_MEMBER_RE = /^\s+([A-Za-z_]\w*)\s*(?:=.*)?(?:\s*(?:\/\/.*|\/\*.*\*\/))?$/;

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

/** Per-line parser state at the *start* of the line. */
interface LineScan {
  /** Paren / bracket / brace depth carried in from previous lines. */
  depth: number;
  /** True when the line starts inside a block comment. */
  inBlock: boolean;
}

/**
 * One cheap pass over the source so the declaration parser can skip lines that
 * continue a call / array literal or sit inside a block comment. The reference
 * parser tracks the same state itself while it indexes identifiers.
 */
function lineScans(lines: readonly LineSpan[]): LineScan[] {
  const out: LineScan[] = [];
  let depth = 0;
  let inBlock = false;
  for (const ln of lines) {
    out.push({ depth, inBlock });
    let inStr: QuoteChar | null = null;
    const text = ln.text;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (inStr) {
        if (c === '\\') i += 1;
        else if (isQuoteClose(inStr, c)) inStr = null;
        continue;
      }
      if (inBlock) {
        if (c === '*' && text[i + 1] === '/') {
          inBlock = false;
          i += 1;
        }
        continue;
      }
      if (c === '/' && text[i + 1] === '/') break;
      if (c === '/' && text[i + 1] === '*') {
        inBlock = true;
        i += 1;
        continue;
      }
      if (isQuoteChar(c)) {
        inStr = c as QuoteChar;
        continue;
      }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    }
  }
  return out;
}

/**
 * Replace `//…` and `/*…*\/` content with spaces, preserving offsets.
 * Used on function headers so a comment between parameters cannot be mistaken
 * for a parameter name or a type.
 */
function maskComments(text: string): string {
  let out = '';
  let inStr: QuoteChar | null = null;
  let inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 1;
      } else if (isQuoteClose(inStr, c)) {
        inStr = null;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        out += '  ';
        i += 1;
        inBlock = false;
      } else {
        out += ' ';
      }
      continue;
    }
    if (c === '/' && n === '/') {
      out += '  ';
      i += 1;
      while (i + 1 < text.length && text[i + 1] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  ';
      i += 1;
      inBlock = true;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
      out += c;
      continue;
    }
    out += c;
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

/** Strip qualifiers from a type annotation (`series float` → `float`). */
function typeNameOf(prefix: string): string | undefined {
  const cleaned = prefix.replace(/^(?:(?:simple|series|const)\s+)+/, '').trim();
  return cleaned || undefined;
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
    const typeName = typeNameOf(part.text.slice(0, ident.at));
    out.push({
      name: ident.name,
      kind: 'parameter',
      from: headerFrom + part.at + ident.at,
      to: headerFrom + part.at + ident.at + ident.name.length,
      line,
      scope: fnName,
      ...(typeName ? { typeName } : {}),
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
 * One pass over lines for declarations, one for references, then one
 * resolution pass so every occurrence knows its declaration.
 */
export function buildSymbolIndex(source: string): SymbolIndex {
  const src = String(source ?? '');
  const lines = lineSpans(src);
  const scans = lineScans(lines);
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
      // Closing line of a multi-line header (`) =>`) — keep walking to the header.
      if (/^\s*\)\s*=>/.test(ln.text)) continue;
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
    // Continuation of a call / array literal, or commented-out code.
    if (scans[li]!.inBlock || scans[li]!.depth > 0) continue;

    const imp = IMPORT_RE.exec(text);
    if (imp) {
      const name = imp[1]!;
      // The alias is the last token of the match; do not search the line (a
      // trailing comment may repeat it).
      const idx = imp[0].length - name.length;
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
        for (const c of maskComments(header)) {
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
      const parseHeader = maskComments(header);
      if (!/\)\s*=>/.test(parseHeader)) continue;
      const idx = nameOffset(text, name, text.indexOf('(') - name.length);
      if (idx < 0) continue;
      const kind: SymbolKind = fn[2] ? 'method' : 'function';
      const params = paramDecls(parseHeader, ln.from, name, li + 1);
      // A method's first parameter is its receiver (`method foo(Point this)`).
      const methodType = kind === 'method' ? params[0]?.typeName : undefined;
      pushDecl({
        name,
        kind,
        from: ln.from + idx,
        to: ln.from + idx + name.length,
        line: li + 1,
        scope: enclosingScope(li),
        ...(methodType ? { typeName: methodType } : {}),
        ...(fn[1] ? { exported: true } : {}),
      });
      for (const p of params) pushDecl(p);
      // Body range: lines after the (possibly multi-line) header indented deeper.
      let bodyEnd = src.length + 1;
      for (let j = endLine + 1; j < lines.length; j++) {
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
      let lastBodyLine = li;
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) break;
        lastBodyLine = j;
        if (scans[j]!.inBlock || scans[j]!.depth > 0) continue;
        const f = FIELD_RE.exec(body.text);
        if (!f) continue;
        const ftype = f[1]!;
        const fname = f[2]!;
        const typeAt = f[0].indexOf(ftype);
        const fidx = typeAt >= 0 ? f[0].indexOf(fname, typeAt + ftype.length) : -1;
        if (fidx < 0) continue;
        pushDecl({
          name: fname,
          kind: 'field',
          from: body.from + fidx,
          to: body.from + fidx + fname.length,
          line: j + 1,
          scope: name,
          typeName: ftype,
        });
      }
      // Body end for scope lookups (type fields / nested member chains).
      let bodyEnd = src.length + 1;
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) {
          bodyEnd = body.from;
          break;
        }
      }
      scopes.set(name, { name, from: ln.from, to: bodyEnd });
      li = lastBodyLine;
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
      let lastBodyLine = li;
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) break;
        lastBodyLine = j;
        if (scans[j]!.inBlock || scans[j]!.depth > 0) continue;
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
      let bodyEnd = src.length + 1;
      for (let j = li + 1; j < lines.length; j++) {
        const body = lines[j]!;
        if (!body.text.trim()) continue;
        if (body.indent <= ln.indent) {
          bodyEnd = body.from;
          break;
        }
      }
      scopes.set(name, { name, from: ln.from, to: bodyEnd });
      li = lastBodyLine;
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
      const typeName = assign[1]?.trim();
      const nm = assign[2]!;
      if (!KEYWORDS.has(nm)) {
        const idx = assign[0].lastIndexOf(nm);
        if (idx >= 0) {
          // `p = Point.new()` gives the receiver a type without an annotation.
          const ctor = /^\s*([A-Za-z_]\w*)\s*\.\s*new\s*\(/.exec(text.slice(assign[0].length));
          const inferred = typeName || ctor?.[1];
          pushDecl({
            name: nm,
            kind: 'variable',
            from: ln.from + idx,
            to: ln.from + idx + nm.length,
            line: li + 1,
            scope: enclosingScope(li),
            ...(inferred ? { typeName: inferred } : {}),
          });
        }
      }
    }
  }

  // ── References ────────────────────────────────────────────────────────────
  const references: SymbolRef[] = [];
  let inBlock = false;
  let depth = 0;
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li]!;
    const text = ln.text;
    // Skip commented-out / continuation imports just like the declaration pass.
    const imp = !inBlock && depth === 0 ? IMPORT_RE.exec(text) : null;
    let i = 0;
    if (imp) {
      // Library coordinates (`a/b/C`) are not identifiers; only the alias is.
      const alias = imp[1]!;
      const at = imp[0].length - alias.length;
      if (at >= 0) {
        references.push({
          name: alias,
          from: ln.from + at,
          to: ln.from + at + alias.length,
          line: li + 1,
          kind: 'decl',
          decl: null,
        });
      }
      // Keep scanning the rest of the line so a trailing block comment updates state.
      i = imp[0].length;
    }
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
      if (c === '(' || c === '[' || c === '{') {
        depth += 1;
        i += 1;
        continue;
      }
      if (c === ')' || c === ']' || c === '}') {
        depth = Math.max(0, depth - 1);
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
      const prevChar = start > 0 ? text[start - 1]! : '';
      if (prevChar === '#') continue; // hex color tail
      if (prevChar >= '0' && prevChar <= '9') continue; // numeric literal tail (`1e10`, `0xFF`)
      if (KEYWORDS.has(name)) continue;

      const from = ln.from + start;
      const to = ln.from + i;
      let dot = start - 1;
      while (dot >= 0 && (text[dot] === ' ' || text[dot] === '\t')) dot -= 1;
      const member = dot >= 0 && text[dot] === '.';
      let j = i;
      while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j += 1;
      const next = text[j] ?? '';
      const next2 = text[j + 1] ?? '';
      const isDecl = declAt.has(from);
      // `qty = qty` inside a call is a named argument, not a variable write.
      if (!isDecl && !member && depth > 0 && next === '=' && next2 !== '=' && next2 !== '>') {
        continue;
      }
      const kind: SymbolRef['kind'] = isDecl
        ? 'decl'
        : member
          ? 'member'
          : next === '('
            ? 'call'
            : (next === '=' && next2 !== '=' && next2 !== '>') || (next === ':' && next2 === '=')
              ? 'write'
              : 'read';

      let receiver: SymbolRef['receiver'];
      if (member) {
        let k = start - 1;
        while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k -= 1;
        if (text[k] === '.') {
          k -= 1;
          while (k >= 0 && (text[k] === ' ' || text[k] === '\t')) k -= 1;
          const end = k + 1;
          while (k >= 0 && isIdentChar(text[k]!)) k -= 1;
          const rStart = k + 1;
          if (end > rStart && isIdentStart(text[rStart]!)) {
            receiver = { name: text.slice(rStart, end), from: ln.from + rStart };
          }
        }
      }
      references.push({
        name,
        from,
        to,
        line: li + 1,
        kind,
        decl: null,
        ...(receiver ? { receiver } : {}),
      });
    }
  }

  const byName = new Map<string, SymbolDecl[]>();
  for (const d of declarations) {
    const list = byName.get(d.name);
    if (list) list.push(d);
    else byName.set(d.name, [d]);
  }

  // ── Resolution ────────────────────────────────────────────────────────────
  const refByFrom = new Map<number, SymbolRef>();
  for (const ref of references) refByFrom.set(ref.from, ref);
  // Scopes are inserted in source order; sweep them alongside the (sorted)
  // references instead of scanning every scope for every occurrence.
  const scopeList = [...scopes.values()].sort((a, b) => a.from - b.from);
  const activeScopes: ScopeRange[] = [];
  let scopeCursor = 0;
  for (const ref of references) {
    while (scopeCursor < scopeList.length && scopeList[scopeCursor]!.from <= ref.from) {
      activeScopes.push(scopeList[scopeCursor]!);
      scopeCursor += 1;
    }
    while (activeScopes.length && activeScopes[activeScopes.length - 1]!.to <= ref.from) {
      activeScopes.pop();
    }
    const scope = activeScopes.length ? activeScopes[activeScopes.length - 1]! : null;
    ref.decl = resolveRef(ref, declAt, byName, scope, refByFrom);
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

function scopeAtRanges(scopes: ReadonlyMap<string, ScopeRange>, offset: number): ScopeRange | null {
  let best: ScopeRange | null = null;
  for (const scope of scopes.values()) {
    if (offset < scope.from || offset >= scope.to) continue;
    if (!best || scope.to - scope.from < best.to - best.from) best = scope;
  }
  return best;
}

/** Innermost function/type/enum body containing `offset`. */
export function scopeAt(index: SymbolIndex, offset: number): ScopeRange | null {
  return scopeAtRanges(index.scopes, offset);
}

/** Nearest declaration before `offset`, else the earliest one. */
function pickNearest(candidates: readonly SymbolDecl[], offset: number): SymbolDecl | null {
  if (!candidates.length) return null;
  let best: SymbolDecl | null = null;
  for (const d of candidates) {
    if (d.from > offset) continue;
    if (!best || d.from > best.from) best = d;
  }
  if (best) return best;
  for (const d of candidates) {
    if (!best || d.from < best.from) best = d;
  }
  return best;
}

/**
 * Resolve a dotted member through the receiver's declared type when possible.
 * With no type information, a single field / method candidate is used; several
 * candidates resolve to null rather than jumping to an unrelated type.
 */
function resolveMember(
  ref: SymbolRef,
  candidates: readonly SymbolDecl[],
  refByFrom: ReadonlyMap<number, SymbolRef>,
): SymbolDecl | null {
  const fields = candidates.filter((d) => d.kind === 'field');
  const methods = candidates.filter((d) => d.kind === 'method');
  if (!fields.length && !methods.length) return null;

  const recvRef = ref.receiver ? refByFrom.get(ref.receiver.from) : undefined;
  const recvDecl = recvRef?.decl ?? null;
  ref.receiverDecl = recvDecl;
  const receiverType =
    recvDecl?.typeName ??
    (recvDecl?.kind === 'type' || recvDecl?.kind === 'enum' ? recvDecl.name : undefined);

  if (receiverType) {
    const field = fields.find((d) => d.scope === receiverType);
    if (field) return field;
    // Only fall back to an untyped method (legacy `method foo(this, …)`).
    const method =
      methods.find((d) => d.typeName === receiverType) ??
      (methods.length === 1 && !methods[0]!.typeName ? methods[0]! : undefined);
    return method ?? null;
  }

  const fieldScopes = new Set(fields.map((d) => d.scope));
  if (fieldScopes.size === 1) return fields[0]!;
  if (!fields.length && methods.length === 1) return methods[0]!;
  return null;
}

/** Resolve one occurrence to the declaration it names. */
function resolveRef(
  ref: SymbolRef,
  declAt: ReadonlyMap<number, SymbolDecl>,
  byName: ReadonlyMap<string, SymbolDecl[]>,
  scope: ScopeRange | null,
  refByFrom: ReadonlyMap<number, SymbolRef>,
): SymbolDecl | null {
  const own = declAt.get(ref.from);
  if (own) return own;
  const candidates = byName.get(ref.name);
  if (!candidates?.length) return null;
  if (ref.kind === 'member') return resolveMember(ref, candidates, refByFrom);

  const inScope = scope ? candidates.filter((d) => d.scope === scope.name) : [];
  if (inScope.length) return pickNearest(inScope, ref.from);
  const topLevel = candidates.filter((d) => d.scope === null);
  if (topLevel.length) return pickNearest(topLevel, ref.from);
  return pickNearest(candidates, ref.from);
}

/**
 * Declaration for the symbol at `offset`.
 * Parameters and locals win over script-level names; `obj.field` resolves
 * through the receiver's declared type.
 */
export function definitionOf(index: SymbolIndex, offset: number): SymbolDecl | null {
  return symbolAt(index, offset)?.decl ?? null;
}

/**
 * All occurrences of the symbol at `offset`, declaration first.
 * Occurrences are matched by the declaration they resolve to, so shadowed
 * names and same-named fields on different types stay apart.
 */
export function referencesOf(index: SymbolIndex, offset: number): SymbolRef[] {
  const occ = symbolAt(index, offset);
  if (!occ) return [];
  const decl = occ.decl;
  const hits = index.references.filter((r) => {
    if (r.name !== occ.name) return false;
    if (decl) return r.decl === decl;
    // Unresolved builtin / ambiguous member: keep its own receiver namespace.
    if (occ.kind === 'member') {
      return (
        r.kind === 'member' &&
        r.receiver?.name === occ.receiver?.name &&
        r.receiverDecl === occ.receiverDecl
      );
    }
    return r.kind !== 'member' && r.decl === null;
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
 * Rejects builtins, keywords, invalid identifiers, type/enum members (a field
 * name is shared by every value of its type, so a flat edit list is unsafe)
 * and names that are declared or referenced in a scope the rename touches
 * (the new name would shadow / capture an existing occurrence).
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

  const refs = referencesOf(index, offset);
  if (!refs.length) return { ok: false, reason: 'No occurrences to rename.' };

  // Every scope the rename writes into (plus the declaration's own scope).
  const affectedScopes = new Set<string | null>();
  for (const ref of refs) affectedScopes.add(scopeAt(index, ref.from)?.name ?? null);
  affectedScopes.add(decl.scope);

  const taken = index.byName.get(newName);
  if (taken?.some((d) => affectedScopes.has(d.scope))) {
    return { ok: false, reason: `'${newName}' is already declared in an affected scope.` };
  }
  if (decl.kind === 'method' && taken?.some((d) => d.kind === 'field')) {
    return { ok: false, reason: `'${newName}' is already a type / enum member.` };
  }
  // A reference to the new name in an affected scope would be captured by the
  // renamed declaration (e.g. renaming `n` to `k` where `n + k` uses a global `k`).
  for (const r of index.references) {
    if (r.name !== newName) continue;
    // `obj.name` is a member access; a bare rename cannot capture it.
    if (r.kind === 'member') continue;
    const scopeName = scopeAt(index, r.from)?.name ?? null;
    if (!affectedScopes.has(scopeName)) continue;
    if (r.decl !== decl) {
      return { ok: false, reason: `Renaming to '${newName}' would shadow an existing reference.` };
    }
  }

  const seen = new Set<number>();
  const edits: Array<{ from: number; to: number }> = [];
  for (const ref of refs) {
    if (seen.has(ref.from)) continue;
    seen.add(ref.from);
    edits.push({ from: ref.from, to: ref.to });
  }
  if (!edits.length) return { ok: false, reason: 'No occurrences to rename.' };
  return { ok: true, name: decl.name, edits };
}
