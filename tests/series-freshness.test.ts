/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Engine series freshness predicates — the shared staleness contract used by
 * both engine-owned paint paths (calculator and stream) and by the broker's
 * provisioning top-up.
 *
 * The predicates are deliberately permissive: the forming bar, WS jitter and a
 * one-slot lag are normal, so only a lag beyond
 * {@link ENGINE_SERIES_STALE_STEPS} whole interval steps counts as stale. An
 * unknown bound is never treated as behind by the *skip* predicates (a wrong
 * skip would trade visible staleness for hidden staleness).
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  ENGINE_SERIES_STALE_STEPS,
  engineWindowBehindChart,
  newestBarTime,
  seriesBehind,
  seriesBehindNow,
  stepsBehind,
} from '../src/engines/series-freshness';
import type { Bar } from '../src/store/types';

const b = (time: number): Bar => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
});

describe('ENGINE_SERIES_STALE_STEPS', () => {
  it('is a small positive tolerance (2 × interval)', () => {
    expect(ENGINE_SERIES_STALE_STEPS).toBeGreaterThan(0);
    expect(ENGINE_SERIES_STALE_STEPS).toBeLessThanOrEqual(4);
  });
});

describe('newestBarTime', () => {
  it('returns the newest positive time, or 0 for an empty / missing list', () => {
    expect(newestBarTime([])).toBe(0);
    expect(newestBarTime(null)).toBe(0);
    expect(newestBarTime(undefined)).toBe(0);
    expect(newestBarTime([b(100), b(200), b(300)])).toBe(300);
  });

  it('skips trailing non-finite / non-positive rows', () => {
    const bars = [b(100), b(200), { ...b(0) }, { ...b(Number.NaN) }];
    expect(newestBarTime(bars)).toBe(200);
  });
});

describe('stepsBehind', () => {
  it('returns 0 for unknown or non-advancing bounds', () => {
    expect(stepsBehind(null, 1000, '1h')).toBe(0);
    expect(stepsBehind(1000, null, '1h')).toBe(0);
    expect(stepsBehind(0, 1000, '1h')).toBe(0);
    expect(stepsBehind(1000, 1000, '1h')).toBe(0);
    expect(stepsBehind(2000, 1000, '1h')).toBe(0);
    expect(stepsBehind(Number.NaN, 1000, '1h')).toBe(0);
  });

  it('counts whole interval steps and floors the partial one', () => {
    // An unparsable interval falls back to the 1d step (intervalToSec contract).
    expect(stepsBehind(1000, 1000 + 86_400, 'nope')).toBe(1);
    expect(stepsBehind(1000, 1000 + 86_400 + 3599, 'nope')).toBe(1);
    expect(stepsBehind(1000, 1000 + 3600, '1h')).toBe(1);
    expect(stepsBehind(1000, 1000 + 3600 * 3 + 3599, '1h')).toBe(3);
    expect(stepsBehind(1000, 1000 + 86_400, '1d')).toBe(1);
    expect(stepsBehind(1000, 1000 + 60 * 10, '1m')).toBe(10);
  });
});

describe('seriesBehind', () => {
  it('is fresh within the tolerance and stale beyond it', () => {
    const now = 1_800_000_000;
    expect(seriesBehind(now, now, '1h')).toBe(false);
    expect(seriesBehind(now - ENGINE_SERIES_STALE_STEPS * 3600, now, '1h')).toBe(false);
    expect(seriesBehind(now - (ENGINE_SERIES_STALE_STEPS + 1) * 3600, now, '1h')).toBe(true);
  });

  it('never reports stale when a bound is unknown', () => {
    expect(seriesBehind(0, 1_800_000_000, '1h')).toBe(false);
    expect(seriesBehind(1_700_000_000, 0, '1h')).toBe(false);
    expect(seriesBehind(null, 1_800_000_000, '1h')).toBe(false);
  });

  it('honors an explicit step tolerance', () => {
    const now = 1_800_000_000;
    expect(seriesBehind(now - 5 * 3600, now, '1h', 10)).toBe(false);
    expect(seriesBehind(now - 11 * 3600, now, '1h', 10)).toBe(true);
  });
});

describe('engineWindowBehindChart', () => {
  it('flags an engine window that back-dates a fresher chart', () => {
    const chart = [b(1_000_000), b(1_003_600), b(1_007_200)];
    const engine = [b(900_000), b(903_600)];
    expect(engineWindowBehindChart(chart, engine, '1h')).toBe(true);
  });

  it('stays quiet for a one/two-slot lag or a deeper engine window', () => {
    const chart = [b(1_000_000), b(1_003_600), b(1_007_200)];
    expect(engineWindowBehindChart(chart, [b(1_000_000), b(1_003_600)], '1h')).toBe(false);
    expect(engineWindowBehindChart(chart, [...chart, b(1_010_800)], '1h')).toBe(false);
    expect(engineWindowBehindChart([], [b(900_000)], '1h')).toBe(false);
    expect(engineWindowBehindChart(chart, [], '1h')).toBe(false);
  });
});

describe('seriesBehindNow', () => {
  it('flags a frozen tail against wall clock', () => {
    const now = 1_800_000_000;
    const frozen = [b(now - 4 * 86_400), b(now - 4 * 86_400 + 60)];
    expect(seriesBehindNow(frozen, '1m', now)).toBe(true);
    expect(seriesBehindNow([b(now - 120)], '1m', now)).toBe(false);
    expect(seriesBehindNow([], '1m', now)).toBe(false);
  });
});
