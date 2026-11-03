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
 * Secondary venue streams for inactive multi-chart slots (A1.2.2).
 *
 * The primary {@link startLive} socket owns the focused symbol. Distinct
 * inactive `symbol|interval` pairs get their own `stream.start()` (cap 7).
 * Ticks land via {@link appendSlotLiveBar} — never on `store.bars`.
 *
 * @module streams/slot-live-mux
 */

import { store } from '../store';
import { getStream } from './catalog';
import { pluginKey } from '../plugins/types';
import { sanitizeBar } from '../data/parse-bars';
import { appendSlotLiveBar } from '../chart/slot-live-append';
import { getSlotBars } from '../chart/chart-registry';
import type { Bar } from '../store/types';

/** Max distinct secondary markets while Live is on (8-grid − active). */
export const SLOT_LIVE_MUX_CAP = 7;

type MuxEntry = {
  key: string;
  symbol: string;
  interval: string;
  slotIds: Set<string>;
  stop: (() => void) | null;
};

const entries = new Map<string, MuxEntry>();
let muxEpoch = 0;

function marketKey(symbol: string, interval: string): string {
  return `${String(symbol || '').toUpperCase()}|${String(interval || '')}`;
}

function streamConfig(streamId: string): Record<string, unknown> {
  const configs = store.pluginsConfig || {};
  const raw = configs[pluginKey('stream', streamId)] || configs[streamId] || {};
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

function stopEntry(entry: MuxEntry): void {
  const stop = entry.stop;
  entry.stop = null;
  if (!stop) return;
  try {
    stop();
  } catch {
    /* ignore */
  }
}

function startEntry(entry: MuxEntry, streamId: string, epoch: number): void {
  const stream = getStream(streamId);
  if (!stream) return;
  const slotId = [...entry.slotIds][0];
  const lastBar = slotId ? getSlotBars(slotId).at(-1) ?? null : null;
  try {
    entry.stop = stream.start({
      symbol: entry.symbol,
      interval: entry.interval,
      lastBar,
      config: streamConfig(streamId),
      onBar: (raw: Bar) => {
        if (epoch !== muxEpoch) return;
        if (!store.live.active) return;
        const bar = sanitizeBar(raw);
        if (!bar) return;
        const live = entries.get(entry.key);
        if (!live) return;
        for (const id of live.slotIds) {
          if (id === store.chartLayout?.activeId) continue;
          try {
            appendSlotLiveBar(id, bar);
          } catch {
            /* best effort */
          }
        }
      },
      onStatus: () => {
        /* secondary sockets stay quiet in primary telemetry */
      },
      onError: () => {
        /* primary path owns user-visible stream errors */
      },
    });
  } catch {
    entry.stop = null;
  }
}

/**
 * Reconcile secondary streams with the current grid + Live state.
 * Idempotent: keeps sockets whose market key is still desired.
 */
export function syncSlotLiveMux(opts?: { streamId?: string }): void {
  const epoch = ++muxEpoch;
  if (!store.live.active) {
    stopSlotLiveMux();
    return;
  }

  const layout = store.chartLayout;
  const slots = layout?.slots || [];
  const activeId = layout?.activeId;
  const active = slots.find((s) => s.id === activeId) || slots[0];
  const activeKey = active ? marketKey(active.symbol, active.interval) : '';

  const desired = new Map<string, { symbol: string; interval: string; slotIds: Set<string> }>();
  for (const slot of slots) {
    if (!slot || slot.id === activeId) continue;
    const key = marketKey(slot.symbol, slot.interval);
    if (!key || key === '|' || key === activeKey) continue;
    let row = desired.get(key);
    if (!row) {
      if (desired.size >= SLOT_LIVE_MUX_CAP) continue;
      row = { symbol: slot.symbol.toUpperCase(), interval: slot.interval, slotIds: new Set() };
      desired.set(key, row);
    }
    row.slotIds.add(slot.id);
  }

  for (const [key, entry] of [...entries]) {
    if (!desired.has(key)) {
      stopEntry(entry);
      entries.delete(key);
    }
  }

  const streamId = opts?.streamId || store.live.streamId || '';
  if (!streamId || !getStream(streamId)) return;

  for (const [key, want] of desired) {
    const existing = entries.get(key);
    if (existing) {
      existing.slotIds = want.slotIds;
      if (!existing.stop) startEntry(existing, streamId, epoch);
      continue;
    }
    const entry: MuxEntry = {
      key,
      symbol: want.symbol,
      interval: want.interval,
      slotIds: want.slotIds,
      stop: null,
    };
    entries.set(key, entry);
    startEntry(entry, streamId, epoch);
  }
}

/** Tear down every secondary slot stream. */
export function stopSlotLiveMux(): void {
  muxEpoch += 1;
  for (const entry of entries.values()) stopEntry(entry);
  entries.clear();
}

/** @internal Test helper. */
export function _slotLiveMuxSnapshotForTests(): {
  keys: string[];
  size: number;
} {
  return { keys: [...entries.keys()].sort(), size: entries.size };
}

/** @internal Test helper. */
export function _resetSlotLiveMuxForTests(): void {
  stopSlotLiveMux();
}
