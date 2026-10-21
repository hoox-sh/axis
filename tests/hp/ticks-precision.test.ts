/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import {
  decimalToTicks,
  float32LosesTicks,
  priceToTicks,
  ticksToPrice,
} from '../../src/hp/axb1/ticks';

describe('AXB1 price ticks', () => {
  test('decimalToTicks and priceToTicks store 0.00000012 at scale 8 as 12n', () => {
    expect(decimalToTicks('0.00000012', 8)).toBe(12n);
    expect(priceToTicks(0.00000012, 8)).toBe(12n);
    expect(ticksToPrice(12n, 8)).toBeCloseTo(0.00000012, 12);
  });

  test('does not use float32 for canonical ticks', () => {
    const price = 123456.78901234;
    expect(float32LosesTicks(price, 8)).toBe(true);
    const f32 = new Float32Array([price])[0] as number;
    expect(priceToTicks(price, 8)).not.toBe(priceToTicks(f32, 8));
  });

  test('decimal path is exact for sub-pip strings float64 would maim', () => {
    expect(decimalToTicks('0.00000013', 8)).toBe(13n);
    expect(decimalToTicks('-1.25', 1)).toBe(-13n);
    expect(decimalToTicks('1.234', 2)).toBe(123n);
  });

  test('rejects a bad scale and non-finite price', () => {
    expect(() => priceToTicks(1, 13)).toThrow(RangeError);
    expect(() => priceToTicks(Number.NaN, 8)).toThrow(TypeError);
    expect(() => decimalToTicks('nope', 8)).toThrow(TypeError);
  });
});
