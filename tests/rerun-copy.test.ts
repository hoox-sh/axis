/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { indicatorRerunPresentation } from '../src/ui/settings/rerun-copy';

describe('indicator re-run settings copy', () => {
  it('shows bar close for a bar-close engine even when the preference is every tick', () => {
    const ui = indicatorRerunPresentation({
      stored: 'every-tick',
      engineAllowsEveryTick: false,
      barCount: 500,
      heavyBars: 10_000,
      streamAuthenticated: false,
    });
    expect(ui.shown).toBe('bar-close');
    expect(ui.everyTickEnabled).toBe(false);
    expect(ui.hint).toMatch(/candle close/i);
    expect(ui.hint).toMatch(/Server-Side/);
  });

  it('shows bar close for a full guest history', () => {
    const ui = indicatorRerunPresentation({
      stored: 'every-tick',
      engineAllowsEveryTick: true,
      barCount: 10_000,
      heavyBars: 10_000,
      streamAuthenticated: false,
    });
    expect(ui.shown).toBe('bar-close');
    expect(ui.everyTickEnabled).toBe(false);
  });

  it('keeps each price update when the engine can tick a short authenticated chart', () => {
    const ui = indicatorRerunPresentation({
      stored: 'every-tick',
      engineAllowsEveryTick: true,
      barCount: 10_000,
      heavyBars: 10_000,
      streamAuthenticated: true,
    });
    expect(ui.shown).toBe('every-tick');
    expect(ui.everyTickEnabled).toBe(true);
    expect(ui.hint).toMatch(/price update/i);
  });
});
