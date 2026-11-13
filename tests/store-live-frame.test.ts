/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Forming ticks write the bar immediately and notify Solid once per frame.
 */

import './setup';
import { afterEach, describe, expect, it } from 'bun:test';
import {
  appendBar,
  noteTick,
  setStore,
  store,
  _liveFrameProbeForTests,
  _resetLiveFrameProbeForTests,
} from '../src/store';
import { _setLiveFrameSchedulerForTests } from '../src/store/live-frame';
import { barPlane } from '../src/stores/bars';

afterEach(() => {
  _setLiveFrameSchedulerForTests(null);
  _resetLiveFrameProbeForTests();
});

describe('live frame commit', () => {
  it('shows the latest forming close before the frame notifies', () => {
    setStore('bars', []);
    setStore('telemetry', 'lastTick', null);
    const kicks: Array<() => void> = [];
    _setLiveFrameSchedulerForTests((kick) => {
      kicks.push(kick);
    });
    appendBar({ time: 1_700_000_000, open: 1, high: 1, low: 1, close: 1, volume: 1 });
    expect(kicks).toHaveLength(0);
    appendBar({ time: 1_700_000_000, open: 1, high: 2, low: 1, close: 2, volume: 4 });
    appendBar({ time: 1_700_000_000, open: 1, high: 3, low: 1, close: 3, volume: 5 });
    expect(store.bars[0]?.close).toBe(3);
    expect(store.bars[0]?.volume).toBe(5);
    expect(kicks).toHaveLength(1);
    noteTick(3, 1_700_000_000, 'BTCUSDT');
    noteTick(4, 1_700_000_000, 'BTCUSDT');
    expect(kicks).toHaveLength(1);
    expect(store.telemetry.lastTick).toBeNull();
    kicks[0]?.();
    expect(store.telemetry.lastTick?.price).toBe(4);
    expect(store.telemetry.lastTick?.dir).toBe('up');
    expect(store.bars[0]?.close).toBe(3);
  });
});

describe('live frame tip write-through', () => {
  it('performs no store write when no bar field changed between flushes', () => {
    setStore('bars', []);
    setStore('telemetry', 'lastTick', null);
    _resetLiveFrameProbeForTests();
    const kicks: Array<() => void> = [];
    _setLiveFrameSchedulerForTests((kick) => {
      kicks.push(kick);
    });
    // First append (new-bar path) does not schedule a flush by itself.
    appendBar({ time: 1_700_000_100, open: 1, high: 2, low: 1, close: 1.5, volume: 10 });
    noteTick(1.5, 1_700_000_100, 'BTCUSDT');
    expect(kicks).toHaveLength(1);
    kicks[0]?.(); // first flush — tip has never been spread, so it writes
    expect(_liveFrameProbeForTests()).toEqual({ tipWrites: 1, lastTipIndex: 0 });
    // A bare quote tick schedules a flush, but no bar field changed: no write.
    noteTick(1.6, 1_700_000_100, 'BTCUSDT');
    kicks[1]?.();
    expect(_liveFrameProbeForTests().tipWrites).toBe(1);
    // A forming tick with identical OHLCV (no-op merge) also must not re-spread.
    appendBar({ time: 1_700_000_100, open: 1, high: 2, low: 1, close: 1.5, volume: 10 });
    kicks[2]?.();
    expect(_liveFrameProbeForTests().tipWrites).toBe(1);
    // A real change re-spreads exactly once.
    appendBar({ time: 1_700_000_100, open: 1, high: 2, low: 1, close: 1.75, volume: 11 });
    kicks[3]?.();
    expect(_liveFrameProbeForTests()).toEqual({ tipWrites: 2, lastTipIndex: 0 });
  });

  it('targets the NEW tip index on the first flush after a new-bar append', () => {
    setStore('bars', []);
    setStore('telemetry', 'lastTick', null);
    _resetLiveFrameProbeForTests();
    const kicks: Array<() => void> = [];
    _setLiveFrameSchedulerForTests((kick) => {
      kicks.push(kick);
    });
    appendBar({ time: 1_700_000_200, open: 1, high: 2, low: 1, close: 1, volume: 1 });
    noteTick(1, 1_700_000_200, 'BTCUSDT');
    kicks[0]?.(); // flush tip index 0
    expect(_liveFrameProbeForTests().lastTipIndex).toBe(0);
    // New bar arrives: bars becomes [t0, t1]. The pending frame must spread t1,
    // not the now-closed bar 0.
    appendBar({ time: 1_700_000_260, open: 2, high: 3, low: 2, close: 2.5, volume: 2 });
    noteTick(2.5, 1_700_000_260, 'BTCUSDT');
    kicks[1]?.();
    expect(_liveFrameProbeForTests().lastTipIndex).toBe(1);
    // The plane tip must track the new bar, not the closed one.
    expect(barPlane.tip?.time).toBe(1_700_000_260);
    expect(barPlane.tip?.close).toBe(2.5);
  });

  it("an 'ignored' frame does not leave the pending tip index stale", () => {
    setStore('bars', []);
    setStore('telemetry', 'lastTick', null);
    _resetLiveFrameProbeForTests();
    const kicks: Array<() => void> = [];
    _setLiveFrameSchedulerForTests((kick) => {
      kicks.push(kick);
    });
    appendBar({ time: 1_700_000_300, open: 1, high: 2, low: 1, close: 1, volume: 1 });
    // Forming-tick update schedules a flush with tip index 0.
    appendBar({ time: 1_700_000_300, open: 1, high: 2, low: 1, close: 2, volume: 2 });
    // A stale forming tick after a close must be ignored and must not clobber
    // the pending tip index for the scheduled frame.
    appendBar({ time: 1_700_000_300, open: 1, high: 9, low: 1, close: 9, volume: 3, closed: true });
    const verdict = appendBar({ time: 1_700_000_300, open: 1, high: 9, low: 1, close: 9.5, volume: 4 });
    expect(verdict).toBe('ignored');
    kicks[0]?.();
    expect(_liveFrameProbeForTests().lastTipIndex).toBe(0);
    expect(store.bars[0]?.closed).toBe(true);
  });
});
