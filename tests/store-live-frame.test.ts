/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Forming ticks write the bar immediately and notify Solid once per frame.
 */

import './setup';
import { afterEach, describe, expect, it } from 'bun:test';
import { appendBar, noteTick, setStore, store } from '../src/store';
import { _setLiveFrameSchedulerForTests } from '../src/store/live-frame';

afterEach(() => {
  _setLiveFrameSchedulerForTests(null);
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
