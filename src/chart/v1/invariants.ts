/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Sync invariants (concept §6.3).
 *
 * Pure checks. A positive pane skew, or any series time past the price tip,
 * is forbidden. An indicator may end earlier. Closed-bar identity is the
 * last N bars joined as text, not a clock.
 *
 * @module chart/v1/invariants
 */

export type ClosedBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

/** `seriesLast - priceLast`. Positive means the series ends after the price tip. */
export function paneAxisSkew(priceLast: number | null, seriesLast: number | null): number | null {
  if (!finite(priceLast) || !finite(seriesLast)) return null;
  return seriesLast - priceLast;
}

/** Greatest time strictly after `priceLast`, ignoring non-finite times. */
export function seriesPastTip(priceLast: number | null, times: readonly number[]): number | null {
  if (!finite(priceLast)) return null;
  let past: number | null = null;
  for (const time of times) {
    if (!Number.isFinite(time) || time <= priceLast) continue;
    if (past == null || time > past) past = time;
  }
  return past;
}

/** How many bars the longest plot column extends past the price axis. Shorter is fine. */
export function plotOverhang(barCount: number, lengths: readonly number[]): number {
  let over = 0;
  for (const length of lengths) {
    if (!Number.isFinite(length) || length <= barCount) continue;
    const extra = length - barCount;
    if (extra > over) over = extra;
  }
  return over;
}

const syncWarned = new Set<string>();

/** Dev warns every new overhang. Prod samples about 1 in 32, once per size. */
export function noteSyncSample(
  barCount: number,
  lengths: readonly number[],
  opts?: { dev?: boolean; rand?: number; warn?: (message: string) => void },
): void {
  const over = plotOverhang(barCount, lengths);
  if (over <= 0) return;
  const dev = opts?.dev === true;
  const rand = opts?.rand ?? Math.random();
  if (!dev && rand >= 1 / 32) return;
  const key = String(over);
  if (syncWarned.has(key)) return;
  syncWarned.add(key);
  const warn = opts?.warn ?? ((message: string) => console.warn(message));
  warn(`[axis] plot column is ${over} bars past the price axis`);
}

export function _resetSyncSampleForTests(): void {
  syncWarned.clear();
}

/** Largest absolute gap between `barCount` and a plot column length. */
export function plotLengthSkew(barCount: number, lengths: readonly number[]): number {
  let skew = 0;
  for (const length of lengths) {
    const gap = Math.abs(barCount - length);
    if (gap > skew) skew = gap;
  }
  return skew;
}

/** Last `n` closed bars (default 8) as `time:open:high:low:close` joined by `|`. */
export function closedBarHash(bars: readonly ClosedBar[], n = 8): string {
  if (bars.length === 0) return '';
  const take = Math.max(0, Math.floor(n));
  const window = bars.slice(Math.max(0, bars.length - take));
  return window.map((bar) => `${bar.time}:${bar.open}:${bar.high}:${bar.low}:${bar.close}`).join('|');
}
