/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { anyExtraEnabled } from '../src/ui/extras/state';
import { DEFAULTS } from '../src/store';

describe('anyExtraEnabled', () => {
  it('false when all extras off', () => {
    expect(anyExtraEnabled(DEFAULTS.extras)).toBe(false);
  });
  it('true when any extra on', () => {
    expect(
      anyExtraEnabled({ ...DEFAULTS.extras, ticker: { enabled: true, symbols: [], speed: 1 } }),
    ).toBe(true);
  });
});
