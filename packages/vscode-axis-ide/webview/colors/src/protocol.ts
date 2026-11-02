// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Local Colors webview messages. Not part of axis.webview.v1.
 * Host posts `{ type: 'colors.set', colors, sourceLabel }`.
 * Webview posts `colors.ready` and `colors.reveal`.
 */

export interface ColorRow {
  line: number;
  column: number;
  raw: string;
  swatch: string;
}

export interface ColorsViewState {
  colors: ColorRow[];
  sourceLabel: string;
}

const SAFE_SWATCH =
  /^(?:#[0-9A-Fa-f]{3}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (?:0|1|0\.\d{1,3})\))$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True when the swatch is safe to assign to `element.style.backgroundColor`. */
export function isSafeSwatch(value: string): boolean {
  return SAFE_SWATCH.test(value);
}

function rowFrom(value: unknown): ColorRow | null {
  if (!isPlainObject(value)) return null;
  const line = value.line;
  const column = value.column;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) return null;
  if (typeof column !== 'number' || !Number.isInteger(column) || column < 1) return null;
  if (typeof value.raw !== 'string' || value.raw.length === 0) return null;
  if (typeof value.swatch !== 'string' || value.swatch.length === 0) return null;
  return { line, column, raw: value.raw, swatch: value.swatch };
}

/** Never-throw decode of host `colors.set`. */
export function decodeColorsSet(raw: unknown): ColorsViewState | null {
  if (!isPlainObject(raw) || raw.type !== 'colors.set') return null;
  const sourceLabel = typeof raw.sourceLabel === 'string' ? raw.sourceLabel : '';
  const colors: ColorRow[] = [];
  if (Array.isArray(raw.colors)) {
    for (const item of raw.colors) {
      const row = rowFrom(item);
      if (row) colors.push(row);
    }
  }
  return { colors, sourceLabel };
}

export function encodeColorsReady(): { type: 'colors.ready' } {
  return { type: 'colors.ready' };
}

export function encodeColorsReveal(line: number): { type: 'colors.reveal'; line: number } {
  return { type: 'colors.reveal', line };
}
