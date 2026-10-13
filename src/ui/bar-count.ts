// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bar-count formatting for chrome readouts.
 *
 * The Data Source Manager can grow a dataset to tens of thousands of bars
 * (`DSM_MAX_BARS_PER_JOB` is 50k), so the status strip groups thousands —
 * `20k` instead of `20000` — while staying exactly aligned with the
 * monospace `tabular-nums` runs next to it.
 *
 * @module ui/bar-count
 */

/**
 * Format a bar count for display.
 *
 * Below 10,000 the exact number is shown (`9,999`), since that is where an
 * exact count still fits comfortably and matters most. At and above 10,000 the
 * figure is grouped to one decimal (`20.0k`) so a 50,000-bar dataset does not
 * stretch the strip.
 */
export function formatBarCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const v = Math.round(n);
  if (v < 10_000) return v.toLocaleString('en-US');
  const k = v / 1000;
  // One decimal below 100k (20.0k), none above (125k).
  return k < 100 ? `${k.toFixed(1)}k` : `${Math.round(k)}k`;
}