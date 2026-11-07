// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Chart guard: an engine window with minutes missing *in the middle* is not
 * delivered to the chart. The last good plots are held for a bounded window
 * while the repair runs; a hole that outlives it is painted with a break.
 */

import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';

import { clearLogs, store } from '../src/store';
import {
  ENGINE_HOLE_HOLD_MAX,
  ENGINE_HOLE_HOLD_MS,
  ENGINE_HOLE_WARN_MS,
  _resetEngineHoleGuardForTests,
  engineHoleTimes,
  holdForEngineHole,
  noteEngineHole,
  warnEngineHole,
} from '../src/indicators/engine-hole-guard';

const T = (i: number) => 1_700_000_000 + i * 60;

beforeEach(() => {
  _resetEngineHoleGuardForTests();
  clearLogs();
});

describe('engineHoleTimes', () => {
  it('reports chart bars the axis skipped inside its own span', () => {
    const chart = [T(0), T(1), T(2), T(3), T(4)];
    const engine = [T(0), T(1), T(4)];
    expect(engineHoleTimes(chart, engine)).toEqual([T(2), T(3)]);
  });

  it('ignores a shorter window (head/tail padding is not a hole)', () => {
    const chart = [T(0), T(1), T(2), T(3), T(4)];
    expect(engineHoleTimes(chart, [T(2), T(3), T(4)])).toEqual([]);
    expect(engineHoleTimes(chart, [T(0), T(1), T(2)])).toEqual([]);
  });

  it('is empty without an engine axis or with a single-bar axis', () => {
    expect(engineHoleTimes([T(0), T(1)], null)).toEqual([]);
    expect(engineHoleTimes([T(0), T(1)], [])).toEqual([]);
    expect(engineHoleTimes([T(0), T(1)], [T(0)])).toEqual([]);
  });

  it('ignores chart times outside the engine span', () => {
    const chart = [T(0), T(1), T(2), T(3), T(4), T(5)];
    // Engine covers 1..4 and skips 2 — only 2 is a hole (0/5 are padding).
    expect(engineHoleTimes(chart, [T(1), T(3), T(4)])).toEqual([T(2)]);
  });
});

describe('noteEngineHole', () => {
  it('holds the first applies, then paints', () => {
    const now = 1_000_000;
    expect(noteEngineHole('s1', 40, now)).toBe('hold');
    for (let i = 1; i < ENGINE_HOLE_HOLD_MAX; i++) {
      expect(noteEngineHole('s1', 40, now + i)).toBe('hold');
    }
    expect(noteEngineHole('s1', 40, now + ENGINE_HOLE_HOLD_MAX)).toBe('paint');
  });

  it('stops holding when the hole outlives the time budget', () => {
    const now = 1_000_000;
    expect(noteEngineHole('s1', 40, now)).toBe('hold');
    expect(noteEngineHole('s1', 40, now + ENGINE_HOLE_HOLD_MS + 1)).toBe('paint');
  });

  it('clears when the hole is gone, so the next hole holds again', () => {
    const now = 1_000_000;
    expect(noteEngineHole('s1', 40, now)).toBe('hold');
    expect(noteEngineHole('s1', 0, now)).toBe('clear');
    expect(noteEngineHole('s1', 5, now + 1)).toBe('hold');
  });

  it('tracks scripts independently', () => {
    const now = 1_000_000;
    expect(noteEngineHole('s1', 40, now)).toBe('hold');
    expect(noteEngineHole('s2', 40, now)).toBe('hold');
    for (let i = 1; i < ENGINE_HOLE_HOLD_MAX; i++) noteEngineHole('s1', 40, now + i);
    expect(noteEngineHole('s1', 40, now + ENGINE_HOLE_HOLD_MAX)).toBe('paint');
    expect(noteEngineHole('s2', 40, now + ENGINE_HOLE_HOLD_MAX)).toBe('hold');
  });
});

describe('holdForEngineHole', () => {
  it('holds and warns once per window', () => {
    const now = 1_000_000;
    expect(holdForEngineHole('s1', [T(2)], now)).toBe(true);
    expect(store.logs.some((l) => /internal hole of 1 bar/i.test(l.message))).toBe(true);
    const warns = store.logs.length;
    // A second hold inside the warn window must not add another line.
    expect(holdForEngineHole('s1', [T(2)], now + 1000)).toBe(true);
    expect(store.logs.length).toBe(warns);
    // After the window it warns again.
    expect(warnEngineHole('s1', 1, now + ENGINE_HOLE_WARN_MS + 1)).toBe(true);
  });

  it('paints (does not hold) when there is no hole', () => {
    expect(holdForEngineHole('s1', [])).toBe(false);
    expect(store.logs).toHaveLength(0);
  });

  it('releases the hold after the budget so an indicator cannot freeze', () => {
    const now = 1_000_000;
    expect(holdForEngineHole('s1', [T(2)], now)).toBe(true);
    expect(holdForEngineHole('s1', [T(2)], now + ENGINE_HOLE_HOLD_MS + 1)).toBe(false);
  });
});
