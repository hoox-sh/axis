/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetAlertsForTests,
  evaluateAlerts,
  saveAlerts,
  subscribeFiredAlerts,
  type Alert,
  type FiredAlertEvent,
} from '../src/alerts';

function breakoutAlert(): Alert {
  return {
    id: 'a1',
    name: 'Breakout',
    enabled: true,
    symbol: 'BTCUSDT',
    kind: 'price_above',
    params: { price: 100 },
    createdAt: 1,
  };
}

beforeEach(() => {
  _resetAlertsForTests();
});

describe('subscribeFiredAlerts', () => {
  it('notifies listeners with fired alerts + price/symbol', async () => {
    saveAlerts([breakoutAlert()]);
    const seen: FiredAlertEvent[] = [];
    const unsub = subscribeFiredAlerts((e) => seen.push(e));
    try {
      const fired = await evaluateAlerts(
        { symbol: 'BTCUSDT', price: 101, bars: [], time: Date.now() },
        { deliver: false },
      );
      expect(fired.length).toBe(1);
      expect(seen.length).toBe(1);
      expect(seen[0]?.symbol).toBe('BTCUSDT');
      expect(seen[0]?.price).toBe(101);
      expect(seen[0]?.alerts.map((a) => a.id)).toEqual(['a1']);
    } finally {
      unsub();
    }
  });

  it('stays silent when nothing fires', async () => {
    saveAlerts([breakoutAlert()]);
    const seen: FiredAlertEvent[] = [];
    const unsub = subscribeFiredAlerts((e) => seen.push(e));
    try {
      const fired = await evaluateAlerts(
        { symbol: 'BTCUSDT', price: 90, bars: [], time: Date.now() },
        { deliver: false },
      );
      expect(fired).toEqual([]);
      expect(seen).toEqual([]);
    } finally {
      unsub();
    }
  });

  it('unsubscribe stops events', async () => {
    saveAlerts([breakoutAlert()]);
    let n = 0;
    const unsub = subscribeFiredAlerts(() => {
      n += 1;
    });
    unsub();
    await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 101, bars: [], time: Date.now() },
      { deliver: false },
    );
    expect(n).toBe(0);
  });

  it('a throwing listener does not break delivery to others', async () => {
    saveAlerts([breakoutAlert()]);
    const seen: FiredAlertEvent[] = [];
    const unsubBad = subscribeFiredAlerts(() => {
      throw new Error('boom');
    });
    const unsubGood = subscribeFiredAlerts((e) => seen.push(e));
    try {
      const fired = await evaluateAlerts(
        { symbol: 'BTCUSDT', price: 101, bars: [], time: Date.now() },
        { deliver: false },
      );
      expect(fired.length).toBe(1);
      expect(seen.length).toBe(1);
    } finally {
      unsubBad();
      unsubGood();
    }
  });
});
