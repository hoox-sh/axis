/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Position-view model (Events tab Open ⇄ Close) + pyramiding semantics:
 * same-id entries average into the live position, closes realize
 * `(exit − avg) × close_qty`, re-opens after a full close form new cycles.
 */

import { describe, expect, it } from 'bun:test';
import { buildStrategyReport, walkStrategyEvents } from '../src/results/strategy.ts';
import { buildPositionViews } from '../src/results/positions.ts';

describe('buildPositionViews', () => {
  it('returns empty views for empty events', () => {
    const r = buildPositionViews([]);
    expect(r.positions).toHaveLength(0);
    expect(r.stream).toHaveLength(0);
  });

  it('groups open + close into one position cycle with per-fill P&L', () => {
    const events = [
      { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100, qty: 2 },
      { time: 2, type: 'close', id: 'L', dir: 'long', price: 110, qty: 2 },
    ];
    const { positions, stream } = buildPositionViews(events);
    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.id).toBe('L');
    expect(p.dir).toBe('long');
    expect(p.status).toBe('closed');
    expect(p.totalQty).toBe(2);
    expect(p.openQty).toBe(0);
    expect(p.avgPrice).toBe(100);
    expect(p.closes).toHaveLength(1);
    expect(p.closes[0]!.pnl).toBeCloseTo(20);
    expect(p.realizedPnl).toBeCloseTo(20);
    // Stream enrichment: entry carries posQty/avg/fills, close carries pnl/remaining
    expect(stream).toHaveLength(2);
    expect(stream[0]!.posQty).toBe(2);
    expect(stream[0]!.posAvg).toBe(100);
    expect(stream[0]!.fills).toBe(1);
    expect(stream[1]!.pnl).toBeCloseTo(20);
    expect(stream[1]!.remaining).toBe(0);
    expect(stream[1]!.cycle).toBe(1);
  });

  it('averages pyramiding entries into the position (avg price)', () => {
    const events = [
      { time: 1, type: 'entry', id: 'P', dir: 'long', price: 100, qty: 1 },
      { time: 2, type: 'entry', id: 'P', dir: 'long', price: 120, qty: 1 },
      { time: 3, type: 'close', id: 'P', dir: 'long', price: 130, qty: 2 },
    ];
    const { positions } = buildPositionViews(events);
    expect(positions).toHaveLength(1);
    const p = positions[0]!;
    expect(p.opens).toHaveLength(2);
    expect(p.avgPrice).toBeCloseTo(110);
    expect(p.totalQty).toBe(2);
    expect(p.status).toBe('closed');
    // P&L vs avg entry: (130 − 110) × 2
    expect(p.realizedPnl).toBeCloseTo(40);
    expect(p.closes[0]!.qty).toBe(2);
  });

  it('splits partial closes and keeps the remainder open', () => {
    const events = [
      { time: 1, type: 'entry', id: 'P', dir: 'long', price: 100, qty: 3 },
      { time: 2, type: 'exit', id: 'P', dir: 'long', price: 110, qty: 1 },
    ];
    const { positions } = buildPositionViews(events);
    const p = positions[0]!;
    expect(p.status).toBe('open');
    expect(p.openQty).toBe(2);
    expect(p.closes).toHaveLength(1);
    expect(p.closes[0]!.pnl).toBeCloseTo(10);
    expect(p.realizedPnl).toBeCloseTo(10);
  });

  it('opens a new cycle when the same id re-enters after a full close', () => {
    const events = [
      { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'L', price: 105 },
      { time: 3, type: 'entry', id: 'L', dir: 'long', price: 110 },
    ];
    const { positions } = buildPositionViews(events);
    expect(positions).toHaveLength(2);
    expect(positions[0]!.cycle).toBe(1);
    expect(positions[0]!.status).toBe('closed');
    expect(positions[1]!.cycle).toBe(2);
    expect(positions[1]!.status).toBe('open');
  });

  it('handles close_all across multiple positions', () => {
    const events = [
      { time: 1, type: 'entry', id: 'A', dir: 'long', price: 100 },
      { time: 1, type: 'entry', id: 'B', dir: 'short', price: 50 },
      { time: 2, type: 'close_all', price: 60 },
    ];
    const { positions } = buildPositionViews(events);
    expect(positions).toHaveLength(2);
    expect(positions.every((p) => p.status === 'closed')).toBe(true);
    // A long 100 → 60 = −40; B short 50 → 60 = −10
    expect(positions[0]!.realizedPnl).toBeCloseTo(-40);
    expect(positions[1]!.realizedPnl).toBeCloseTo(-10);
  });

  it('respects from_entry pairing when multiple positions are open', () => {
    const events = [
      { time: 1, type: 'entry', id: 'Long1', dir: 'long', price: 100 },
      { time: 2, type: 'entry', id: 'Short1', dir: 'short', price: 90 },
      { time: 3, type: 'exit', from_entry: 'Short1', price: 80 },
    ];
    const { positions } = buildPositionViews(events);
    expect(positions).toHaveLength(2);
    const short = positions.find((p) => p.dir === 'short')!;
    expect(short.status).toBe('closed');
    expect(short.closes[0]!.pnl).toBeCloseTo(10);
    const long = positions.find((p) => p.dir === 'long')!;
    expect(long.status).toBe('open');
  });
});

describe('buildStrategyReport pyramiding', () => {
  it('averages pyramided entries and reports entryFills', () => {
    const events = [
      { time: 1, type: 'entry', id: 'P', dir: 'long', price: 100, qty: 1 },
      { time: 2, type: 'entry', id: 'P', dir: 'long', price: 140, qty: 1 },
      { time: 3, type: 'close', id: 'P', price: 120, qty: 2 },
    ];
    const r = buildStrategyReport(events);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.entry).toBeCloseTo(120);
    expect(r.trades[0]!.qty).toBe(2);
    expect(r.trades[0]!.entryFills).toBe(2);
    expect(r.trades[0]!.pnl).toBeCloseTo(0);
  });

  it('computes barsHeld from loaded bars', () => {
    const bars = [
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 2, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 3, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: 4, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const events = [
      { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100 },
      { time: 3, type: 'close', id: 'L', price: 105 },
    ];
    const r = buildStrategyReport(events, bars as never);
    expect(r.trades[0]!.barsHeld).toBe(2);
  });

  it('exposes gross profit / loss and compounded return', () => {
    const events = [
      { time: 1, type: 'entry', id: 'A', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'A', price: 120 },
      { time: 3, type: 'entry', id: 'B', dir: 'long', price: 100 },
      { time: 4, type: 'close', id: 'B', price: 90 },
    ];
    const r = buildStrategyReport(events);
    expect(r.stats.grossProfit).toBeCloseTo(20);
    expect(r.stats.grossLoss).toBeCloseTo(10);
    // (1 + 0.2) × (1 − 0.1) − 1
    expect(r.stats.returnPct ?? 0).toBeCloseTo(0.08);
  });

  it('walkStrategyEvents is the single source shared by both views', () => {
    const events = [
      { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'L', price: 110 },
    ];
    const walk = walkStrategyEvents(events);
    expect(walk.trades).toHaveLength(1);
    expect(walk.positions).toHaveLength(1);
    expect(walk.stream).toHaveLength(2);
  });
});
