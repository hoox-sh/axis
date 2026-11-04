// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OHLCV CSV export for cached datasets.
 *
 * The format round-trips through the `csv-upload` source: header
 * `time,open,high,low,close,volume` with unix-second timestamps
 * (see {@link module:data/parse-bars} for the accepted input formats).
 *
 * @module ui/dsm/export-csv
 */

import type { Bar } from '../../store/types';

/** Serialize bars to CSV (`time,open,high,low,close,volume`, unix seconds). */
export function barsToCsv(bars: readonly Bar[]): string {
  const lines = ['time,open,high,low,close,volume'];
  for (const b of bars) {
    lines.push(`${b.time},${b.open},${b.high},${b.low},${b.close},${b.volume ?? 0}`);
  }
  return lines.join('\n');
}

/** Anchor-click download; the URL is revoked after the click settles. */
function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body?.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/** Download `bars` as a CSV named after the dataset. */
export function exportBarsCsv(
  bars: readonly Bar[],
  opts: { symbol: string; interval: string },
): void {
  const name = `${opts.symbol.replace(/[^A-Za-z0-9._-]+/g, '_')}_${opts.interval}.csv`;
  const blob = new Blob([barsToCsv(bars)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, name);
}
