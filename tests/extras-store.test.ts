/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { DEFAULTS, hydrateTopbar, parsePersistedState } from '../src/store';

describe('extras store', () => {
  it('defaults all extras off with sane settings', () => {
    expect(DEFAULTS.extras.priceCard).toEqual({ enabled: false, tickLength: 20 });
    expect(DEFAULTS.extras.ticker).toEqual({ enabled: false, symbols: [], speed: 1 });
    expect(DEFAULTS.extras.alertOverlay).toEqual({
      enabled: false,
      upColor: '#3DDC97',
      downColor: '#F07178',
    });
    expect(DEFAULTS.topbar.panelsExtra).toBe(true);
  });

  it('hydrates extras + panelsExtra from persisted bags, clamps garbage', () => {
    const t = hydrateTopbar({ panelsExtra: false });
    expect(t.panelsExtra).toBe(false);
    const parsed = parsePersistedState(
      JSON.stringify({ extras: { priceCard: { enabled: true, tickLength: 500 } } }),
    );
    expect(parsed?.extras?.priceCard.enabled).toBe(true);
    expect(parsed?.extras?.priceCard.tickLength).toBe(100);
  });
});
