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
 * Lightweight **Pine Script™ autoformatter** for the AXIS editor.
 *
 * Strategy (safe + predictable for indentation-significant Pine):
 * 1. Expand tabs → spaces, strip trailing whitespace
 * 2. Normalize leading indent to multiples of `indentSize` (preserve relative depth)
 * 3. Align `else` / `else if` with the nearest open `if` when they were over-indented
 * 4. Collapse excess blank lines; ensure a single trailing newline
 * 5. Keep `//@version` / compiler directives at column 0
 * 6. Leave lines that continue a multiline string / `/*` block untouched
 *
 * Does not reflow expressions or wrap long lines.
 *
 * @module editor/pine-format
 */

import {
  advancePineLineState,
  defaultPineHighlightState,
} from './pyne-language';

export type PineFormatOptions = {
  /** Spaces per indent level (default 4 — Pine convention). */
  indentSize?: number;
  /** Max consecutive blank lines kept (default 1). */
  maxBlankLines?: number;
};

const OUTDENT_ELSE = /^(?:else(?:\s+if)?)\b/i;
const OPENS_IF = /^if\b/i;
const DIRECTIVE = /^\/\/@/;

function expandTabs(line: string, tabW: number): string {
  let out = '';
  for (const ch of line) {
    if (ch === '\t') {
      const n = tabW - (out.length % tabW);
      out += ' '.repeat(n);
    } else {
      out += ch;
    }
  }
  return out;
}

function countLeadingSpaces(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n += 1;
  return n;
}

/**
 * Format Pine source. Pure function — does not touch the editor.
 */
export function formatPineSource(
  source: string,
  opts: PineFormatOptions = {},
): string {
  const indentSize = Math.max(1, Math.min(8, opts.indentSize ?? 4));
  const maxBlank = Math.max(0, Math.min(4, opts.maxBlankLines ?? 1));
  const pad = ' '.repeat(indentSize);

  const raw = String(source ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');

  /** Stack of indent levels for open `if` blocks (for else alignment). */
  const ifStack: number[] = [];
  const formatted: string[] = [];
  let blankRun = 0;
  let scan = defaultPineHighlightState();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? '';
    const startedInLiteral = Boolean(scan.stringQuote || scan.inBlockComment);
    scan = advancePineLineState(rawLine, scan);

    if (startedInLiteral) {
      formatted.push(rawLine.replace(/\t/g, pad));
      blankRun = rawLine.trim() ? 0 : blankRun + 1;
      continue;
    }

    let line = expandTabs(rawLine, indentSize);
    line = line.replace(/[ \t]+$/g, '');

    if (!line.trim()) {
      blankRun += 1;
      if (blankRun <= maxBlank) formatted.push('');
      continue;
    }
    blankRun = 0;

    const trimmed = line.trimStart();

    // Compiler directives stay flush left
    if (DIRECTIVE.test(trimmed)) {
      formatted.push(trimmed);
      ifStack.length = 0;
      continue;
    }

    let spaces = countLeadingSpaces(line);
    let level = Math.round(spaces / indentSize);
    // Snap stray 1–2 space indents toward nearest level
    if (spaces > 0 && spaces < indentSize) level = 1;
    level = Math.max(0, level);

    // Align else / else if with nearest if when over-indented
    if (OUTDENT_ELSE.test(trimmed) && ifStack.length) {
      const target = ifStack[ifStack.length - 1]!;
      if (level > target) level = target;
      // else closes one if; else if keeps a frame
      if (/^else\s+if\b/i.test(trimmed)) {
        ifStack[ifStack.length - 1] = level;
      } else {
        ifStack.pop();
      }
    } else if (OPENS_IF.test(trimmed)) {
      ifStack.push(level);
    } else {
      // Pop ifs that are deeper than current line (left of previous if body)
      while (ifStack.length && level <= ifStack[ifStack.length - 1]!) {
        ifStack.pop();
      }
    }

    formatted.push(pad.repeat(level) + trimmed);
  }

  // Trim leading blanks; collapse trailing blanks to one EOF newline
  while (formatted.length && formatted[0] === '') formatted.shift();
  while (
    formatted.length > 1 &&
    formatted[formatted.length - 1] === '' &&
    formatted[formatted.length - 2] === ''
  ) {
    formatted.pop();
  }

  if (!formatted.length) return '\n';
  let result = formatted.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return result;
}

/** True when {@link formatPineSource} would change the document. */
export function pineSourceNeedsFormat(
  source: string,
  opts?: PineFormatOptions,
): boolean {
  return formatPineSource(source, opts) !== String(source ?? '');
}
