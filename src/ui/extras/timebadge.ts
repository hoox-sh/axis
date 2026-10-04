// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure time-badge helpers (no Solid imports — safe for unit tests).
 *
 * Powers the price-card left badge, the floatable Time panel, and the
 * candle-close countdown: chart intervals (`1m … 1M`) → ms, remaining
 * time to the current bar close, and clock/countdown formatters.
 *
 * @module ui/extras/timebadge
 */

/** Chart interval → milliseconds. Unknown shapes fall back to 1 day. */
export function intervalToMs(interval: string): number {
  const raw = String(interval || '').trim();
  const month = /^(\d+)M$/.exec(raw);
  if (month) return Number(month[1]) * 30 * 86_400_000;
  const m = /^(\d+)([smhdw])$/.exec(raw);
  if (!m) return 86_400_000;
  const n = Number(m[1]);
  const mult: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return n * (mult[m[2] as string] || 86_400_000);
}

/**
 * Milliseconds from `nowMs` to the close of the bar that opened at
 * `barOpenMs`. Negative (stale feed) clamps to 0. NaN when inputs are
 * unusable — caller falls back to the live clock.
 */
export function barCloseRemainingMs(
  barOpenMs: number | undefined,
  interval: string,
  nowMs: number,
): number {
  if (barOpenMs == null || !Number.isFinite(barOpenMs)) return NaN;
  const closeAt = barOpenMs + intervalToMs(interval);
  if (!Number.isFinite(closeAt)) return NaN;
  return Math.max(0, closeAt - nowMs);
}

/** `ms` → `M:SS` under an hour, `H:MM:SS` beyond. NaN → em dash. */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local `HH:MM:SS` (24h). */
export function formatClockLocal(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** UTC `HH:MM:SS`. */
export function formatClockUtc(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}
