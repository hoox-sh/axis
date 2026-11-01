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

import { perfMeasureAsync, perfMeasureSync } from '../perf/telemetry';

/**
 * Multi-kilobyte threshold for off-thread parsing. Small payloads stay on the
 * main thread to avoid worker startup latency; large batches / full windows pay
 * the serialization cost to keep the UI responsive.
 */
const ASYNC_PARSE_THRESHOLD = 256 * 1024;

/**
 * One alternation, applied left-to-right: a complete JSON string literal is
 * matched first and returned verbatim; bare non-finite tokens are replaced.
 * The string branch is unrolled (`[^"\\]*(?:\\.[^"\\]*)*`) to avoid
 * catastrophic backtracking on multi-megabyte payloads.
 */
const NON_FINITE_OR_STRING = /"[^"\\]*(?:\\.[^"\\]*)*"|-Infinity\b|\bInfinity\b|\bNaN\b/g;

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
  return perfMeasureSync('axis:parseEngineJson', () => JSON.parse(sanitizeNonFiniteJson(text)));
}

// Shared module worker for off-thread parsing. Kept alive across requests to
// avoid repeated startup cost; recreated if it terminates or errors out.
let sharedParseWorker: Worker | null = null;
let sharedParseId = 0;
const sharedParsePending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function getSharedParseWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof import.meta.url === 'undefined') return null;
  if (!sharedParseWorker) {
    try {
      const w = new Worker(new URL('./json-parse-worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (event: MessageEvent<{ id?: number; result?: unknown; error?: string }>) => {
        const { id, result, error } = event.data ?? {};
        const p = typeof id === 'number' ? sharedParsePending.get(id) : undefined;
        if (!p || typeof id !== 'number') return;
        sharedParsePending.delete(id);
        if (typeof error === 'string') p.reject(new SyntaxError(error));
        else p.resolve(result);
      };
      w.onerror = () => {
        // Worker runtime error — terminate to force a fresh worker on next call.
        try {
          sharedParseWorker?.terminate();
        } catch {
          /* ignore */
        }
        sharedParseWorker = null;
      };
      sharedParseWorker = w;
    } catch {
      sharedParseWorker = null;
    }
  }
  return sharedParseWorker;
}

/**
 * Asynchronous engine-response parser. Runs {@link JSON.parse} off the main
 * thread for payloads above the threshold, falling back to the synchronous
 * {@link parseEngineJson} for small payloads or environments without workers.
 */
export function parseEngineJsonAsync(text: string): Promise<unknown> {
  return perfMeasureAsync('axis:parseEngineJson', async () => {
    if (!text || text.length < ASYNC_PARSE_THRESHOLD) {
      return parseEngineJson(text);
    }
    const worker = getSharedParseWorker();
    if (!worker) {
      return parseEngineJson(text);
    }
    const id = ++sharedParseId;
    return new Promise<unknown>((resolve, reject) => {
      sharedParsePending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, text });
      } catch (err) {
        sharedParsePending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

/** @internal test helper — terminate shared worker and drop pending parses. */
export function _resetParseEngineJsonForTests(): void {
  if (sharedParseWorker) {
    try {
      sharedParseWorker.terminate();
    } catch {
      /* ignore */
    }
  }
  sharedParseWorker = null;
  sharedParsePending.clear();
  sharedParseId = 0;
}
