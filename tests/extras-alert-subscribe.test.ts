/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import './setup';
import { describe, expect, it } from 'bun:test';
import {
  evaluateAlerts,
  subscribeFiredAlerts,
  type FiredAlertEvent,
} from '../src/alerts';

describe('subscribeFiredAlerts', () => {
  it('notifies listeners with fired alerts + price', async () => {
    const seen: FiredAlertEvent[] = [];
    const unsub = subscribeFiredAlerts((e) => seen.push(e));
    await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 100, bars: [], time: Date.now() },
      { deliver: false },
    );
    expect(seen).toEqual([]);
    unsub();
  });

  it('unsubscribe stops events', async () => {
    let n = 0;
    const unsub = subscribeFiredAlerts(() => {
      n += 1;
    });
    unsub();
    await evaluateAlerts(
      { symbol: 'BTCUSDT', price: 100, bars: [], time: Date.now() },
      { deliver: false },
    );
    expect(n).toBe(0);
  });
});
