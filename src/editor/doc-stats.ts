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
 * Pure document / cursor stats for the editor status strip.
 * Kept free of Solid / Lucide so unit tests can import safely.
 *
 * @module editor/doc-stats
 */

/** Lines / words / characters for the status strip. */
export function countDocStats(doc: string): { lines: number; words: number; chars: number } {
  const chars = doc.length;
  const lines = doc.length === 0 ? 1 : doc.split(/\r\n|\r|\n/).length;
  const trimmed = doc.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return { lines, words, chars };
}

/** 1-based line / column at a document offset (CodeMirror `pos`). */
export function cursorLineCol(
  doc: string,
  pos: number,
): { line: number; col: number } {
  const p = Math.max(0, Math.min(Math.floor(pos), doc.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < p; i++) {
    if (doc.charCodeAt(i) === 10 /* \n */) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}
