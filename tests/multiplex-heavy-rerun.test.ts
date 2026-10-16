/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Heavy-history live re-run mode: no bar-count downgrade.
 *
 * Delta ticks + tip-only apply made per-tick re-runs cheap, so
 * `effectiveLiveRerunMode` passes the mode through at any bar count
 * (F-20: the stream path has no throttle). Engine-capability fallback
 * (bar-close-only backends) lives in `liveRerunModeForEngine`, not here.
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

  it('keeps every-tick at any bar count (no heavy downgrade)', () => {
    expect(effectiveLiveRerunMode('every-tick', HEAVY_LIVE_RERUN_BARS)).toBe(
      'every-tick',
    );
    expect(
      effectiveLiveRerunMode('every-tick', HEAVY_LIVE_RERUN_BARS + 1),
    ).toBe('every-tick');
  });
});
