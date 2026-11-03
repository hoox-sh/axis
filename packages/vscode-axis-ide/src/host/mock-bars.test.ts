// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  MOCK_BARS_CAP,
  clampMockBarCount,
  generateMockBars,
  hashSeed,
  intervalToSeconds,
} from './mock-bars';

describe('mock OHLCV bars', () => {
  test('intervalToSeconds maps common intervals and defaults to 60', () => {
    expect(intervalToSeconds('1m')).toBe(60);
    expect(intervalToSeconds('1h')).toBe(3600);
    expect(intervalToSeconds('1d')).toBe(86400);
    expect(intervalToSeconds('nope')).toBe(60);
  });

  test('clampMockBarCount floors, rejects non-positive, caps at setting max', () => {
    expect(MOCK_BARS_CAP).toBe(20_000);
    expect(clampMockBarCount(50.9)).toBe(50);
    expect(clampMockBarCount(0)).toBe(0);
    expect(clampMockBarCount(-3)).toBe(0);
    expect(clampMockBarCount(Number.NaN)).toBe(0);
    expect(clampMockBarCount(MOCK_BARS_CAP + 100)).toBe(MOCK_BARS_CAP);
    expect(clampMockBarCount(20_000)).toBe(20_000);
  });

  test('generateMockBars is deterministic for the same seed', () => {
    const a = generateMockBars({ count: 80, interval: '1m', seed: 'binance|spot|BTC/USDT|1m' });
    const b = generateMockBars({ count: 80, interval: '1m', seed: 'binance|spot|BTC/USDT|1m' });
    expect(a).toEqual(b);
    expect(a).toHaveLength(80);
  });

  test('different seeds diverge', () => {
    const a = generateMockBars({ count: 40, seed: 'a' });
    const b = generateMockBars({ count: 40, seed: 'b' });
    expect(a[0]?.close).not.toBe(b[0]?.close);
  });

  test('OHLC invariants: high≥max(o,c), low≤min(o,c), volume≥0, time increasing', () => {
    const bars = generateMockBars({ count: 120, interval: '5m', seed: 'inv' });
    expect(bars).toHaveLength(120);
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      expect(bar).toBeDefined();
      if (!bar) continue;
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.volume).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        const prev = bars[i - 1];
        expect(prev).toBeDefined();
        if (!prev) continue;
        expect(bar.time).toBeGreaterThan(prev.time);
      }
    }
  });

  test('hashSeed is stable', () => {
    expect(hashSeed('x')).toBe(hashSeed('x'));
    expect(hashSeed('x')).not.toBe(hashSeed('y'));
  });
});
