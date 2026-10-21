/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Live re-run mode: the user's `rerunOn` preference is honored at any bar
 * count — no heavy-history downgrade to bar-close. `bar-close` only applies
 * when the user explicitly selected it.
 */

import { describe, expect, it } from 'bun:test';
import { effectiveLiveRerunMode } from '../src/streams/multiplex';

describe('effectiveLiveRerunMode', () => {
  it('keeps bar-close when user selected it', () => {
    expect(effectiveLiveRerunMode('bar-close')).toBe('bar-close');
  });

  it('keeps every-tick as default', () => {
    expect(effectiveLiveRerunMode('every-tick')).toBe('every-tick');
    expect(effectiveLiveRerunMode(undefined)).toBe('every-tick');
  });

  it('passes the mode through at any history size (no heavy downgrade)', () => {
    expect(effectiveLiveRerunMode('every-tick')).toBe('every-tick');
    expect(effectiveLiveRerunMode('bar-close')).toBe('bar-close');
  });
});
