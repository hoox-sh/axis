/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import {
  barCloseRemainingMs,
  formatClockLocal,
  formatClockUtc,
  formatCountdown,
  intervalToMs,
} from '../src/ui/extras/timebadge';

describe('intervalToMs', () => {
  it('parses chart intervals', () => {
    expect(intervalToMs('1m')).toBe(60_000);
    expect(intervalToMs('15m')).toBe(900_000);
    expect(intervalToMs('1h')).toBe(3_600_000);
    expect(intervalToMs('4h')).toBe(14_400_000);
    expect(intervalToMs('1d')).toBe(86_400_000);
    expect(intervalToMs('3d')).toBe(259_200_000);
    expect(intervalToMs('1w')).toBe(604_800_000);
    expect(intervalToMs('1M')).toBe(30 * 86_400_000);
  });
  it('falls back to 1 day on garbage', () => {
    expect(intervalToMs('nope')).toBe(86_400_000);
    expect(intervalToMs('')).toBe(86_400_000);
  });
});

describe('barCloseRemainingMs', () => {
  it('measures to bar close', () => {
    // Bar opened at t=0 on 1m → closes at 60s; now 10s → 50s left.
    expect(barCloseRemainingMs(0, '1m', 10_000)).toBe(50_000);
  });
  it('clamps stale feeds at zero', () => {
    expect(barCloseRemainingMs(0, '1m', 61_000)).toBe(0);
  });
  it('returns NaN when unusable', () => {
    expect(barCloseRemainingMs(undefined, '1m', 0)).toBeNaN();
    expect(barCloseRemainingMs(NaN, '1m', 0)).toBeNaN();
  });
});

describe('formatCountdown', () => {
  it('formats M:SS under an hour', () => {
    expect(formatCountdown(272_000)).toBe('4:32');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(0)).toBe('0:00');
  });
  it('formats H:MM:SS beyond an hour', () => {
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
  });
  it('dashes on garbage', () => {
    expect(formatCountdown(NaN)).toBe('—');
    expect(formatCountdown(-1)).toBe('—');
  });
});

describe('formatClockLocal / formatClockUtc', () => {
  it('formats HH:MM:SS', () => {
    const d = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(formatClockUtc(d)).toBe('03:04:05');
    // Local wall clock — only assert shape (TZ-dependent value).
    expect(formatClockLocal(d)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
