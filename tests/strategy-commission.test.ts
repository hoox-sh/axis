/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Commission model on the strategy report: both legs are charged, partial
 * exits only bill their share of entry fees, and stats expose the fee total.
 */

import { describe, expect, it } from 'bun:test';
import { buildStrategyReport, fillCommission, type CommissionModel } from '../src/results/strategy';

const entry = (id: string, dir: 'long' | 'short', time: number, price: number, qty = 1) => ({
  type: 'entry',
  dir,
  id,
  time,
  price,
  qty,
});

const close = (id: string, dir: 'long' | 'short', time: number, price: number, qty = 1) => ({
  type: 'close',
  dir,
  id,
  time,
  price,
  qty,
});

const PERCENT_10BPS: CommissionModel = { type: 'percent', value: 0.01 };

describe('fillCommission', () => {
  it('charges percent of notional', () => {
    // 0.01% of 100 × 2 = 0.02
    expect(fillCommission(PERCENT_10BPS, 100, 2)).toBeCloseTo(0.02, 10);
  });
  it('charges a flat amount per order regardless of size', () => {
    const m: CommissionModel = { type: 'cash_per_order', value: 1.5 };
    expect(fillCommission(m, 100, 1)).toBe(1.5);
    expect(fillCommission(m, 100, 50)).toBe(1.5);
  });
  it('charges per contract', () => {
    const m: CommissionModel = { type: 'cash_per_contract', value: 0.25 };
    expect(fillCommission(m, 100, 4)).toBe(1);
  });
  it('is zero without a model, a value, or a quantity', () => {
    expect(fillCommission(null, 100, 1)).toBe(0);
    expect(fillCommission(undefined, 100, 1)).toBe(0);
    expect(fillCommission({ type: 'percent', value: 0 }, 100, 1)).toBe(0);
    expect(fillCommission({ type: 'percent', value: -1 }, 100, 1)).toBe(0);
    expect(fillCommission(PERCENT_10BPS, 100, 0)).toBe(0);
  });
  it('ignores a non-finite price for percent, but not for cash models', () => {
    expect(fillCommission(PERCENT_10BPS, Number.NaN, 1)).toBe(0);
    expect(fillCommission({ type: 'cash_per_order', value: 2 }, Number.NaN, 1)).toBe(2);
  });
});

describe('buildStrategyReport commission', () => {
  it('nets both legs out of the trade P&L', () => {
    const { trades, stats } = buildStrategyReport(
      [entry('a', 'long', 100, 100), close('a', 'long', 200, 110)],
      [],
      { commission: { type: 'cash_per_order', value: 1 } },
    );
    expect(trades).toHaveLength(1);
    // Gross 10, two fills at 1 each.
    expect(trades[0]?.pnl).toBeCloseTo(8, 10);
    expect(trades[0]?.commission).toBeCloseTo(2, 10);
    expect(stats.totalPnl).toBeCloseTo(8, 10);
    expect(stats.totalCommission).toBeCloseTo(2, 10);
    expect(stats.grossPnl).toBeCloseTo(10, 10);
  });

  it('charges shorts the same way', () => {
    const { trades } = buildStrategyReport(
      [entry('s', 'short', 100, 100), close('s', 'short', 200, 90)],
      [],
      { commission: { type: 'cash_per_order', value: 1 } },
    );
    expect(trades[0]?.pnl).toBeCloseTo(8, 10);
  });

  it('bills a partial exit only its share of entry fees', () => {
    // Entry 2 units, flat 2 per fill. Half closed → 1 of the 2 entry fee.
    const { trades, stats } = buildStrategyReport(
      [
        entry('p', 'long', 100, 100, 2),
        close('p', 'long', 200, 110, 1),
        close('p', 'long', 300, 120, 1),
      ],
      [],
      { commission: { type: 'cash_per_order', value: 2 } },
    );
    expect(trades).toHaveLength(2);
    // Leg 1: gross 10 − (1 entry share + 2 exit) = 7
    expect(trades[0]?.pnl).toBeCloseTo(7, 10);
    // Leg 2: gross 20 − (1 entry share + 2 exit) = 17
    expect(trades[1]?.pnl).toBeCloseTo(17, 10);
    // Entry cost 2 for the one opening order, plus 2 per exit = 6 total.
    // The entry fee is split across the legs, never billed twice.
    expect(stats.totalCommission).toBeCloseTo(6, 10);
  });

  it('accumulates entry commission when pyramiding', () => {
    const { trades, stats } = buildStrategyReport(
      [
        entry('y', 'long', 100, 100, 1),
        entry('y', 'long', 150, 120, 1),
        close('y', 'long', 200, 130, 2),
      ],
      [],
      { commission: { type: 'cash_per_order', value: 1 } },
    );
    // Avg entry 110, exit 130, qty 2 → gross 40; three fills × 1 = 3.
    expect(trades[0]?.pnl).toBeCloseTo(37, 10);
    expect(stats.totalCommission).toBeCloseTo(3, 10);
  });

  it('leaves P&L untouched when no model is given', () => {
    const { trades, stats } = buildStrategyReport([
      entry('a', 'long', 100, 100),
      close('a', 'long', 200, 110),
    ]);
    expect(trades[0]?.pnl).toBeCloseTo(10, 10);
    expect(trades[0]?.commission).toBeUndefined();
    expect(stats.totalCommission).toBeUndefined();
    expect(stats.grossPnl).toBeUndefined();
  });

  it('feeds the fee into win rate and profit factor', () => {
    // A 1.5 gross win that costs 2 in fees is a net loser.
    const { trades, stats } = buildStrategyReport(
      [entry('w', 'long', 100, 100), close('w', 'long', 200, 101.5)],
      [],
      { commission: { type: 'cash_per_order', value: 1 } },
    );
    expect(trades[0]?.pnl).toBeLessThan(0);
    expect(stats.winRate).toBe(0);
    expect(stats.losses).toBe(1);
  });
});

describe('drawdown is reported in money', () => {
  it('measures peak-to-trough in currency, not a bogus percent', () => {
    // +10 then −25 → equity peaks at 10, troughs at −15 → DD of 25.
    const { stats } = buildStrategyReport([
      entry('a', 'long', 100, 100),
      close('a', 'long', 200, 110),
      entry('b', 'long', 300, 110),
      close('b', 'long', 400, 85),
    ]);
    expect(stats.maxDrawdown).toBeCloseTo(25, 10);
    // The ratio stays bounded and is not what the UI renders.
    expect(stats.maxDD).toBeGreaterThan(0);
    expect(stats.maxDD).toBeLessThanOrEqual(1);
  });

  it('is zero when equity only rises', () => {
    const { stats } = buildStrategyReport([
      entry('a', 'long', 100, 100),
      close('a', 'long', 200, 110),
    ]);
    expect(stats.maxDrawdown).toBe(0);
  });
});
