/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { DEFAULTS, hydrateTopbar, parsePersistedState } from '../src/store';

describe('extras store', () => {
  it('defaults all extras off with sane settings', () => {
    expect(DEFAULTS.extras.priceCard).toEqual({ enabled: false, tickLength: 20 });
    expect(DEFAULTS.extras.ticker).toEqual({
      enabled: false,
      symbols: [],
      speed: 1,
      direction: 'left',
      showChange: true,
      itemSpacing: 1.5,
      bandHeight: 22,
      fontSize: 11,
      opacity: 1,
      draggable: true,
      offsetY: 0,
    });
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

  it('trims + dedupes ticker symbols', () => {
    const parsed = parsePersistedState(
      JSON.stringify({ extras: { ticker: { enabled: true, symbols: ['BTCUSDT', ' BTCUSDT ', 'ETHUSDT', 42, ''] } } }),
    );
    expect(parsed?.extras?.ticker.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('hydrates + clamps the ticker band offset, falls back on garbage', () => {
    const ok = parsePersistedState(
      JSON.stringify({ extras: { ticker: { offsetY: 42 } } }),
    );
    expect(ok?.extras?.ticker.offsetY).toBe(42);
    const high = parsePersistedState(
      JSON.stringify({ extras: { ticker: { offsetY: 5000 } } }),
    );
    expect(high?.extras?.ticker.offsetY).toBe(160);
    const negative = parsePersistedState(
      JSON.stringify({ extras: { ticker: { offsetY: -80 } } }),
    );
    expect(negative?.extras?.ticker.offsetY).toBe(0);
    const bad = parsePersistedState(
      JSON.stringify({ extras: { ticker: { offsetY: 'down' } } }),
    );
    expect(bad?.extras?.ticker.offsetY).toBe(0);
  });

  it('hydrates ticker direction + showChange, falls back on garbage', () => {
    const ok = parsePersistedState(
      JSON.stringify({ extras: { ticker: { direction: 'right', showChange: false } } }),
    );
    expect(ok?.extras?.ticker.direction).toBe('right');
    expect(ok?.extras?.ticker.showChange).toBe(false);
    const bad = parsePersistedState(
      JSON.stringify({ extras: { ticker: { direction: 'up', showChange: 'yes' } } }),
    );
    expect(bad?.extras?.ticker.direction).toBe('left');
    expect(bad?.extras?.ticker.showChange).toBe(true);
  });

  it('falls back to default colors for non-hex values', () => {
    const parsed = parsePersistedState(
      JSON.stringify({ extras: { alertOverlay: { enabled: true, upColor: 'red', downColor: '#GGGGGG' } } }),
    );
    expect(parsed?.extras?.alertOverlay.upColor).toBe('#3DDC97');
    expect(parsed?.extras?.alertOverlay.downColor).toBe('#F07178');
    const ok = parsePersistedState(
      JSON.stringify({ extras: { alertOverlay: { enabled: true, upColor: '#123abc', downColor: '#ABCDEF' } } }),
    );
    expect(ok?.extras?.alertOverlay.upColor).toBe('#123abc');
    expect(ok?.extras?.alertOverlay.downColor).toBe('#ABCDEF');
  });
});
