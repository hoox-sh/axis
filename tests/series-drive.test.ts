/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Stream-plane engine-series drive: the throttled chart-session tick that keeps
 * the engine's `series` replica advancing while the subscription (which cannot
 * advance anything by itself) reads it back.
 *
 * The tick transport is injected, so these tests are pure — no socket, no REST.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  SERIES_DRIVE_MIN_MS,
  _resetSeriesDriveForTests,
  driveEngineSeries,
  type SeriesDriveTick,
  type SeriesDriveTickFn,
} from '../src/engines/series-drive';
import type { DataSeriesKey } from '../src/engines/data-sessions';

const T = 1_700_000_000_000;
const key: DataSeriesKey = { exchange: 'binance', market: 'spot', symbol: 'SOLUSDT', interval: '1m' };
const base = { endpoint: 'http://127.0.0.1:5002', apiKey: 'k', key };

function counter(result: SeriesDriveTick = { ok: true }): { tick: SeriesDriveTickFn; calls: () => number } {
  let calls = 0;
  return {
    tick: async () => {
      calls += 1;
      return result;
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  _resetSeriesDriveForTests();
});

describe('driveEngineSeries', () => {
  it('drives once, then throttles inside the minimum gap', async () => {
    const { tick, calls } = counter();
    expect(await driveEngineSeries({ ...base, tick, nowMs: T })).toBe('ticked');
    expect(calls()).toBe(1);
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + SERIES_DRIVE_MIN_MS - 1 })).toBe('skipped');
    expect(calls()).toBe(1);
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + SERIES_DRIVE_MIN_MS })).toBe('ticked');
    expect(calls()).toBe(2);
  });

  it('drives immediately on a new venue bar even inside the gap', async () => {
    const { tick, calls } = counter();
    expect(await driveEngineSeries({ ...base, tick, nowMs: T, marketNow: 60 })).toBe('ticked');
    // Same forming bar, inside the gap: coalesced.
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + 1_000, marketNow: 60 })).toBe('skipped');
    expect(calls()).toBe(1);
    // Next bar closed: drive without waiting out the gap.
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + 2_000, marketNow: 120 })).toBe('ticked');
    expect(calls()).toBe(2);
    // Same new bar again: coalesced.
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + 3_000, marketNow: 120 })).toBe('skipped');
    expect(calls()).toBe(2);
  });

  it("surfaces the engine's stalled-feed verdict as `stale`", async () => {
    const { tick } = counter({ ok: true, stale: true, unchanged: true });
    expect(await driveEngineSeries({ ...base, tick, nowMs: T })).toBe('stale');
  });

  it('never throws — a dead or refusing tick resolves as `failed`', async () => {
    const boom: SeriesDriveTickFn = async () => {
      throw new Error('ECONNRESET');
    };
    expect(await driveEngineSeries({ ...base, tick: boom, nowMs: T })).toBe('failed');
    const refusing: SeriesDriveTickFn = async () => ({ ok: false, error: 'chart data session unavailable' });
    expect(await driveEngineSeries({ ...base, tick: refusing, nowMs: T + SERIES_DRIVE_MIN_MS })).toBe('failed');
  });

  it('retries a failed drive only after the gap', async () => {
    const { tick, calls } = counter({ ok: false, error: 'boom' });
    expect(await driveEngineSeries({ ...base, tick, nowMs: T })).toBe('failed');
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + 500 })).toBe('skipped');
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + SERIES_DRIVE_MIN_MS })).toBe('failed');
    expect(calls()).toBe(2);
  });

  it('skips without an endpoint (engine unconfigured)', async () => {
    const { tick, calls } = counter();
    expect(await driveEngineSeries({ ...base, endpoint: '   ', tick, nowMs: T })).toBe('skipped');
    expect(calls()).toBe(0);
  });

  it('throttles per engine+series, not globally', async () => {
    const { tick, calls } = counter();
    expect(await driveEngineSeries({ ...base, tick, nowMs: T })).toBe('ticked');
    // A different series of the same engine is driven on its own cadence.
    const otherInterval: DataSeriesKey = { ...key, interval: '5m' };
    expect(await driveEngineSeries({ ...base, key: otherInterval, tick, nowMs: T + 1 })).toBe('ticked');
    // So is another engine holding a series with the same identity.
    expect(await driveEngineSeries({ ...base, endpoint: 'https://engine.example', tick, nowMs: T + 2 })).toBe(
      'ticked',
    );
    expect(calls()).toBe(3);
    // Each key keeps its own throttle afterwards.
    expect(await driveEngineSeries({ ...base, tick, nowMs: T + 3 })).toBe('skipped');
    expect(calls()).toBe(3);
  });
});
