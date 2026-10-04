/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import { alertDirection } from '../src/ui/extras/FullscreenAlert';
import type { Alert } from '../src/alerts';

const alert = (kind: Alert['kind'], params: Alert['params'] = {}): Alert => ({
  id: 'a1',
  name: 'Test',
  enabled: true,
  symbol: 'BTCUSDT',
  kind,
  params,
  createdAt: 1,
});

describe('alertDirection', () => {
  it('maps above/below kinds to up/down', () => {
    expect(alertDirection(alert('price_above'), 100)).toBe('up');
    expect(alertDirection(alert('price_below'), 100)).toBe('down');
  });
  it('maps pct_change by direction param', () => {
    expect(alertDirection(alert('pct_change', { direction: 'up' }), 100)).toBe('up');
    expect(alertDirection(alert('pct_change', { direction: 'down' }), 100)).toBe('down');
  });
  it('falls back to level compare for other kinds', () => {
    expect(alertDirection(alert('price_cross', { price: 90 }), 100)).toBe('up');
    expect(alertDirection(alert('price_cross', { price: 110 }), 100)).toBe('down');
    expect(alertDirection(alert('pine_alert'), 100)).toBe('up');
  });
  it('treats a zero level as a real level (not missing)', () => {
    expect(alertDirection(alert('price_cross', { price: 0 }), 0)).toBe('up');
    expect(alertDirection(alert('price_cross', { price: 0 }), -1)).toBe('down');
    expect(alertDirection(alert('price_cross', { threshold: 0 }), 0.5)).toBe('up');
  });
});
