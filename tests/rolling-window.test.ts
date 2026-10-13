/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Rolling window — how many bars reach the engine, and how the status strip
 * reports dataset size.
 *
 * The Data Source Manager can grow a dataset far past what the chart holds
 * (`DSM_MAX_BARS_PER_JOB` is 50k). Every extra bar costs evaluate time, encode
 * time, and response-envelope bytes on *every* run, including each live tick.
 * The rolling window bounds that without hiding anything from the chart.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  ROLLING_WINDOW_DEFAULT,
  ROLLING_WINDOW_MAX,
  ROLLING_WINDOW_MIN,
  clampRollingWindowBars,
  store,
} from '../src/store';
import { applyRollingWindow } from '../src/indicators/runner';
import { formatBarCount } from '../src/ui/bar-count';
import type { Bar } from '../src/store/types';

function bars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000 + i * 60,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 10,
  })) as Bar[];
}

beforeEach(() => {
  store.rollingWindowBars = ROLLING_WINDOW_DEFAULT;
  store.bars = bars(0);
});

describe('clampRollingWindowBars', () => {
  it('falls back to the default for junk', () => {
    expect(clampRollingWindowBars(undefined)).toBe(ROLLING_WINDOW_DEFAULT);
    expect(clampRollingWindowBars(null)).toBe(ROLLING_WINDOW_DEFAULT);
    expect(clampRollingWindowBars(NaN)).toBe(ROLLING_WINDOW_DEFAULT);
    expect(clampRollingWindowBars('abc')).toBe(ROLLING_WINDOW_DEFAULT);
  });

  it('treats 0 and negatives as "unset" → default', () => {
    // 0 is documented as "no cap", but a persisted 0 would silently disable the
    // guard the setting exists to provide, so it clamps to the default instead.
    expect(clampRollingWindowBars(0)).toBe(ROLLING_WINDOW_DEFAULT);
    expect(clampRollingWindowBars(-5)).toBe(ROLLING_WINDOW_DEFAULT);
  });

  it('clamps to the bounds', () => {
    expect(clampRollingWindowBars(1)).toBe(ROLLING_WINDOW_MIN);
    expect(clampRollingWindowBars(10_000_000)).toBe(ROLLING_WINDOW_MAX);
  });

  it('passes through an in-range value, rounded', () => {
    expect(clampRollingWindowBars(1234.6)).toBe(1235);
    expect(clampRollingWindowBars('20000')).toBe(20_000);
  });

  it('defaults to 10,000', () => {
    expect(ROLLING_WINDOW_DEFAULT).toBe(10_000);
  });
});

describe('applyRollingWindow', () => {
  it('is a no-op when the dataset fits inside the window', () => {
    const input = bars(500);
    expect(applyRollingWindow(input)).toBe(input);
  });

  it('keeps the most recent N bars', () => {
    store.rollingWindowBars = 100;
    const out = applyRollingWindow(bars(20_000));
    expect(out).toHaveLength(100);
    // Tail, not head — the live bar must survive.
    expect(out[out.length - 1]!.time).toBe(1_700_000_000 + 19_999 * 60);
    expect(out[0]!.time).toBe(1_700_000_000 + 19_900 * 60);
  });

  it('is order-preserving so plot time keys stay monotonic', () => {
    store.rollingWindowBars = 50;
    const times = applyRollingWindow(bars(1_000)).map((b) => b.time);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
  });

  it('does not mutate the input array', () => {
    store.rollingWindowBars = 10;
    const input = bars(100);
    const before = input.length;
    applyRollingWindow(input);
    expect(input).toHaveLength(before);
  });

  it('handles a non-positive window by sending everything', () => {
    // Defensive: clampRollingWindowBars prevents this via persisted state, but a
    // direct store write (MCP dispatch) could still land here.
    store.rollingWindowBars = 0;
    const input = bars(20_000);
    expect(applyRollingWindow(input)).toBe(input);
  });

  it('cuts a 20k dataset in half at the default once raised', () => {
    store.rollingWindowBars = 10_000;
    const out = applyRollingWindow(bars(20_000));
    expect(out).toHaveLength(10_000);
  });
});

describe('formatBarCount', () => {
  it('shows exact numbers below 10k', () => {
    expect(formatBarCount(0)).toBe('0');
    expect(formatBarCount(1)).toBe('1');
    expect(formatBarCount(9_999)).toBe('9,999');
  });

  it('groups thousands at and above 10k', () => {
    expect(formatBarCount(10_000)).toBe('10.0k');
    expect(formatBarCount(20_000)).toBe('20.0k');
  });

  it('drops the decimal on very large datasets', () => {
    expect(formatBarCount(125_000)).toBe('125k');
  });

  it('handles junk and negatives without throwing', () => {
    expect(formatBarCount(NaN)).toBe('0');
    expect(formatBarCount(-3)).toBe('0');
  });

  it('covers the DSM ceiling', () => {
    expect(formatBarCount(50_000)).toBe('50.0k');
  });
});