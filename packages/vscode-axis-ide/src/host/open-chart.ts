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
 * `axis.openChart` — sibling `*.axis.json` beside the active Pine buffer (Q1 / Task 08).
 */

import {
  defaultChartDocument,
  serializeChartDocument,
  type AxisChartDocV1,
} from '../editors/chart-document';
import { MOCK_BARS_DEFAULT, clampMockBarCount } from './mock-bars';

/** PYNE / Pine Script™ language id contributed by `hoox-sh.pyne`. */
export const PINE_LANGUAGE_ID = 'pinescript';

/** Filename suffixes treated as Pine sources (activation globs + sibling helper). */
export const PINE_FILE_SUFFIXES = [
  '.pyne',
  '.pine',
  '.pinev5',
  '.pinev6',
  '.pinescript',
] as const;

export const OPEN_CHART_NO_PINE_MESSAGE =
  'AXIS: Open Chart needs an active Pine Script™ file (.pyne / .pine). Open a script, then run the command again.';

export interface SiblingChartOptions {
  /** Copied from `axis.chart.historyBars` so the setting wins on new siblings. */
  historyBars?: number;
}

/**
 * True when the path ends with a known Pine suffix (case-insensitive).
 */
export function isPineFilePath(filePath: string): boolean {
  const lower = String(filePath ?? '').toLowerCase();
  return PINE_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/**
 * Map `rsi.pyne` → `rsi.axis.json` (same directory, stem + `.axis.json`).
 * Returns null when the path is not a Pine source.
 */
export function siblingAxisJsonPath(pinePath: string): string | null {
  const path = String(pinePath ?? '');
  const lower = path.toLowerCase();
  const suffix = PINE_FILE_SUFFIXES.find((s) => lower.endsWith(s));
  if (!suffix) return null;
  const stem = path.slice(0, path.length - suffix.length);
  if (!stem) return null;
  return `${stem}.axis.json`;
}

/** Default chart doc for a new sibling, optionally linking the Pine basename. */
export function defaultChartDocumentForPine(
  pineFileName: string,
  opts?: SiblingChartOptions,
): AxisChartDocV1 {
  const base = defaultChartDocument();
  const historyBars =
    typeof opts?.historyBars === 'number' && Number.isFinite(opts.historyBars) && opts.historyBars > 0
      ? clampMockBarCount(opts.historyBars)
      : MOCK_BARS_DEFAULT;
  const name = String(pineFileName ?? '').trim();
  if (!name) {
    return { ...base, historyBars };
  }
  const id = name.replace(/\.[^.]+$/, '') || name;
  return {
    ...base,
    historyBars,
    symbol: base.symbol || 'BTC/USDT',
    exchange: base.exchange || 'binance',
    source: base.source || 'binance',
    scripts: [{ id, uri: `./${name}`, inputs: {} }],
  };
}

/** Serialize bytes for a new sibling chart workspace. */
export function serializeSiblingChartDocument(
  pineFileName: string,
  opts?: SiblingChartOptions,
): Uint8Array {
  const text = serializeChartDocument(defaultChartDocumentForPine(pineFileName, opts));
  return new TextEncoder().encode(text);
}

/**
 * Pure plan for openChart create-or-open (unit-testable without VS Code fs).
 * Existing siblings are opened as-is (not rewritten).
 */
export function planSiblingChartOpen(input: {
  pinePath: string;
  pineFileName: string;
  siblingExists: boolean;
  historyBarsSetting?: number;
}):
  | { ok: true; siblingPath: string; writeBytes: Uint8Array | null }
  | { ok: false; error: string } {
  try {
    if (!isPineFilePath(input.pinePath)) {
      return { ok: false, error: OPEN_CHART_NO_PINE_MESSAGE };
    }
    const siblingPath = siblingAxisJsonPath(input.pinePath);
    if (!siblingPath) {
      return { ok: false, error: OPEN_CHART_NO_PINE_MESSAGE };
    }
    if (input.siblingExists) {
      return { ok: true, siblingPath, writeBytes: null };
    }
    const writeBytes = serializeSiblingChartDocument(input.pineFileName, {
      historyBars: input.historyBarsSetting,
    });
    return { ok: true, siblingPath, writeBytes };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `AXIS: Open Chart failed: ${message}` };
  }
}
