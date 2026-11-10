/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live re-run mode. A heavy history without an authenticated stream socket
 * downgrades every-tick to bar-close. An authenticated stream keeps every-tick
 * (deltas). Omitting the options keeps the caller's mode.
 */

import { describe, expect, it } from 'bun:test';
import { effectiveLiveRerunMode, guestStreamNeedsCalculator } from '../src/streams/multiplex';

describe('effectiveLiveRerunMode', () => {
  it('keeps bar-close when user selected it', () => {
    expect(effectiveLiveRerunMode('bar-close')).toBe('bar-close');
    expect(
      effectiveLiveRerunMode('bar-close', { barCount: 10_000, streamAuthenticated: true }),
    ).toBe('bar-close');
  });

  it('keeps every-tick as default when no history is supplied', () => {
    expect(effectiveLiveRerunMode('every-tick')).toBe('every-tick');
    expect(effectiveLiveRerunMode(undefined)).toBe('every-tick');
  });

  it('downgrades a heavy unauthenticated chart to bar-close', () => {
    expect(effectiveLiveRerunMode('every-tick', { barCount: 10_000 })).toBe('bar-close');
    expect(
      effectiveLiveRerunMode('every-tick', { barCount: 10_000, streamAuthenticated: false }),
    ).toBe('bar-close');
  });

  it('keeps every-tick on a heavy chart when the stream is authenticated', () => {
    expect(
      effectiveLiveRerunMode('every-tick', { barCount: 10_000, streamAuthenticated: true }),
    ).toBe('every-tick');
  });

  it('keeps every-tick on a short unauthenticated chart', () => {
    expect(effectiveLiveRerunMode('every-tick', { barCount: 500 })).toBe('every-tick');
  });
});

describe('guestStreamNeedsCalculator', () => {
  it('sends a guest (no API key) to the calculator path', () => {
    expect(guestStreamNeedsCalculator(false, null)).toBe(true);
  });

  it('sends a no-auth stream error to the calculator path', () => {
    expect(guestStreamNeedsCalculator(true, { reason: 'no-auth' })).toBe(true);
  });

  it('keeps an authenticated stream on the socket', () => {
    expect(guestStreamNeedsCalculator(true, null)).toBe(false);
    expect(guestStreamNeedsCalculator(true, { reason: 'eval' })).toBe(false);
  });
});
