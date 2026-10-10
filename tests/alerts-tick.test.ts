/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * F2: live bars are evaluated against the stream's own {symbol, interval} —
 * stale-stream bars never fire another symbol's alerts.
 * F8: pct_change latches a fixed basePrice on first evaluation.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { setStore } from '../src/store';
import {
  _resetAlertsForTests,
  createAlert,
  evaluateAlerts,
  loadAlerts,
} from '../src/alerts';
import {
  evaluateLiveAlerts,
  liveBarMatchesChart,
  noteLiveBarForAlerts,
} from '../src/alerts/tick';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function firstAlert(): import('../src/alerts/types').Alert {
  const a = loadAlerts()[0];
  if (!a) throw new Error('expected a persisted alert');
  return a;
}

beforeEach(() => {
  _resetAlertsForTests();
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1h');
  setStore('bars', []);
});

describe('liveBarMatchesChart (F2)', () => {
  it('drops bars from a stale stream symbol', () => {
    expect(liveBarMatchesChart({ symbol: 'BTCUSDT', interval: '1h' })).toBe(true);
    expect(liveBarMatchesChart({ symbol: 'ETHUSDT', interval: '1h' })).toBe(false);
    expect(liveBarMatchesChart({ symbol: 'BTCUSDT', interval: '4h' })).toBe(false);
    expect(liveBarMatchesChart(undefined)).toBe(true);
  });

  it('never evaluates a mismatched stream against chart alerts', async () => {
    createAlert({
      name: 'btc above',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 100 },
      cooldownMs: 0,
    });
    // Seed prev below the level through the matching stream.
    await evaluateLiveAlerts(90, { symbol: 'BTCUSDT', interval: '1h' });
    expect(firstAlert().lastFiredAt).toBeUndefined();
    // Same price action on a stale ETH stream must not fire the BTC alert…
    await evaluateLiveAlerts(110, { symbol: 'ETHUSDT', interval: '1h' });
    expect(firstAlert().lastFiredAt).toBeUndefined();
    // …while the matching stream fires.
    await evaluateLiveAlerts(110, { symbol: 'BTCUSDT', interval: '1h' });
    expect(typeof firstAlert().lastFiredAt).toBe('number');
  });

  it('noteLiveBarForAlerts is fire-and-forget and mismatch-safe', async () => {
    createAlert({
      name: 'btc cross',
      symbol: 'BTCUSDT',
      kind: 'price_above',
      params: { price: 100 },
      cooldownMs: 0,
    });
    noteLiveBarForAlerts({ close: 90 }, { symbol: 'BTCUSDT', interval: '1h' });
    await sleep(20);
    noteLiveBarForAlerts({ close: 500 }, { symbol: 'ETHUSDT', interval: '1h' });
    await sleep(20);
    expect(firstAlert().lastFiredAt).toBeUndefined();
    noteLiveBarForAlerts({ close: 500 }, { symbol: 'BTCUSDT', interval: '1h' });
    await sleep(20);
    expect(typeof firstAlert().lastFiredAt).toBe('number');
  });
});

describe('pct_change base latch (F8)', () => {
  it('fixes basePrice at first evaluation instead of sliding every bar', async () => {
    createAlert({
      name: 'mover',
      symbol: 'BTCUSDT',
      kind: 'pct_change',
      params: { pct: 5, direction: 'up' },
      cooldownMs: 0,
    });
    const ctx = (price: number) => ({ symbol: 'BTCUSDT', price, time: Date.now(), bars: [] });
    // First eval at 100 latches base=100; +3% must not fire.
    expect(await evaluateAlerts(ctx(100), { deliver: false })).toHaveLength(0);
    expect(firstAlert().params.basePrice).toBe(100);
    expect(await evaluateAlerts(ctx(103), { deliver: false })).toHaveLength(0);
    // +6% over the latched base fires even though the bar-to-bar move is +3%.
    const fired = await evaluateAlerts(ctx(106), { deliver: false });
    expect(fired).toHaveLength(1);
  });
});
