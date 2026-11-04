// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure alert formatters — condition summary and last-fired display.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatAlertCondition,
  formatAlertKind,
  formatLastFired,
  formatLastFiredRelative,
  ALERT_KINDS,
} from '../src/alerts/format.ts';

describe('formatAlertKind', () => {
  it('labels known kinds', () => {
    expect(formatAlertKind('price_cross')).toBe('crosses');
    expect(formatAlertKind('price_above')).toBe('above');
    expect(formatAlertKind('price_below')).toBe('below');
  });
});

describe('formatAlertCondition', () => {
  it('joins kind + formatted price from params', () => {
    const s = formatAlertCondition({ kind: 'price_cross', params: { price: 42000 } });
    expect(s).toContain('crosses');
    expect(s).toContain('42');
    expect(formatAlertCondition({ kind: 'price_above', params: { price: 1.5 } })).toMatch(/above/);
    expect(formatAlertCondition({ kind: 'price_below', params: { price: 0.01 } })).toMatch(/below/);
  });

  it('handles missing price', () => {
    expect(formatAlertCondition({ kind: 'price_cross', params: {} })).toContain('—');
  });

  it('formats pct_change', () => {
    const s = formatAlertCondition({
      kind: 'pct_change',
      params: { pct: 2, direction: 'both' },
    });
    expect(s).toMatch(/pct/i);
    expect(s).toContain('2');
  });

  it('formats drawing_touch and pine_condition', () => {
    expect(
      formatAlertCondition({ kind: 'drawing_touch', params: { price: 100 } }),
    ).toMatch(/drawing/);
    const pine = formatAlertCondition({
      kind: 'pine_condition',
      params: { plotKey: 'RSI', op: '>', threshold: 70 },
    });
    expect(pine).toContain('RSI');
    expect(pine).toContain('>');
    expect(pine).toContain('70');
  });
});

describe('formatLastFired', () => {
  it('says Never for null/invalid', () => {
    expect(formatLastFired(null)).toBe('Never');
    expect(formatLastFired(undefined)).toBe('Never');
    expect(formatLastFired(0)).toBe('Never');
  });

  it('formats a real timestamp', () => {
    const s = formatLastFired(Date.UTC(2026, 0, 15, 12, 30));
    expect(s).not.toBe('Never');
    expect(s.length).toBeGreaterThan(3);
  });
});

describe('formatLastFiredRelative', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  it('handles never and future timestamps', () => {
    expect(formatLastFiredRelative(null, now)).toBe('Never');
    expect(formatLastFiredRelative(undefined, now)).toBe('Never');
    expect(formatLastFiredRelative(0, now)).toBe('Never');
    expect(formatLastFiredRelative(now + 60_000, now)).toBe('just now');
  });

  it('buckets seconds, minutes, hours, and days', () => {
    expect(formatLastFiredRelative(now - 10_000, now)).toBe('just now');
    expect(formatLastFiredRelative(now - 4 * 60_000, now)).toBe('4m ago');
    expect(formatLastFiredRelative(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatLastFiredRelative(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('falls back to an absolute date after a month', () => {
    const old = now - 40 * 86_400_000;
    expect(formatLastFiredRelative(old, now)).toBe(formatLastFired(old));
  });
});

describe('ALERT_KINDS', () => {
  it('lists price, drawing, indicator, and on-chain kinds', () => {
    expect(ALERT_KINDS).toEqual([
      'price_cross',
      'price_above',
      'price_below',
      'pct_change',
      'drawing_touch',
      'pine_condition',
      'pine_alert',
      'onchain_tvl_spike',
      'onchain_event',
    ]);
  });
});
