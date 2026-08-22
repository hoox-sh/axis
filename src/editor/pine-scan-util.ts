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
 * Shared char helpers for Pine source scanners.
 *
 * Copy-paste from docs / chat often uses typographic quotes (U+2018/2019/201C/201D)
 * instead of ASCII `'` / `"`. Scanners treat both as string delimiters, and a
 * left curly quote closes on its right pair (and vice versa) so a normal
 * `“hello”` does not look unclosed.
 *
 * @module editor/pine-scan-util
 */

export type QuoteChar = '"' | "'" | '\u2018' | '\u2019' | '\u201c' | '\u201d';

const QUOTE_PAIR: Record<string, string> = {
  '\u201c': '\u201d',
  '\u201d': '\u201c',
  '\u2018': '\u2019',
  '\u2019': '\u2018',
};

export function isQuoteChar(c: string): boolean {
  return c === '"' || c === "'" || c === '\u2018' || c === '\u2019' || c === '\u201c' || c === '\u201d';
}

/** True when `c` closes a string opened by `opener` (same char or curly pair). */
export function isQuoteClose(opener: string, c: string): boolean {
  return c === opener || QUOTE_PAIR[opener] === c;
}
