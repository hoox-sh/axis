/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { trendOverTicks } from '../src/ui/extras/trend';

const bar = (close: number, time = 1) => ({ time, open: 1, high: 2, low: 0, close, volume: 1 });

describe('trendOverTicks', () => {
  it('detects up/down/flat over last N closes', () => {
    expect(trendOverTicks([bar(1), bar(2), bar(3)], 3)).toBe('up');
    expect(trendOverTicks([bar(3), bar(2), bar(1)], 3)).toBe('down');
    expect(trendOverTicks([bar(2), bar(2), bar(2)], 3)).toBe('flat');
  });

  it('clamps N and handles short/empty input', () => {
    expect(trendOverTicks([], 20)).toBe('flat');
    expect(trendOverTicks([bar(5)], 20)).toBe('flat');
    expect(trendOverTicks([bar(1), bar(2)], 500)).toBe('up');
  });
});
