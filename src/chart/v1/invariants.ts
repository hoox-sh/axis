/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Sync invariants (concept §6.3).
 *
 * Pure checks. A positive pane skew, or any series time past the price tip,
 * is forbidden. Plot column length must match the price axis; apply samples
 * both short and long mismatches. Every pane's visible logical range must
 * match `chart.timeScale()`. Closed-bar identity is the last N **closed**
 * bars joined as text, not a clock. A forming tip is not in that window.
 *
 * @module chart/v1/invariants
 */

/** One OHLC row for hashing; `closed === false` marks a forming tip that is excluded. */
export type ClosedBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /**
   * Venue closed flag. History rows often omit it — those count as closed.
   * `false` is a forming tip and is not hashed.
   */
  closed?: boolean;
};

function finite(value: number | null): value is number {
  return value != null && Number.isFinite(value);
}

/** Logical-range from/to are bar indices; treat sub-bar float noise as equal. */
const LOGICAL_RANGE_EPS = 1e-6;

/** Visible logical range in bar indices (floats allowed; sub-bar noise is ignored). */
export type LogicalRange = { from: number; to: number };

/** Greatest abs gap of `from`/`to`. Null if either range is missing. */
export function logicalRangeSkew(
  price: LogicalRange | null,
  pane: LogicalRange | null,
): number | null {
  if (price == null || pane == null) return null;
  if (!finite(price.from) || !finite(price.to) || !finite(pane.from) || !finite(pane.to)) {
    return null;
  }
  const dFrom = Math.abs(price.from - pane.from);
  const dTo = Math.abs(price.to - pane.to);
  if (dFrom <= LOGICAL_RANGE_EPS && dTo <= LOGICAL_RANGE_EPS) return 0;
  return Math.max(dFrom, dTo);
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

/**
 * Bars of an ascending time list that sit strictly before `time`.
 *
 * Binary search — the list is one candle axis, so this is O(log n) on every
 * repaint. Non-finite / unsorted input falls back to a linear count.
 *
 * @param times ascending bar open times (unix seconds)
 * @param time boundary; bars equal to it are **not** counted
 * @returns count of `times[i] < time`
 */
export function barsBefore(times: readonly number[], time: number): number {
  if (!times.length || !Number.isFinite(time)) return 0;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(times[mid]);
    if (!Number.isFinite(t)) return times.filter((x) => Number(x) < time).length;
    if (t < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Rebase a preserved visible logical range onto a repainted candle window.
 *
 * A full-window repaint (`fit: false`) keeps the pre-paint range so a live
 * slide does not jump the viewport. But the repaint can also **drop bars from
 * the head** (a window reset, a shorter engine/DSM window, a left-edge page
 * that the window cap sliced away). Restoring the old indices then points at
 * bars that no longer exist: the viewport keeps extending past the new tip and
 * the chart is left with a phantom empty margin on the right — the price pane
 * and every indicator appear "shifted left".
 *
 * Two corrections, both derived from the new axis:
 * 1. **Head shift** — a bar's logical index drops by the number of old bars
 *    that sat before the new first bar, so the range is shifted by the same
 *    amount and the same *times* stay on screen.
 * 2. **Right clamp** — the range can never sit further right than the new tip
 *    plus the chart's own `rightOffset` (the future whitespace LWC allows).
 *
 * @param range preserved logical range (`null` when nothing was captured)
 * @param prevTimes candle axis before the repaint
 * @param nextTimes candle axis after the repaint
 * @param rightOffset chart `rightOffset` in bars (future whitespace)
 * @returns the corrected range, or `null` when it cannot be computed
 */
export function rebaseLogicalRange(
  range: LogicalRange | null,
  prevTimes: readonly number[] | null | undefined,
  nextTimes: readonly number[] | null | undefined,
  rightOffset = 0,
): LogicalRange | null {
  if (range == null) return null;
  if (!finite(range.from) || !finite(range.to) || range.to <= range.from) return null;
  const next = nextTimes ?? [];
  if (!next.length) return null;
  const nextFirst = Number(next[0]);
  const removed =
    prevTimes?.length && Number.isFinite(nextFirst) ? barsBefore(prevTimes, nextFirst) : 0;
  let from = range.from - removed;
  let to = range.to - removed;
  const offset = Math.max(0, Number.isFinite(rightOffset) ? rightOffset : 0);
  // The viewport's bars were all dropped from the head: anchor it at the new
  // head instead of leaving the whole pane as left-edge whitespace.
  if (to <= 0) {
    const span = to - from;
    from = -offset;
    to = from + span;
  }
  const maxTo = next.length - 1 + offset;
  if (to > maxTo) {
    const span = to - from;
    to = maxTo;
    from = to - span;
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return { from, to };
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

/**
 * Sampling + warn channel for the invariant notes.
 * `dev` forces every warning; otherwise prod samples ~1 in 32.
 */
export type SyncSampleOpts = {
  dev?: boolean;
  rand?: number;
  warn?: (message: string) => void;
};

const syncWarned = new Set<string>();
const pastTipWarned = new Set<string>();
const rangeSkewWarned = new Set<string>();

function shouldSample(opts?: SyncSampleOpts): boolean {
  const dev = opts?.dev === true;
  const rand = opts?.rand ?? Math.random();
  return dev || rand < 1 / 32;
}

function emitSample(key: string, seen: Set<string>, message: string, opts?: SyncSampleOpts): void {
  if (seen.has(key)) return;
  seen.add(key);
  const warn = opts?.warn ?? ((text: string) => console.warn(text));
  warn(message);
}

/**
 * Dev warns every new length mismatch (short or long). Prod samples about
 * 1 in 32, once per absolute size. Long uses the overhang text; short says
 * the column is N bars short of the price axis.
 */
export function notePlotLengthSkew(
  barCount: number,
  lengths: readonly number[],
  opts?: SyncSampleOpts,
): void {
  const skew = plotLengthSkew(barCount, lengths);
  if (skew <= 0) return;
  if (!shouldSample(opts)) return;
  const over = plotOverhang(barCount, lengths);
  const message =
    over === skew
      ? `[axis] plot column is ${skew} bars past the price axis`
      : `[axis] plot column is ${skew} bars short of the price axis`;
  emitSample(String(skew), syncWarned, message, opts);
}

/** Dev warns every new overhang. Prod samples about 1 in 32, once per size. */
export function noteSyncSample(
  barCount: number,
  lengths: readonly number[],
  opts?: SyncSampleOpts,
): void {
  if (plotOverhang(barCount, lengths) <= 0) return;
  notePlotLengthSkew(barCount, lengths, opts);
}

/**
 * Warn when a series time is strictly after the price tip.
 * No-ops when the series ends on or before the price last (warmup / na).
 * Dev warns once per past time. Prod samples about 1 in 32, once per time.
 */
export function noteSeriesPastTip(
  priceLast: number | null,
  times: readonly number[],
  opts?: SyncSampleOpts,
): void {
  const past = seriesPastTip(priceLast, times);
  if (past == null) return;
  if (!shouldSample(opts)) return;
  emitSample(String(past), pastTipWarned, `[axis] series time ${past} is past the price tip`, opts);
}

/** @internal Test helper — forget every dedupe set so the same warning can fire again. */
export function _resetSyncSampleForTests(): void {
  syncWarned.clear();
  pastTipWarned.clear();
  rangeSkewWarned.clear();
  closedWarned.clear();
}

/**
 * Warn when a pane's visible logical range disagrees with the price axis.
 * Dev warns once per distinct skew size. Prod samples about 1 in 32.
 */
export function noteLogicalRangeSkew(
  price: LogicalRange | null,
  pane: LogicalRange | null,
  opts?: SyncSampleOpts,
): void {
  const skew = logicalRangeSkew(price, pane);
  if (skew == null || skew <= 0) return;
  if (!shouldSample(opts)) return;
  emitSample(String(skew), rangeSkewWarned, '[axis] pane logical range skews the price axis', opts);
}

const closedWarned = new Set<string>();

/** True when a later close changes OHLC of a bar that was already closed. */
export function closedOhlcChanged(
  prev: { open: number; high: number; low: number; close: number },
  next: { open: number; high: number; low: number; close: number },
): boolean {
  return (
    prev.open !== next.open ||
    prev.high !== next.high ||
    prev.low !== next.low ||
    prev.close !== next.close
  );
}

/** Dev warns every rewritten close. Prod samples about 1 in 32, once per bar time. */
export function noteClosedRewrite(time: number, opts?: SyncSampleOpts): void {
  if (!shouldSample(opts)) return;
  emitSample(String(time), closedWarned, `[axis] closed bar ${time} changed after commit`, opts);
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

/**
 * Last `n` closed bars (default 8) as `time:open:high:low:close` joined by `|`.
 * Skips `closed === false` (forming tips). Missing `closed` is treated as
 * closed so REST/history rows that omit the flag still hash.
 */
export function closedBarHash(bars: readonly ClosedBar[], n = 8): string {
  if (bars.length === 0) return '';
  const take = Math.max(0, Math.floor(n));
  if (take === 0) return '';
  const window: ClosedBar[] = [];
  for (let i = bars.length - 1; i >= 0 && window.length < take; i--) {
    const bar = bars[i];
    if (bar == null || bar.closed === false) continue;
    window.push(bar);
  }
  window.reverse();
  return window
    .map((bar) => `${bar.time}:${bar.open}:${bar.high}:${bar.low}:${bar.close}`)
    .join('|');
}
