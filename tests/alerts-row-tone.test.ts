// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Alert row tone — disabled wins, recent fire, otherwise armed.
 */

import { describe, expect, it } from 'bun:test';
import { alertRowTone, RECENT_FIRE_MS } from '../src/alerts/row-tone.ts';

const NOW = 1_700_000_000_000;

describe('alertRowTone', () => {
  it('disabled wins over a recent lastFiredAt', () => {
    expect(alertRowTone({ enabled: false, lastFiredAt: NOW - 1_000 }, NOW)).toBe('disabled');
    expect(alertRowTone({ enabled: false, lastFiredAt: NOW }, NOW)).toBe('disabled');
  });

  it('is fired inside the window, including exactly RECENT_FIRE_MS', () => {
    expect(alertRowTone({ enabled: true, lastFiredAt: NOW }, NOW)).toBe('fired');
    expect(alertRowTone({ enabled: true, lastFiredAt: NOW - 60_000 }, NOW)).toBe('fired');
    expect(alertRowTone({ enabled: true, lastFiredAt: NOW - RECENT_FIRE_MS }, NOW)).toBe('fired');
  });

  it('is armed when lastFiredAt is missing, 0, NaN, in the future, or older than the window by 1ms', () => {
    expect(alertRowTone({ enabled: true }, NOW)).toBe('armed');
    expect(alertRowTone({ enabled: true, lastFiredAt: undefined }, NOW)).toBe('armed');
    expect(alertRowTone({ enabled: true, lastFiredAt: null }, NOW)).toBe('armed');
    expect(alertRowTone({ enabled: true, lastFiredAt: 0 }, NOW)).toBe('armed');
    expect(alertRowTone({ enabled: true, lastFiredAt: Number.NaN }, NOW)).toBe('armed');
    expect(alertRowTone({ enabled: true, lastFiredAt: NOW + 1 }, NOW)).toBe('armed');
    expect(alertRowTone({ enabled: true, lastFiredAt: NOW - RECENT_FIRE_MS - 1 }, NOW)).toBe(
      'armed',
    );
  });
});
