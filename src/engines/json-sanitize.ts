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
 * Shared parser for engine **response bodies** (REST `/run` and WS frames).
 *
 * Python's `json.dumps` can emit bare `NaN` / `Infinity` / `-Infinity`, which
 * are not valid JSON. Both transports must normalize them the same way, but
 * only *outside* string literals: a plot title or error message that contains
 * the word `NaN` must survive untouched (the old global regex rewrote it).
 *
 * @module engines/json-sanitize
 */

/**
 * One alternation, applied left-to-right: a complete JSON string literal is
 * matched first and returned verbatim; bare non-finite tokens are replaced.
 * The string branch is unrolled (`[^"\\]*(?:\\.[^"\\]*)*`) to avoid
 * catastrophic backtracking on multi-megabyte payloads.
 */
const NON_FINITE_OR_STRING =
  /"[^"\\]*(?:\\.[^"\\]*)*"|-Infinity\b|\bInfinity\b|\bNaN\b/g;

/**
 * Replace bare `NaN`, `Infinity` and `-Infinity` tokens with `null`.
 * Text inside JSON string literals is never modified.
 */
export function sanitizeNonFiniteJson(text: string): string {
  // Fast path: the overwhelming majority of responses contain no such token.
  if (!text.includes('NaN') && !text.includes('Infinity')) return text;
  return text.replace(NON_FINITE_OR_STRING, (match) =>
    match.charCodeAt(0) === 0x22 /* " */ ? match : 'null',
  );
}

/**
 * Parse an engine response body after {@link sanitizeNonFiniteJson}.
 * Throws `SyntaxError` on invalid JSON (same contract as `JSON.parse`).
 */
export function parseEngineJson(text: string): unknown {
  return JSON.parse(sanitizeNonFiniteJson(text));
}
