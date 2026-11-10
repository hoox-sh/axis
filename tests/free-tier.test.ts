/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { freeTierMaxBars, GUEST_ENGINE_BAR_CAP } from '../src/engines/free-tier';

describe('free-tier bar cap', () => {
  it('reads max_bars from a 413 body', () => {
    expect(
      freeTierMaxBars({
        code: 'TOO_MANY_BARS',
        message: 'OHLCV exceeds free-tier limit (5000 bars).',
        max_bars: 5000,
      }),
    ).toBe(5000);
  });

  it('reads the limit from the message when max_bars is absent', () => {
    expect(
      freeTierMaxBars(
        'OHLCV exceeds free-tier limit (5000 bars). Reduce data length or use an authenticated endpoint.',
      ),
    ).toBe(5000);
  });

  it('falls back to the guest cap for a bare TOO_MANY_BARS code', () => {
    expect(freeTierMaxBars({ code: 'TOO_MANY_BARS', message: 'too many' })).toBe(
      GUEST_ENGINE_BAR_CAP,
    );
  });

  it('ignores unrelated engine errors', () => {
    expect(freeTierMaxBars({ message: 'bad pine' })).toBe(0);
    expect(freeTierMaxBars('Unauthorized')).toBe(0);
  });
});
