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
 * Tick-trend helper for the Extra price card: compare the last close against
 * the first close of the trailing N-bar window. Pure — no store access, safe
 * for unit tests.
 *
 * @module ui/extras/trend
 */

import type { Bar } from '../../store/types';

export type TickTrend = 'up' | 'down' | 'flat';

/** Compare the last close against the first close of the trailing N-bar window (N clamped 2–100). */
export function trendOverTicks(bars: readonly Bar[], n: number): TickTrend {
  const len = Array.isArray(bars) ? bars.length : 0;
  if (len < 2) return 'flat';
  const nn = Math.min(100, Math.max(2, Math.floor(n) || 20));
  const last = bars[len - 1]?.close;
  const prev = bars[Math.max(0, len - nn)]?.close;
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return 'flat';
  if (last > prev) return 'up';
  if (last < prev) return 'down';
  return 'flat';
}
