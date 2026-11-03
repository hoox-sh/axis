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
 * Prefetch history into empty multi-chart slots without touching the active
 * OHLCV / live plane (`loadSymbolData` would overwrite the focused chart).
 *
 * @module chart/hydrate-slots
 */

import { getSlotBars, setSlotBars } from './chart-registry';
import { chartWindowLimit, store } from '../store';
import { getSource, sourcePageLimit } from '../sources/catalog';
import { normalizeHistoricalBars } from '../data/parse-bars';
import { pluginKey } from '../plugins/types';
import type { ChartSlot } from './layout';

/** Max concurrent inactive-slot fetches (keep venue polite under 6/8 grids). */
const HYDRATE_CONCURRENCY = 2;

let hydrateEpoch = 0;

function sourceConfig(srcId: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  const raw = configs[pluginKey('source', srcId)] || configs[srcId] || {};
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

async function fetchSlotBars(
  slot: ChartSlot,
  srcId: string,
  signal?: AbortSignal,
): Promise<ReturnType<typeof normalizeHistoricalBars>> {
  const source = getSource(srcId);
  if (!source?.fetchHistorical) return [];
  const limit = Math.min(chartWindowLimit(), Math.max(1, sourcePageLimit(srcId)));
  const raw = await source.fetchHistorical({
    symbol: slot.symbol,
    interval: slot.interval,
    config: { ...sourceConfig(srcId), limit },
    signal,
  });
  return normalizeHistoricalBars(raw);
}

/**
 * Fill empty non-active slots with a single history page each.
 * Skips the focused slot (caller already owns that plane via Load / live).
 * Safe to call after grid grow (`setChartGridMode` → 6/8).
 */
export async function hydrateEmptyChartSlots(opts?: {
  sourceId?: string;
  signal?: AbortSignal;
}): Promise<{ attempted: number; filled: number }> {
  const epoch = ++hydrateEpoch;
  const layout = store.chartLayout;
  if (!layout?.slots?.length) return { attempted: 0, filled: 0 };

  const srcId = opts?.sourceId || store.source || 'mock-walk';
  const activeId = layout.activeId;
  const targets = layout.slots.filter(
    (s) => s && s.id !== activeId && getSlotBars(s.id).length === 0,
  );
  if (!targets.length) return { attempted: 0, filled: 0 };

  let filled = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < targets.length) {
      if (epoch !== hydrateEpoch) return;
      if (opts?.signal?.aborted) return;
      const idx = cursor++;
      const slot = targets[idx];
      if (!slot) continue;
      try {
        const bars = await fetchSlotBars(slot, srcId, opts?.signal);
        if (epoch !== hydrateEpoch) return;
        if (opts?.signal?.aborted) return;
        if (!bars.length) continue;
        // Slot may have been focused/filled while we awaited.
        if (getSlotBars(slot.id).length) continue;
        if (store.chartLayout?.activeId === slot.id) continue;
        setSlotBars(slot.id, bars, true);
        filled += 1;
      } catch {
        /* best effort — empty hint remains until focus/load */
      }
    }
  };

  const n = Math.min(HYDRATE_CONCURRENCY, targets.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { attempted: targets.length, filled };
}

/** @internal Test helper — bump epoch so in-flight hydrates abort. */
export function _resetHydrateSlotsForTests(): void {
  hydrateEpoch += 1;
}
