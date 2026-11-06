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
 * Dedicated Web Worker for off-thread engine-response JSON parsing.
 *
 * Runs the same sanitizer as the sync path so bare `NaN`/`Infinity` tokens
 * emitted by Python's `json.dumps` are still normalized to `null`, without
 * blocking the main thread on multi-megabyte payloads.
 *
 * @module engines/json-parse-worker
 */

import { sanitizeNonFiniteJson } from './json-sanitize';

interface ParseMessage {
  id: number;
  text: string;
}

interface ParseResponse {
  id: number;
  result?: unknown;
  error?: string;
}

// A dedicated worker's `globalThis` exposes this surface; `lib.dom` types
// `postMessage` as `Window.postMessage(message, targetOrigin)`, which this scope
// never calls that way.
const workerSelf = globalThis as {
  onmessage?: ((event: MessageEvent<ParseMessage>) => void) | null;
  postMessage: (message: ParseResponse) => void;
};

workerSelf.onmessage = (event: MessageEvent<ParseMessage>) => {
  const { id, text } = event.data ?? {};
  try {
    const result = JSON.parse(sanitizeNonFiniteJson(typeof text === 'string' ? text : ''));
    workerSelf.postMessage({ id, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    workerSelf.postMessage({ id, error });
  }
};
