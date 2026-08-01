/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure alerts engine: cross / above / below / pct / drawing / pine,
 * cooldown, symbol/interval filters, prevPrice tracking.
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  applyFired,
  becomesTrue,
  clearPrevPrices,
  crossesLevel,
  evaluateAlertsSync,
  evaluateOne,
  getPrevPrice,
  isInCooldown,
  normalizeSymbol,
  numParam,
  resolveBasePrice,
  setPrevPrice,
  type Alert,
  type EvaluateContext,
} from '../src/alerts/index';

function baseAlert(over: Partial<Alert> & Pick<Alert, 'kind'>): Alert {
  return {
    id: over.id ?? 'a1',
    name: over.name ?? 'Test',
    enabled: over.enabled ?? true,
    symbol: over.symbol ?? 'BTCUSDT',
    kind: over.kind,
    params: over.params ?? {},
    createdAt: over.createdAt ?? 1_700_000_000_000,
    interval: over.interval,
    webhookUrl: over.webhookUrl,
    notifyBrowser: over.notifyBrowser,
    cooldownMs: over.cooldownMs,
    lastFiredAt: over.lastFiredAt,
  };
}

const now = 1_700_000_100_000;

beforeEach(() => {
  clearPrevPrices();
});

describe('normalizeSymbol / numParam', () => {
  it('normalizes symbol case and trim', () => {
    expect(normalizeSymbol(' btcusdt ')).toBe('BTCUSDT');
    expect(normalizeSymbol('ETH-USD')).toBe('ETH-USD');
  });

  it('numParam accepts number and numeric string', () => {
    expect(numParam({ price: 100 }, 'price')).toBe(100);
    expect(numParam({ price: '42.5' }, 'price')).toBe(42.5);
    expect(numParam({ price: 'x' }, 'price')).toBeNull();
    expect(numParam({}, 'price')).toBeNull();
    expect(numParam({ price: NaN }, 'price')).toBeNull();
  });
});

describe('crossesLevel', () => {
  it('detects upward cross', () => {
    expect(crossesLevel(99, 101, 100)).toBe(true);
    expect(crossesLevel(99, 100, 100)).toBe(true);
  });

  it('detects downward cross', () => {
    expect(crossesLevel(101, 99, 100)).toBe(true);
    expect(crossesLevel(101, 100, 100)).toBe(true);
  });

  it('does not fire when staying on one side', () => {
    expect(crossesLevel(90, 95, 100)).toBe(false);
    expect(crossesLevel(110, 105, 100)).toBe(false);
  });

  it('does not fire when price unchanged', () => {
    expect(crossesLevel(100, 100, 100)).toBe(false);
    expect(crossesLevel(50, 50, 100)).toBe(false);
  });

  it('does not fire when starting exactly on level', () => {
    expect(crossesLevel(100, 101, 100)).toBe(false);
    expect(crossesLevel(100, 99, 100)).toBe(false);
  });
});

describe('becomesTrue / isInCooldown', () => {
  it('becomesTrue edge and first sample', () => {
    expect(becomesTrue(true, undefined)).toBe(true);
    expect(becomesTrue(true, false)).toBe(true);
    expect(becomesTrue(true, true)).toBe(false);
    expect(becomesTrue(false, false)).toBe(false);
    expect(becomesTrue(false, true)).toBe(false);
  });

  it('cooldown blocks within window', () => {
    const a = baseAlert({ kind: 'price_above', cooldownMs: 5_000, lastFiredAt: now - 1_000 });
    expect(isInCooldown(a, now)).toBe(true);
    expect(isInCooldown({ ...a, lastFiredAt: now - 6_000 }, now)).toBe(false);
    expect(isInCooldown({ ...a, cooldownMs: 0 }, now)).toBe(false);
    expect(isInCooldown({ ...a, cooldownMs: undefined, lastFiredAt: now }, now)).toBe(false);
  });
});

describe('price_cross', () => {
  const alert = baseAlert({
    kind: 'price_cross',
    params: { price: 100 },
  });

  it('fires once when price crosses level up', () => {
    expect(evaluateOne(alert, { symbol: 'BTCUSDT', price: 101 }, 99, now)).toBe(true);
  });

  it('fires when crossing down', () => {
    expect(evaluateOne(alert, { symbol: 'BTCUSDT', price: 99 }, 101, now)).toBe(true);
  });

  it('does not fire without prevPrice', () => {
    expect(evaluateOne(alert, { symbol: 'BTCUSDT', price: 101 }, undefined, now)).toBe(false);
  });

  it('does not fire when already above and staying above', () => {
    expect(evaluateOne(alert, { symbol: 'BTCUSDT', price: 105 }, 102, now)).toBe(false);
  });

  it('does not fire when disabled', () => {
    expect(
      evaluateOne({ ...alert, enabled: false }, { symbol: 'BTCUSDT', price: 101 }, 99, now),
    ).toBe(false);
  });

  it('requires matching symbol', () => {
    expect(evaluateOne(alert, { symbol: 'ETHUSDT', price: 101 }, 99, now)).toBe(false);
  });

  it('missing level does not fire', () => {
    expect(
      evaluateOne(
        baseAlert({ kind: 'price_cross', params: {} }),
        { symbol: 'BTCUSDT', price: 101 },
        99,
        now,
      ),
    ).toBe(false);
  });
});

describe('price_above / price_below', () => {
  it('price_above fires on edge into above', () => {
    const a = baseAlert({ kind: 'price_above', params: { price: 100 } });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, 99, now)).toBe(true);
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 102 }, 101, now)).toBe(false);
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 99 }, 98, now)).toBe(false);
  });

  it('price_above fires on first sample if already above', () => {
    const a = baseAlert({ kind: 'price_above', params: { price: 100 } });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, undefined, now)).toBe(true);
  });

  it('price_below fires on edge into below', () => {
    const a = baseAlert({ kind: 'price_below', params: { price: 100 } });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 99 }, 101, now)).toBe(true);
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 98 }, 99, now)).toBe(false);
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, 102, now)).toBe(false);
  });

  it('price_above uses strict greater-than (equal does not fire)', () => {
    const a = baseAlert({ kind: 'price_above', params: { price: 100 } });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 100 }, 99, now)).toBe(false);
  });
});

describe('pct_change', () => {
  it('fires when abs pct from basePrice exceeded (both)', () => {
    const a = baseAlert({
      kind: 'pct_change',
      params: { pct: 5, basePrice: 100 },
    });
    // 6% up from 100
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 106 }, 100, now)).toBe(true);
  });

  it('direction up only', () => {
    const a = baseAlert({
      kind: 'pct_change',
      params: { pct: 5, basePrice: 100, direction: 'up' },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 106 }, 100, now)).toBe(true);
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 94 }, 100, now)).toBe(false);
  });

  it('direction down only', () => {
    const a = baseAlert({
      kind: 'pct_change',
      params: { pct: 5, basePrice: 100, direction: 'down' },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 94 }, 100, now)).toBe(true);
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 106 }, 100, now)).toBe(false);
  });

  it('edge: does not re-fire while still beyond threshold', () => {
    const a = baseAlert({
      kind: 'pct_change',
      params: { pct: 5, basePrice: 100 },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 106 }, 105.5, now)).toBe(false);
  });

  it('resolveBasePrice prefers explicit, then first bar close', () => {
    const ctx: EvaluateContext = {
      symbol: 'BTCUSDT',
      price: 110,
      bars: [
        { time: 1, open: 90, high: 95, low: 90, close: 100 },
        { time: 2, open: 100, high: 110, low: 100, close: 110 },
      ],
    };
    expect(resolveBasePrice({ basePrice: 50 }, ctx, 1)).toBe(50);
    expect(resolveBasePrice({}, ctx, 1)).toBe(100);
  });

  it('uses bars for base when no basePrice', () => {
    const a = baseAlert({ kind: 'pct_change', params: { pct: 10 } });
    const ctx: EvaluateContext = {
      symbol: 'BTCUSDT',
      price: 120,
      bars: [
        { time: 1, open: 100, high: 100, low: 100, close: 100 },
        { time: 2, open: 100, high: 120, low: 100, close: 120 },
      ],
    };
    // 20% from first close 100
    expect(evaluateOne(a, ctx, 100, now)).toBe(true);
  });
});

describe('drawing_touch', () => {
  it('fires when price within tolerance of level', () => {
    const a = baseAlert({
      kind: 'drawing_touch',
      params: { price: 100, tolerance: 0.5 },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 100.4 }, 99, now)).toBe(true);
  });

  it('fires when path crosses drawing level', () => {
    const a = baseAlert({
      kind: 'drawing_touch',
      params: { prices: [100, 200], tolerance: 0 },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, 99, now)).toBe(true);
  });

  it('fires when last bar high/low envelopes level', () => {
    const a = baseAlert({
      kind: 'drawing_touch',
      params: { price: 100, tolerance: 0 },
    });
    const ctx: EvaluateContext = {
      symbol: 'BTCUSDT',
      price: 105,
      bars: [{ time: 1, open: 98, high: 102, low: 97, close: 105 }],
    };
    // prev was also far; bar envelope includes 100
    expect(evaluateOne(a, ctx, 95, now)).toBe(true);
  });

  it('does not re-fire while remaining on level', () => {
    const a = baseAlert({
      kind: 'drawing_touch',
      params: { price: 100, tolerance: 1 },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 100.5 }, 100.2, now)).toBe(false);
  });

  it('no levels → no fire', () => {
    const a = baseAlert({ kind: 'drawing_touch', params: {} });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 100 }, 99, now)).toBe(false);
  });
});

describe('pine_condition', () => {
  it('fires on boolean condition true', () => {
    const a = baseAlert({
      kind: 'pine_condition',
      params: { condition: true },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(true);
  });

  it('boolean with prevCondition edge', () => {
    const a = baseAlert({
      kind: 'pine_condition',
      params: { condition: true, prevCondition: false },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(true);
    const still = baseAlert({
      kind: 'pine_condition',
      params: { condition: true, prevCondition: true },
    });
    expect(evaluateOne(still, { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(false);
  });

  it('value/op/threshold comparisons', () => {
    const mk = (op: string, value: number, threshold: number, prevValue?: number) =>
      baseAlert({
        kind: 'pine_condition',
        params: { op, value, threshold, ...(prevValue != null ? { prevValue } : {}) },
      });

    expect(evaluateOne(mk('>', 5, 3), { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(
      true,
    );
    expect(evaluateOne(mk('<', 2, 3), { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(
      true,
    );
    expect(evaluateOne(mk('>=', 3, 3), { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(
      true,
    );
    expect(evaluateOne(mk('==', 3, 3), { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(
      true,
    );
    expect(evaluateOne(mk('!=', 2, 3), { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(
      true,
    );
    // edge with prevValue
    expect(
      evaluateOne(mk('>', 5, 3, 2), { symbol: 'BTCUSDT', price: 1 }, undefined, now),
    ).toBe(true);
    expect(
      evaluateOne(mk('>', 5, 3, 4), { symbol: 'BTCUSDT', price: 1 }, undefined, now),
    ).toBe(false);
  });

  it('cross op uses prevValue vs threshold', () => {
    const a = baseAlert({
      kind: 'pine_condition',
      params: { op: 'cross', value: 10, threshold: 9, prevValue: 8 },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(true);
  });

  it('false condition does not fire', () => {
    const a = baseAlert({
      kind: 'pine_condition',
      params: { condition: false },
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 1 }, undefined, now)).toBe(false);
  });
});

describe('cooldown on evaluateOne', () => {
  it('blocks fire while cooling down', () => {
    const a = baseAlert({
      kind: 'price_above',
      params: { price: 100 },
      cooldownMs: 60_000,
      lastFiredAt: now - 1_000,
    });
    // Would be true on first sample above, but cooldown blocks
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, undefined, now)).toBe(false);
  });

  it('allows fire after cooldown elapsed', () => {
    const a = baseAlert({
      kind: 'price_above',
      params: { price: 100 },
      cooldownMs: 60_000,
      lastFiredAt: now - 120_000,
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, undefined, now)).toBe(true);
  });
});

describe('interval filter', () => {
  it('matches when alert.interval equals ctx.interval', () => {
    const a = baseAlert({
      kind: 'price_above',
      params: { price: 100 },
      interval: '1h',
    });
    expect(
      evaluateOne(a, { symbol: 'BTCUSDT', price: 101, interval: '1h' }, undefined, now),
    ).toBe(true);
    expect(
      evaluateOne(a, { symbol: 'BTCUSDT', price: 101, interval: '15m' }, undefined, now),
    ).toBe(false);
  });

  it('passes when ctx has no interval', () => {
    const a = baseAlert({
      kind: 'price_above',
      params: { price: 100 },
      interval: '1h',
    });
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 101 }, undefined, now)).toBe(true);
  });
});

describe('evaluateAlertsSync (batch + prevPrice map)', () => {
  it('tracks prevPrice per symbol across calls', () => {
    const alert = baseAlert({ kind: 'price_cross', params: { price: 100 } });

    // First tick: no prev → no fire, but records price
    let fired = evaluateAlertsSync([alert], { symbol: 'BTCUSDT', price: 99 }, now);
    expect(fired).toHaveLength(0);
    expect(getPrevPrice('BTCUSDT')).toBe(99);

    // Cross up
    fired = evaluateAlertsSync([alert], { symbol: 'BTCUSDT', price: 101 }, now + 1);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.lastFiredAt).toBe(now + 1);
    expect(getPrevPrice('btcusdt')).toBe(101);

    // Still above — no second fire
    fired = evaluateAlertsSync([alert], { symbol: 'BTCUSDT', price: 102 }, now + 2);
    expect(fired).toHaveLength(0);
  });

  it('ctx.prevPrice overrides map for that evaluation', () => {
    setPrevPrice('BTCUSDT', 50);
    const alert = baseAlert({ kind: 'price_cross', params: { price: 100 } });
    const fired = evaluateAlertsSync(
      [alert],
      { symbol: 'BTCUSDT', price: 101, prevPrice: 99 },
      now,
    );
    expect(fired).toHaveLength(1);
  });

  it('returns multiple fired alerts for same tick', () => {
    const a1 = baseAlert({
      id: 'x',
      kind: 'price_above',
      params: { price: 100 },
    });
    const a2 = baseAlert({
      id: 'y',
      kind: 'price_below',
      symbol: 'ETHUSDT',
      params: { price: 50 },
    });
    // Only a1 matches symbol
    const fired = evaluateAlertsSync(
      [a1, a2],
      { symbol: 'BTCUSDT', price: 101 },
      now,
    );
    expect(fired.map((f) => f.id)).toEqual(['x']);
  });

  it('skips non-finite price', () => {
    const a = baseAlert({ kind: 'price_above', params: { price: 100 } });
    expect(evaluateAlertsSync([a], { symbol: 'BTCUSDT', price: NaN }, now)).toHaveLength(0);
  });

  it('applyFired updates lastFiredAt by id', () => {
    const list = [
      baseAlert({ id: 'a', kind: 'price_above', params: { price: 1 } }),
      baseAlert({ id: 'b', kind: 'price_above', params: { price: 1 } }),
    ];
    const fired = [{ ...list[0]!, lastFiredAt: 999 }];
    const next = applyFired(list, fired);
    expect(next[0]!.lastFiredAt).toBe(999);
    expect(next[1]!.lastFiredAt).toBeUndefined();
    // original unchanged
    expect(list[0]!.lastFiredAt).toBeUndefined();
  });
});

describe('unknown kind', () => {
  it('does not fire', () => {
    const a = baseAlert({ kind: 'price_cross' });
    (a as { kind: string }).kind = 'nope';
    expect(evaluateOne(a, { symbol: 'BTCUSDT', price: 1 }, 0, now)).toBe(false);
  });
});
