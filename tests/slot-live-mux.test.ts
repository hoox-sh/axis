// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
  _resetSlotLiveMuxForTests,
  _slotLiveMuxSnapshotForTests,
  syncSlotLiveMux,
  stopSlotLiveMux,
  SLOT_LIVE_MUX_CAP,
} from '../src/streams/slot-live-mux.ts';
import { normalizeChartLayout } from '../src/chart/layout.ts';
import { getSlotBars, removeSlotRuntime, setSlotBars } from '../src/chart/chart-registry.ts';
import { setStore, store } from '../src/store/index.ts';
import { registerDynamicStream, unregisterDynamicStream } from '../src/streams/catalog.ts';

type BarCb = (b: {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}) => void;

const stops: Array<() => void> = [];
const started: Array<{ symbol: string; interval: string; onBar: BarCb }> = [];

function installFakeStream() {
  registerDynamicStream({
    id: 'test-slot-mux',
    kind: 'stream',
    name: 'Test slot mux',
    description: 'unit',
    capabilities: { realtime: true },
    start({ symbol, interval, onBar }) {
      const rec = { symbol, interval, onBar: onBar as BarCb };
      started.push(rec);
      const stop = mock(() => {
        const i = started.indexOf(rec);
        if (i >= 0) started.splice(i, 1);
      });
      stops.push(stop);
      return stop;
    },
  });
}

afterEach(() => {
  stopSlotLiveMux();
  _resetSlotLiveMuxForTests();
  try {
    unregisterDynamicStream('test-slot-mux');
  } catch {
    /* optional */
  }
  started.length = 0;
  stops.length = 0;
  const slots = store.chartLayout?.slots || [];
  for (const s of slots) removeSlotRuntime(s.id);
  setStore('live', 'active', false);
});

describe('slot-live-mux', () => {
  it('opens secondary sockets for distinct inactive markets and fans ticks', () => {
    installFakeStream();
    const layout = normalizeChartLayout({ mode: '4' });
    setStore('chartLayout', layout);
    setStore('live', { ...store.live, active: true, streamId: 'test-slot-mux' });
    setStore('live', 'streamId', 'test-slot-mux');
    setStore('live', 'active', true);

    syncSlotLiveMux({ streamId: 'test-slot-mux' });
    const snap = _slotLiveMuxSnapshotForTests();
    expect(snap.size).toBe(3);
    expect(started).toHaveLength(3);

    const sibling = layout.slots.find((s) => s.id !== layout.activeId)!;
    setSlotBars(sibling.id, [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }], false);
    const feed = started.find((s) => s.symbol === sibling.symbol && s.interval === sibling.interval);
    expect(feed).toBeTruthy();
    feed!.onBar({ time: 1, open: 1, high: 2, low: 1, close: 1.5, volume: 2 });
    expect(getSlotBars(sibling.id)[0]!.close).toBe(1.5);

    const activeSlot = layout.slots.find((s) => s.id === layout.activeId)!;
    const activeKey = `${activeSlot.symbol.toUpperCase()}|${activeSlot.interval}`;
    expect(snap.keys.includes(activeKey)).toBe(false);
  });

  it('stops all secondaries when Live is off', () => {
    installFakeStream();
    setStore('chartLayout', normalizeChartLayout({ mode: '4' }));
    setStore('live', 'streamId', 'test-slot-mux');
    setStore('live', 'active', true);
    syncSlotLiveMux({ streamId: 'test-slot-mux' });
    expect(_slotLiveMuxSnapshotForTests().size).toBeGreaterThan(0);
    setStore('live', 'active', false);
    syncSlotLiveMux({ streamId: 'test-slot-mux' });
    expect(_slotLiveMuxSnapshotForTests().size).toBe(0);
    expect(started).toHaveLength(0);
  });

  it('respects SLOT_LIVE_MUX_CAP', () => {
    expect(SLOT_LIVE_MUX_CAP).toBe(7);
    installFakeStream();
    const layout = normalizeChartLayout({ mode: '8' });
    setStore('chartLayout', layout);
    setStore('live', 'streamId', 'test-slot-mux');
    setStore('live', 'active', true);
    syncSlotLiveMux({ streamId: 'test-slot-mux' });
    expect(_slotLiveMuxSnapshotForTests().size).toBeLessThanOrEqual(SLOT_LIVE_MUX_CAP);
    // 8 slots → 7 inactive distinct symbols by default
    expect(_slotLiveMuxSnapshotForTests().size).toBe(7);
  });
});
