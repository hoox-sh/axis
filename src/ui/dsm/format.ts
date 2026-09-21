// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared date / duration formatters for the Data Source Manager panel
 * and Dataset manager modal.
 *
 * @module ui/dsm/format
 */

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

/** Inclusive unix-sec span as a short human duration. */
export function fmtDuration(fromSec: number | null, toSec: number | null): string {
  if (fromSec == null || toSec == null || toSec < fromSec) return '—';
  const days = Math.max(0, Math.round((toSec - fromSec) / 86_400));
  if (days < 2) {
    const hours = Math.max(0, Math.round((toSec - fromSec) / 3_600));
    return `${hours}h`;
  }
  if (days < 60) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months}mo`;
  const years = Math.round(days / 365);
  return `${years}y`;
}
