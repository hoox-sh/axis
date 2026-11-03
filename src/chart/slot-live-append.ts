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
 * Live tip updates for **inactive** multi-chart slots.
 *
 * Does not touch `store.bars` / alerts / live.needsRerun — those stay on the
 * focused plane via {@link appendLiveBar}.
 *
 * @module chart/slot-live-append
 */

import type { Bar } from '../store/types';
import type { BarAppendResult } from '../store';
import { chartWindowLimit } from '../store';
import { getSlotBars, getSlotManager, setSlotBars } from './chart-registry';
import { setDataToChart } from './manager-access';

/**
 * Apply one venue tick to an offline series copy (same G0 tip rules as
 * {@link appendBar}, without Solid store writes).
 */
export function applyBarToSeries(
  prev: readonly Bar[],
  bar: Bar,
  limit = chartWindowLimit(),
): { bars: Bar[]; result: BarAppendResult } {
  if (!bar || !Number.isFinite(bar.time)) {
    return { bars: prev.slice() as Bar[], result: 'ignored' };
  }
  const n = prev.length;
  if (n) {
    const tip = prev[n - 1]!;
    if (bar.time < tip.time) {
      return { bars: prev.slice() as Bar[], result: 'ignored' };
    }
    if (bar.time === tip.time) {
      if (tip.closed && bar.closed !== true) {
        return { bars: prev.slice() as Bar[], result: 'ignored' };
      }
      if (tip.closed && bar.closed === true) {
        // Closed OHLC immutable — drop restatement.
        return { bars: prev.slice() as Bar[], result: 'ignored' };
      }
      const next = prev.slice() as Bar[];
      const payload: Bar = { ...bar };
      if (!tip.closed && bar.closed === true) payload.open = tip.open;
      next[n - 1] = payload;
      return { bars: next, result: 'updated' };
    }
  }

  const closedPrev = prev.slice() as Bar[];
  if (n > 0) {
    const tip = closedPrev[n - 1]!;
    if (tip && tip.closed !== true) closedPrev[n - 1] = { ...tip, closed: true };
  }

  if (n === 0) {
    return { bars: [bar], result: 'appended' };
  }
  if (n >= limit) {
    const slid = closedPrev.slice(n - (limit - 1));
    slid.push(bar);
    return { bars: slid, result: 'slid' };
  }
  closedPrev.push(bar);
  return { bars: closedPrev, result: 'appended' };
}

/**
 * Append a live tick into an inactive slot's cache and paint its PaneManager.
 * No-op when the slot is the active chart (caller should use appendLiveBar).
 */
export function appendSlotLiveBar(slotId: string, bar: Bar): BarAppendResult {
  const id = String(slotId || '').trim();
  if (!id) return 'ignored';
  const { bars, result } = applyBarToSeries(getSlotBars(id), bar);
  if (result === 'ignored') return result;

  // Tip updates: keep gen stable so ChartHost does not full-repaint; we tip-paint below.
  // New bar / slide: bump gen as a safety net if tip paint misses.
  setSlotBars(id, bars, result === 'slid' || result === 'appended');

  const manager = getSlotManager(id);
  if (!manager) return result;

  try {
    if (result === 'slid' || (result === 'appended' && bars.length === 1)) {
      setDataToChart(bars, {
        fit: false,
        clearMarkers: false,
        clearScriptState: false,
        manager,
        slotId: id,
      });
    } else {
      manager.appendBar(bar);
    }
  } catch {
    /* inactive paint is best-effort */
  }
  return result;
}
