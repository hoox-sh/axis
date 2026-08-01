/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * bar-replay: pure state machine + session helpers.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  createReplay,
  idleReplay,
  setCursor,
  step,
  play,
  pause,
  stop,
  setSpeed,
  tick,
  visibleBars,
  isAtEnd,
  isAtStart,
  REPLAY_SPEEDS,
  startReplaySession,
  stopReplaySession,
  getReplayState,
  getVisibleBars,
  isReplayActive,
  setReplayBarsLength,
  updateReplaySession,
  subscribeReplay,
  getReplayBarsLength,
} from '../src/chart/bar-replay';
import type { Bar } from '../src/store/types';

const sample: Bar[] = [
  { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { time: 2, open: 11, high: 14, low: 10, close: 13, volume: 110 },
  { time: 3, open: 13, high: 13.5, low: 11, close: 11.5, volume: 90 },
  { time: 4, open: 11.5, high: 15, low: 11, close: 14, volume: 120 },
  { time: 5, open: 14, high: 16, low: 13, close: 15, volume: 130 },
];

beforeEach(() => {
  stopReplaySession();
});

describe('createReplay / idleReplay', () => {
  it('starts active at first bar, not playing', () => {
    const s = createReplay(sample.length);
    expect(s.active).toBe(true);
    expect(s.playing).toBe(false);
    expect(s.cursorIndex).toBe(0);
    expect(s.speed).toBe(1);
  });

  it('handles empty history', () => {
    const s = createReplay(0);
    expect(s.active).toBe(true);
    expect(s.cursorIndex).toBe(0);
    expect(visibleBars([], s)).toEqual([]);
  });

  it('idle is inactive', () => {
    const s = idleReplay();
    expect(s.active).toBe(false);
    expect(s.playing).toBe(false);
  });
});

describe('setCursor', () => {
  it('clamps to bounds', () => {
    const base = createReplay(5);
    expect(setCursor(base, 3, 5).cursorIndex).toBe(3);
    expect(setCursor(base, -10, 5).cursorIndex).toBe(0);
    expect(setCursor(base, 99, 5).cursorIndex).toBe(4);
    expect(setCursor(base, 2.9, 5).cursorIndex).toBe(2);
  });

  it('no-op when inactive', () => {
    const idle = idleReplay();
    expect(setCursor(idle, 3, 5)).toBe(idle);
  });

  it('returns same reference when unchanged', () => {
    const base = createReplay(5);
    const mid = setCursor(base, 2, 5);
    expect(setCursor(mid, 2, 5)).toBe(mid);
  });
});

describe('step', () => {
  it('steps forward and backward', () => {
    let s = createReplay(5);
    s = step(s, 1, 5);
    expect(s.cursorIndex).toBe(1);
    s = step(s, 2, 5);
    expect(s.cursorIndex).toBe(3);
    s = step(s, -1, 5);
    expect(s.cursorIndex).toBe(2);
  });

  it('does not wrap past ends', () => {
    let s = createReplay(5);
    s = step(s, -5, 5);
    expect(s.cursorIndex).toBe(0);
    s = setCursor(s, 4, 5);
    s = step(s, 10, 5);
    expect(s.cursorIndex).toBe(4);
  });

  it('no-op for zero / non-finite delta or inactive', () => {
    const base = createReplay(5);
    expect(step(base, 0, 5)).toBe(base);
    expect(step(base, Number.NaN, 5)).toBe(base);
    const idle = idleReplay();
    expect(step(idle, 1, 5)).toBe(idle);
  });
});

describe('play / pause / stop', () => {
  it('play sets playing; pause clears it', () => {
    let s = createReplay(5);
    s = play(s, 5);
    expect(s.playing).toBe(true);
    s = pause(s);
    expect(s.playing).toBe(false);
    expect(s.active).toBe(true);
  });

  it('play is no-op when already playing', () => {
    let s = play(createReplay(5), 5);
    expect(play(s, 5)).toBe(s);
  });

  it('play at last bar does not start', () => {
    let s = setCursor(createReplay(5), 4, 5);
    s = play(s, 5);
    expect(s.playing).toBe(false);
  });

  it('stop exits replay', () => {
    let s = play(createReplay(5), 5);
    s = stop(s);
    expect(s.active).toBe(false);
    expect(s.playing).toBe(false);
  });

  it('play/pause no-op when inactive', () => {
    const idle = idleReplay();
    expect(play(idle)).toBe(idle);
    expect(pause(idle)).toBe(idle);
  });
});

describe('setSpeed', () => {
  it('accepts integer speeds ≥ 1', () => {
    let s = createReplay(5);
    s = setSpeed(s, 5);
    expect(s.speed).toBe(5);
    s = setSpeed(s, 0);
    expect(s.speed).toBe(1);
    s = setSpeed(s, 2.9);
    expect(s.speed).toBe(2);
  });

  it('exposes default REPLAY_SPEEDS', () => {
    expect([...REPLAY_SPEEDS]).toEqual([1, 2, 5, 10]);
  });
});

describe('tick', () => {
  it('advances by speed while playing', () => {
    let s = play(createReplay(5), 5);
    s = tick(s, 5);
    expect(s.cursorIndex).toBe(1);
    s = setSpeed(s, 2);
    s = play(s, 5);
    s = tick(s, 5);
    expect(s.cursorIndex).toBe(3);
  });

  it('auto-pauses at end', () => {
    let s = setCursor(createReplay(5), 3, 5);
    s = play(s, 5);
    s = tick(s, 5);
    expect(s.cursorIndex).toBe(4);
    expect(s.playing).toBe(false);
    // further ticks no-op
    const frozen = tick(s, 5);
    expect(frozen).toBe(s);
  });

  it('does not advance when paused or inactive', () => {
    const paused = createReplay(5);
    expect(tick(paused, 5)).toBe(paused);
    const idle = idleReplay();
    expect(tick(idle, 5)).toBe(idle);
  });

  it('speed larger than remaining clamps and pauses', () => {
    let s = setCursor(createReplay(5), 2, 5);
    s = setSpeed(s, 10);
    s = play(s, 5);
    s = tick(s, 5);
    expect(s.cursorIndex).toBe(4);
    expect(s.playing).toBe(false);
  });

  it('empty length stops playing', () => {
    let s = play(createReplay(0), 0);
    s = { ...s, playing: true };
    s = tick(s, 0);
    expect(s.playing).toBe(false);
  });
});

describe('visibleBars', () => {
  it('returns prefix through cursor when active', () => {
    let s = createReplay(sample.length);
    expect(visibleBars(sample, s)).toHaveLength(1);
    expect(visibleBars(sample, s)[0]!.time).toBe(1);
    s = setCursor(s, 2, sample.length);
    const vis = visibleBars(sample, s);
    expect(vis).toHaveLength(3);
    expect(vis[2]!.time).toBe(3);
  });

  it('returns full copy when inactive', () => {
    const vis = visibleBars(sample, idleReplay());
    expect(vis).toHaveLength(5);
    expect(vis).not.toBe(sample);
  });

  it('handles cursor beyond array (defensive)', () => {
    const s = { ...createReplay(3), cursorIndex: 99 };
    expect(visibleBars(sample.slice(0, 3), s)).toHaveLength(3);
  });
});

describe('isAtStart / isAtEnd', () => {
  it('reports bounds', () => {
    let s = createReplay(5);
    expect(isAtStart(s)).toBe(true);
    expect(isAtEnd(s, 5)).toBe(false);
    s = setCursor(s, 4, 5);
    expect(isAtStart(s)).toBe(false);
    expect(isAtEnd(s, 5)).toBe(true);
    expect(isAtEnd(s, 0)).toBe(true);
  });
});

describe('session helpers', () => {
  it('start / stop / isReplayActive', () => {
    expect(isReplayActive()).toBe(false);
    startReplaySession(sample.length);
    expect(isReplayActive()).toBe(true);
    expect(getReplayState().cursorIndex).toBe(0);
    expect(getReplayBarsLength()).toBe(5);
    stopReplaySession();
    expect(isReplayActive()).toBe(false);
  });

  it('getVisibleBars respects session', () => {
    startReplaySession(sample.length);
    expect(getVisibleBars(sample)).toHaveLength(1);
    updateReplaySession((st, len) => step(st, 2, len));
    expect(getVisibleBars(sample)).toHaveLength(3);
    stopReplaySession();
    // inactive: same reference
    expect(getVisibleBars(sample)).toBe(sample);
  });

  it('setReplayBarsLength clamps cursor', () => {
    startReplaySession(10);
    updateReplaySession((st, len) => setCursor(st, 9, len));
    expect(getReplayState().cursorIndex).toBe(9);
    setReplayBarsLength(4);
    expect(getReplayState().cursorIndex).toBe(3);
  });

  it('subscribeReplay notifies on updates', () => {
    const seen: number[] = [];
    const unsub = subscribeReplay((st) => seen.push(st.cursorIndex));
    startReplaySession(5);
    updateReplaySession((st, len) => step(st, 1, len));
    unsub();
    updateReplaySession((st, len) => step(st, 1, len));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // last notification before unsub was cursor 1
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('play through end via ticks', () => {
    startReplaySession(5);
    updateReplaySession((st, len) => play(st, len));
    for (let i = 0; i < 10; i++) {
      updateReplaySession((st, len) => tick(st, len));
    }
    expect(getReplayState().cursorIndex).toBe(4);
    expect(getReplayState().playing).toBe(false);
  });
});
