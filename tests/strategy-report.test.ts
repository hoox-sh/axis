/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Strategy report presentation helpers: cumulative equity, SVG polyline,
 * CSV export escaping. Complements strategy.test.ts / strategy-extra.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildCumulativeEquity,
  buildEquitySvgSeries,
  buildStrategyReport,
  equityToSvgPolyline,
  tradesToCsv,
  type ClosedTrade,
} from '../src/results/strategy';

const sampleTrades = (): ClosedTrade[] => [
  {
    id: 'a',
    dir: 'long',
    entryTime: 100,
    entry: 100,
    exitTime: 200,
    exit: 110,
    pnl: 10,
    pnlPct: 0.1,
  },
  {
    id: 'b',
    dir: 'long',
    entryTime: 300,
    entry: 110,
    exitTime: 400,
    exit: 100,
    pnl: -10,
    pnlPct: -0.0909,
  },
  {
    id: 'c',
    dir: 'long',
    entryTime: 500,
    entry: 100,
    exitTime: 600,
    exit: 120,
    pnl: 20,
    pnlPct: 0.2,
  },
];

describe('buildCumulativeEquity', () => {
  it('returns empty for no trades', () => {
    expect(buildCumulativeEquity([])).toEqual([]);
  });

  it('accumulates equity and tracks peak / drawdown', () => {
    const steps = buildCumulativeEquity(sampleTrades());
    expect(steps).toHaveLength(3);
    expect(steps[0]!.equity).toBe(10);
    expect(steps[0]!.peak).toBe(10);
    expect(steps[0]!.drawdown).toBe(0);
    expect(steps[0]!.i).toBe(1);
    expect(steps[0]!.time).toBe(200);

    expect(steps[1]!.equity).toBe(0);
    expect(steps[1]!.peak).toBe(10);
    expect(steps[1]!.drawdown).toBe(10);
    expect(steps[1]!.drawdownPct).toBeGreaterThan(0);

    expect(steps[2]!.equity).toBe(20);
    expect(steps[2]!.peak).toBe(20);
    expect(steps[2]!.drawdown).toBe(0);
  });

  it('matches buildStrategyReport maxDD series peak', () => {
    const events = [
      { time: 1, type: 'entry', id: 'A', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'A', price: 110 },
      { time: 3, type: 'entry', id: 'B', dir: 'long', price: 50 },
      { time: 4, type: 'close', id: 'B', price: 45 },
      { time: 5, type: 'entry', id: 'C', dir: 'long', price: 200 },
      { time: 6, type: 'close', id: 'C', price: 220 },
    ];
    const rep = buildStrategyReport(events);
    const steps = buildCumulativeEquity(rep.trades);
    expect(steps[steps.length - 1]!.equity).toBe(rep.stats.totalPnl);
    // max fractional DD from steps should equal stats.maxDD
    const maxDd = Math.max(...steps.map((s) => s.drawdownPct), 0);
    expect(maxDd).toBeCloseTo(rep.stats.maxDD, 8);
  });
});

describe('equityToSvgPolyline', () => {
  it('handles empty values with a single baseline point', () => {
    const r = equityToSvgPolyline([], 100, 50, 0);
    expect(r.points.split(' ')).toHaveLength(1);
    expect(r.zeroY).not.toBeNull();
  });

  it('prepends origin so one trade yields two points', () => {
    const r = equityToSvgPolyline([10], 100, 50, 0);
    const pts = r.points.split(' ');
    expect(pts).toHaveLength(2);
    // first point is baseline (0), second is elevated
    const y0 = Number(pts[0]!.split(',')[1]);
    const y1 = Number(pts[1]!.split(',')[1]);
    expect(y1).toBeLessThan(y0); // SVG y grows downward → higher equity is lower y
  });

  it('maps rising series left-to-right within pad', () => {
    const r = equityToSvgPolyline([1, 2, 3], 100, 40, 10);
    const pts = r.points.split(' ').map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { x: x!, y: y! };
    });
    // origin + 3 values
    expect(pts).toHaveLength(4);
    expect(pts[0]!.x).toBeCloseTo(10, 5);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(90, 5);
    // equity rising → y decreasing
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeLessThanOrEqual(pts[i - 1]!.y + 1e-9);
    }
  });

  it('places zeroY when range spans zero', () => {
    const r = equityToSvgPolyline([10, -5], 100, 100, 0);
    expect(r.min).toBeLessThan(0);
    expect(r.max).toBeGreaterThan(0);
    expect(r.zeroY).not.toBeNull();
    expect(r.zeroY!).toBeGreaterThan(0);
    expect(r.zeroY!).toBeLessThan(100);
  });

  it('flat series still produces finite points', () => {
    const r = equityToSvgPolyline([5, 5, 5], 80, 40, 4);
    expect(r.points.length).toBeGreaterThan(0);
    expect(Number.isFinite(r.min)).toBe(true);
    expect(r.max).toBeGreaterThan(r.min);
  });
});

describe('buildEquitySvgSeries', () => {
  it('returns equity and drawdown polylines for closed trades', () => {
    const s = buildEquitySvgSeries(sampleTrades(), 200, 80, 4);
    expect(s.steps).toHaveLength(3);
    expect(s.equity.points.split(' ').length).toBe(4); // origin + 3
    expect(s.drawdown.points.split(' ').length).toBe(4);
  });
});

describe('tradesToCsv', () => {
  it('exports header and rows', () => {
    const csv = tradesToCsv(sampleTrades());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,dir,entry_time,entry,exit_time,exit,pnl,pnl_pct');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('a,long,100,100,200,110,10,0.1');
  });

  it('escapes id/dir fields with commas and quotes', () => {
    const csv = tradesToCsv([
      {
        id: 'a,b',
        dir: 'long "special"',
        entryTime: 1,
        entry: 1,
        exitTime: 2,
        exit: 2,
        pnl: 1,
        pnlPct: 1,
      },
    ]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"long ""special"""');
  });

  it('returns header-only for empty trades', () => {
    const csv = tradesToCsv([]);
    expect(csv).toBe('id,dir,entry_time,entry,exit_time,exit,pnl,pnl_pct');
  });
});
