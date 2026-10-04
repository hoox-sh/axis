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
 * Pine **function / type / enum outline** for the editor right rail.
 *
 * Pure scan of the buffer: user `foo(...) =>` definitions (including
 * `export` / `method` and multi-line headers), plus `type` / `enum`
 * declarations. Returns 1-based line numbers for jump-to-definition.
 *
 * @module editor/function-outline
 */

import { isQuoteChar, isQuoteClose, type QuoteChar } from './pine-scan-util';

/** Outline symbol kinds shown in the function tree. */
export type OutlineKind = 'function' | 'method' | 'type' | 'enum';

/** One selectable outline entry. */
export type OutlineEntry = {
  kind: OutlineKind;
  name: string;
  /** 1-based source line of the declaration header. */
  line: number;
  exported?: boolean;
  /** Optional parent type name when the entry is a method inside a `type` body. */
  parent?: string;
};

const SKIP_NAMES = new Set([
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
  'to',
  'by',
  'simple',
  'series',
  'const',
  'matrix',
  'array',
  'map',
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
  'chart',
  'indicator',
  'strategy',
  'library',
]);

const FN_HEADER_RE =
  /^\s*(export\s+)?(method\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const FN_COMPLETE_RE =
  /^\s*(export\s+)?(method\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*=>/;
const ENUM_DECL_RE = /^\s*(export\s+)?enum\s+([A-Za-z_][\w]*)\s*$/;
const TYPE_DECL_RE =
  /^\s*(export\s+)?type\s+([A-Za-z_][\w]*)(?:\s+extends\s+\S+)?\s*$/;
const FN_HEADER_START_RE = /^\s*(?:export\s+)?(?:method\s+)?[A-Za-z_][\w]*\s*\(/;

function parenDepth(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth = Math.max(0, depth - 1);
  }
  return depth;
}

/** Strip //, /* *\/, and string literals; track open block comments across lines. */
function stripCommentsAndStrings(raw: string, inBlock: { v: boolean }): string {
  let text = '';
  let i = 0;
  let inStr: QuoteChar | null = null;
  while (i < raw.length) {
    const c = raw[i]!;
    const n = raw[i + 1];
    if (inBlock.v) {
      if (c === '*' && n === '/') {
        inBlock.v = false;
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
    if (c === '/' && n === '/') break;
    if (c === '/' && n === '*') {
      inBlock.v = true;
      i += 2;
      continue;
    }
    if (isQuoteChar(c)) {
      inStr = c as QuoteChar;
      i += 1;
      continue;
    }
    text += c;
    i += 1;
  }
  return text;
}

function pushFn(
  out: OutlineEntry[],
  text: string,
  line: number,
  parent: string | undefined,
): void {
  const complete = FN_COMPLETE_RE.exec(text);
  const header = complete ?? FN_HEADER_RE.exec(text);
  if (!header) return;
  const name = header[3]!;
  if (SKIP_NAMES.has(name)) return;
  // Require `=>` somewhere in the joined header so bare calls are ignored.
  if (!/\)\s*=>/.test(text) && !complete) return;
  const exported = !!header[1];
  const isMethod = !!header[2] || !!parent;
  out.push({
    kind: isMethod ? 'method' : 'function',
    name,
    line,
    exported: exported || undefined,
    parent,
  });
}

/**
 * Collect outline entries in source order (functions, methods, types, enums).
 */
export function collectFunctionOutline(source: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const lines = String(source ?? '').split('\n');
  const inBlock = { v: false };
  let blockKind: 'enum' | 'type' | null = null;
  let blockIndent = 0;
  let blockName: string | undefined;
  let pending: { lines: string[]; startLine: number } | null = null;

  const processLine = (text: string, line: number, parent?: string): void => {
    if (/^\s*import\b/.test(text)) return;

    const enumM = ENUM_DECL_RE.exec(text);
    if (enumM) {
      const name = enumM[2]!;
      if (!SKIP_NAMES.has(name)) {
        out.push({
          kind: 'enum',
          name,
          line,
          exported: enumM[1] ? true : undefined,
        });
      }
      blockKind = 'enum';
      blockIndent = text.length - text.trimStart().length;
      blockName = name;
      return;
    }

    const typeM = TYPE_DECL_RE.exec(text);
    if (typeM) {
      const name = typeM[2]!;
      if (!SKIP_NAMES.has(name)) {
        out.push({
          kind: 'type',
          name,
          line,
          exported: typeM[1] ? true : undefined,
        });
      }
      blockKind = 'type';
      blockIndent = text.length - text.trimStart().length;
      blockName = name;
      return;
    }

    if (blockKind) {
      if (!text.trim()) return;
      const indent = text.length - text.trimStart().length;
      if (indent <= blockIndent) {
        blockKind = null;
        blockName = undefined;
      } else if (blockKind === 'enum') {
        return;
      } else {
        // Methods declared inside a type body.
        pushFn(out, text, line, blockName);
        return;
      }
    }

    pushFn(out, text, line, parent);
  };

  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1;
    const text = stripCommentsAndStrings(lines[li]!, inBlock);

    if (pending) {
      pending.lines.push(text);
      if (parenDepth(pending.lines.join('\n')) <= 0) {
        processLine(pending.lines.join('\n'), pending.startLine);
        pending = null;
      }
      continue;
    }

    if (!blockKind && FN_HEADER_START_RE.test(text) && parenDepth(text) > 0) {
      pending = { lines: [text], startLine: lineNo };
      continue;
    }

    processLine(text, lineNo);
  }

  if (pending) processLine(pending.lines.join('\n'), pending.startLine);
  return out;
}

/** Group outline entries for the tree UI (stable section order). */
export function groupOutlineEntries(entries: OutlineEntry[]): {
  kind: OutlineKind;
  label: string;
  items: OutlineEntry[];
}[] {
  const order: OutlineKind[] = ['function', 'method', 'type', 'enum'];
  const labels: Record<OutlineKind, string> = {
    function: 'Functions',
    method: 'Methods',
    type: 'Types',
    enum: 'Enums',
  };
  const buckets = new Map<OutlineKind, OutlineEntry[]>();
  for (const e of entries) {
    const list = buckets.get(e.kind) ?? [];
    list.push(e);
    buckets.set(e.kind, list);
  }
  return order
    .filter((k) => (buckets.get(k)?.length ?? 0) > 0)
    .map((k) => ({ kind: k, label: labels[k], items: buckets.get(k)! }));
}
