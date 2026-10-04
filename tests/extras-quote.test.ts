/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { buildQuoteRows } from '../src/ui/extras/quote';
import { defaultPanelChromeMap, PANEL_META } from '../src/ui/panels/types';
import { isPanelOpen, setPanelOpen, setStore } from '../src/store';

const bar = (time: number, o: number, h: number, l: number, c: number, v: number) => ({
  time, open: o, high: h, low: l, close: c, volume: v,
});

describe('buildQuoteRows', () => {
  it('builds price, change, day range, OHLC, volume, meta rows', () => {
    const dayStart = Math.floor(Date.UTC(2026, 9, 3) / 1000);
    const bars = [
      bar(dayStart + 60, 100, 102, 99, 101, 10),
      bar(dayStart + 120, 101, 105, 100, 104, 20),
    ];
    const rows = buildQuoteRows({
      symbol: 'BTCUSDT',
      venue: 'binance',
      bars,
      lastPrice: 104,
      lastTickAt: Date.UTC(2026, 9, 3, 12, 0, 0),
      nowMs: Date.UTC(2026, 9, 3, 12, 0, 0),
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Price']?.value).toContain('104.00');
    expect(byLabel['Price']?.tone).toBe('up');
    expect(byLabel['24h Change']?.value).toBe('+4.0%');
    expect(byLabel['24h High']?.value).toContain('105.00');
    expect(byLabel['24h Low']?.value).toContain('99.00');
    expect(byLabel['Day Open']?.value).toContain('100.00');
    expect(byLabel['Volume 24h']?.value).toBe('30');
    expect(byLabel['Venue']?.value).toBe('binance');
    expect(byLabel['Tick time']?.value).toContain('12:00:00');
  });

  it('prefers REST 24h change and degrades on empty input', () => {
    const rows = buildQuoteRows({
      symbol: 'X',
      venue: 'mock',
      bars: [],
      lastPrice: NaN,
      lastTickAt: null,
      change24h: -1.5,
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(byLabel['Price']?.value).toBe('— ●');
    expect(byLabel['24h Change']?.value).toBe('-1.5%');
    expect(byLabel['Tick time']?.value).toBe('—');
  });
});

describe('quote panel registration', () => {
  it('defaults to closed right dock', () => {
    expect(PANEL_META.quote.defaultDock).toBe('right');
    expect(defaultPanelChromeMap().quote.dock).toBe('right');
    expect(defaultPanelChromeMap().quote.open).toBe(false);
  });

  it('opens and closes through the panel store', () => {
    setPanelOpen('quote', true);
    expect(isPanelOpen('quote')).toBe(true);
    setPanelOpen('quote', false);
    expect(isPanelOpen('quote')).toBe(false);
    setStore('panelChrome', 'quote', 'open', false);
  });
});
