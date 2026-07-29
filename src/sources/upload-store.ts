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
 * In-memory stash for user-uploaded OHLCV used by the `csv-upload` source.
 *
 * Decoupled from legacy `state.js` so the Solid store, file pickers, and
 * source plugins share one place. Not persisted across reloads — callers
 * re-parse via `parse-bars` on each upload.
 *
 * ## Contract
 *
 * - {@link setUploadedBars} — store bars (+ optional display name)
 * - {@link getUploadedBars} — bars for `csv-upload.fetchHistorical`, or `null`
 * - {@link getUploadedFileName} — UI label in load telemetry
 * - {@link clearUploadedBars} — reset after user clears upload
 *
 * @module sources/upload-store
 * @see {@link parseOhlcvFile} in `data/parse-bars`
 */

import type { Bar } from '../store/types';

let uploadedBars: Bar[] | null = null;
let uploadedName: string | null = null;

/** Replace the uploaded series. Empty array clears the stash. */
export function setUploadedBars(bars: Bar[], fileName?: string) {
  uploadedBars = bars.length ? bars : null;
  uploadedName = fileName || null;
}

/** Current bars, or `null` when nothing has been uploaded. */
export function getUploadedBars(): Bar[] | null {
  return uploadedBars;
}

/** Original file name for status / telemetry labels. */
export function getUploadedFileName(): string | null {
  return uploadedName;
}

/** Drop bars and file name. */
export function clearUploadedBars() {
  uploadedBars = null;
  uploadedName = null;
}
