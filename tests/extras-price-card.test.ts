/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { formatExtraPrice } from '../src/ui/extras/format';

describe('formatExtraPrice', () => {
  it('formats with 2 decimals + thousands separators', () => {
    expect(formatExtraPrice(97412.5)).toBe('97,412.50');
    expect(formatExtraPrice(NaN)).toBe('—');
  });
});
