/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure gates for the live re-run loop and pane badges.
 *
 * A forming price tick must not dirty scripts on a bar-close engine, or the
 * scheduler re-arms a full run the moment the previous one finishes. The next
 * bar-close run also waits out the last run's duration.
 *
 * @module chart/live-guards
 */

export function shouldMarkNeedsRerun(input: {
  mode: 'every-tick' | 'bar-close';
  /** True when this bar replaces the open tip (same time). */
  formingUpdate: boolean;
  closed: boolean;
}): boolean {
  if (!input.formingUpdate || input.closed) return true;
  return input.mode === 'every-tick';
}

/**
 * Milliseconds to wait before the next run.
 *
 * Bar-close engines leave at least the previous run's duration between runs.
 * `elapsedSinceEndMs` is how long ago that run finished.
 */
export function rerunHoldoffMs(
  mode: 'every-tick' | 'bar-close',
  lastRunMs: number,
  elapsedSinceEndMs: number,
): number {
  if (mode !== 'bar-close' || !(lastRunMs > 0)) return 0;
  return Math.max(0, lastRunMs - Math.max(0, elapsedSinceEndMs));
}

/** Drop a cached badge value when it belongs to another market or nothing is drawn. */
export function badgeValueText(input: {
  values: string | null;
  marketMatch: boolean;
  atLastClose: boolean;
}): string | null {
  if (!input.marketMatch || !input.values) return null;
  return input.atLastClose ? `${input.values} @ last close` : input.values;
}

/** Compact volume for the volume-pane badge. */
export function formatBadgeVolume(volume: number | null | undefined): string | null {
  if (volume == null || !Number.isFinite(volume) || volume < 0) return null;
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(2)}k`;
  if (volume >= 1) return volume.toFixed(2);
  return volume.toFixed(4);
}
