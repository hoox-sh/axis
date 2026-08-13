/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Heavy-history live re-run throttle: every-tick → bar-close at 10k+ bars.
 */

import { describe, expect, it } from 'bun:test';
import {
  HEAVY_LIVE_RERUN_BARS,
  effectiveLiveRerunMode,
} from '../src/streams/multiplex';

describe('effectiveLiveRerunMode', () => {
  it('keeps bar-close when user selected it', () => {
    expect(effectiveLiveRerunMode('bar-close', 100)).toBe('bar-close');
    expect(effectiveLiveRerunMode('bar-close', HEAVY_LIVE_RERUN_BARS)).toBe(
      'bar-close',
    );
  });

  it('keeps every-tick for small histories', () => {
    expect(effectiveLiveRerunMode('every-tick', 500)).toBe('every-tick');
    expect(effectiveLiveRerunMode(undefined, 0)).toBe('every-tick');
  });

  it('throttles every-tick to bar-close at heavy threshold', () => {
    expect(effectiveLiveRerunMode('every-tick', HEAVY_LIVE_RERUN_BARS)).toBe(
      'bar-close',
    );
    expect(
      effectiveLiveRerunMode('every-tick', HEAVY_LIVE_RERUN_BARS + 1),
    ).toBe('bar-close');
  });
});
