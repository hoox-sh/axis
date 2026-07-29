// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import {
  clampUiScale,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_STEP,
} from '../src/store/index.ts';
import { formatUiScalePct, UI_SCALE_PRESETS } from '../src/ui/ui-scale.ts';

describe('clampUiScale', () => {
  it('defaults invalid input to 1', () => {
    expect(clampUiScale(undefined)).toBe(1);
    expect(clampUiScale(NaN)).toBe(1);
    expect(clampUiScale('nope')).toBe(1);
  });

  it('clamps to bounds', () => {
    expect(clampUiScale(0.5)).toBe(UI_SCALE_MIN);
    expect(clampUiScale(2)).toBe(UI_SCALE_MAX);
  });

  it('snaps to step', () => {
    expect(clampUiScale(1.02)).toBe(1);
    expect(clampUiScale(1.03)).toBe(1.05);
    expect(clampUiScale(0.87)).toBe(0.85);
  });

  it('exports step constants', () => {
    expect(UI_SCALE_STEP).toBe(0.05);
    expect(UI_SCALE_MIN).toBeLessThan(1);
    expect(UI_SCALE_MAX).toBeGreaterThan(1);
  });
});

describe('ui-scale helpers', () => {
  it('formats percent', () => {
    expect(formatUiScalePct(1)).toBe('100%');
    expect(formatUiScalePct(0.85)).toBe('85%');
    expect(formatUiScalePct(1.2)).toBe('120%');
  });

  it('has sensible presets', () => {
    expect(UI_SCALE_PRESETS.some((p) => p.value === 1)).toBe(true);
    for (const p of UI_SCALE_PRESETS) {
      expect(p.value).toBeGreaterThanOrEqual(UI_SCALE_MIN);
      expect(p.value).toBeLessThanOrEqual(UI_SCALE_MAX);
    }
  });
});
