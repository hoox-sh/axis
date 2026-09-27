// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared date / duration formatters for the Data Source Manager panel
 * and Dataset manager modal.
 *
 * Durations stay exact through 119 days (so a 90-day lookback reads `90d`),
 * then months, then years. Two units at most.
 *
 * @module ui/dsm/format
 */

import { intervalToSec } from '../../data/bars-gaps';

const MIN = 60;
const HOUR = 3_600;
const DAY = 86_400;

/** Unix seconds → `YYYY-MM-DD HH:MM` UTC, or an em dash. */
export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  try {
    return new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(sec);
  }
}

/** Epoch millis → `YYYY-MM-DD HH:MM` UTC, or an em dash. */
export function fmtMillis(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  try {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return '—';
  }
}

/**
 * Clock span in seconds as a short label.
 * Under two days keeps hours and minutes. Through 119 days keeps the day
 * count. Longer spans use 30-day months, then 365-day years.
 */
export function fmtSpanSec(spanSec: number): string {
  if (!Number.isFinite(spanSec) || spanSec < 0) return '—';
  const span = Math.floor(spanSec);
  if (span < MIN) return `${span}s`;

  if (span < 2 * DAY) {
    const hours = Math.floor(span / HOUR);
    const mins = Math.floor((span % HOUR) / MIN);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remH = hours % 24;
      return remH ? `${days}d ${remH}h` : `${days}d`;
    }
    if (hours <= 0) return `${mins}m`;
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  }

  const days = Math.floor(span / DAY);
  if (days < 120) {
    const hours = Math.floor((span % DAY) / HOUR);
    if (days < 14 && hours > 0) return `${days}d ${hours}h`;
    return `${days}d`;
  }

  if (days < 365) {
    const months = Math.floor(days / 30);
    const remDays = days - months * 30;
    return remDays >= 3 ? `${months}mo ${remDays}d` : `${months}mo`;
  }

  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days - years * 365) / 30);
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

/** Clock span between two unix-sec timestamps, or an em dash. */
export function fmtDuration(fromSec: number | null, toSec: number | null): string {
  if (
    fromSec == null ||
    toSec == null ||
    !Number.isFinite(fromSec) ||
    !Number.isFinite(toSec) ||
    toSec < fromSec
  ) {
    return '—';
  }
  return fmtSpanSec(toSec - fromSec);
}

/**
 * Clock time covered by `bars` of `interval` (one step each).
 * 1,000 × 1m → `16h 40m`. Does not add a tilde; callers do when it is an estimate.
 */
export function fmtBarsAsSpan(bars: number, interval: string): string {
  if (!Number.isFinite(bars) || bars <= 0) return '—';
  return fmtSpanSec(Math.floor(bars) * intervalToSec(interval));
}

/**
 * Span label for a dataset load window.
 * A max-bars cap uses bar count × timeframe. An open window uses the clock range.
 */
export function loadWindowSpanLabel(opts: {
  count: number;
  interval: string;
  maxBars: number | null;
  fromSec: number | null;
  toSec: number | null;
}): string {
  if (!Number.isFinite(opts.count) || opts.count <= 0) return '—';
  if (opts.maxBars != null && opts.maxBars > 0) {
    const span = fmtBarsAsSpan(opts.count, opts.interval);
    return span === '—' ? '—' : `~${span}`;
  }
  return fmtDuration(opts.fromSec, opts.toSec);
}
