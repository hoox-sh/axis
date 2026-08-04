/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Strategy tester + event normalizer: parity API events → closed trades,
 * markers, equity curve. Guards report totals and entry/exit pairing.
 */

import { describe, expect, it } from 'bun:test';
import { buildStrategyReport } from '../src/results/strategy.ts';
import {
  normalizeStrategyEvents,
  eventsToMarkers,
  buildEquityCurve,
  isNoFillCloseEvent,
} from '../src/results/events.ts';

describe('Strategy tester', () => {
  it('returns no trades for an empty event list', () => {
    const r = buildStrategyReport([]);
    expect(r.trades).toHaveLength(0);
    expect(r.stats.winRate).toBe(0);
    expect(r.stats.profitFactor).toBe(0);
  });

  it('pairs entries with subsequent closes (legacy fields)', () => {
    const events = [
      { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'L', price: 110 },
    ];
    const r = buildStrategyReport(events);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].pnl).toBe(10);
    expect(r.trades[0].pnlPct).toBeCloseTo(0.1);
  });

  it('pairs Pro API parity events (kind/bar_time/direction/ohlc)', () => {
    const events = [
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        qty: 1,
        bar_index: 5,
        bar_time: 1300,
        ohlc: [100, 102, 99, 101],
        script_id: '',
        run_id: '',
      },
      {
        kind: 'close',
        id: 'L',
        direction: null,
        qty: 1,
        bar_index: 15,
        bar_time: 1900,
        ohlc: [110, 112, 109, 111],
        script_id: '',
        run_id: '',
      },
    ];
    const r = buildStrategyReport(events as any);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entry).toBe(101);
    expect(r.trades[0].exit).toBe(111);
    expect(r.trades[0].pnl).toBe(10);
  });

  it('resolves price from bars when ohlc is zeros', () => {
    const bars = [
      { time: 1000, open: 1, high: 2, low: 0.5, close: 50 },
      { time: 1060, open: 1, high: 2, low: 0.5, close: 55 },
    ];
    const events = [
      {
        kind: 'entry',
        id: 'A',
        direction: 'long',
        bar_time: 1000,
        bar_index: 0,
        ohlc: [0, 0, 0, 0],
      },
      {
        kind: 'close',
        id: 'A',
        bar_time: 1060,
        bar_index: 1,
        ohlc: [0, 0, 0, 0],
      },
    ];
    const r = buildStrategyReport(events as any, bars);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entry).toBe(50);
    expect(r.trades[0].exit).toBe(55);
    expect(r.trades[0].pnl).toBe(5);
  });

  it('inverts PnL for short positions', () => {
    const events = [
      { time: 1, type: 'entry', id: 'S', dir: 'short', price: 100 },
      { time: 2, type: 'close', id: 'S', price: 90 },
    ];
    const r = buildStrategyReport(events);
    expect(r.trades[0].pnl).toBe(10);
  });

  it('scales money PnL by fill qty (percent-of-equity / multi-contract)', () => {
    const events = [
      { time: 1, type: 'entry', id: 'L', dir: 'long', price: 100, qty: 2.5 },
      { time: 2, type: 'close', id: 'L', price: 110, qty: 2.5 },
    ];
    const r = buildStrategyReport(events);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.qty).toBe(2.5);
    // (110-100) * 2.5 = 25
    expect(r.trades[0]!.pnl).toBe(25);
    // % is still price move only
    expect(r.trades[0]!.pnlPct).toBeCloseTo(0.1);
    expect(r.stats.totalPnl).toBe(25);
  });

  it('uses engine profit field when present on close', () => {
    const events = [
      { time: 1, kind: 'entry', id: 'L', direction: 'long', price: 100, qty: 1 },
      {
        time: 2,
        kind: 'close',
        id: 'L',
        price: 110,
        qty: 1,
        profit: 42.5,
      },
    ];
    const r = buildStrategyReport(events as never[]);
    expect(r.trades[0]!.pnl).toBe(42.5);
  });

  it('handles multiple trades and computes winRate + avg', () => {
    const events = [
      { time: 1, type: 'entry', id: 'A', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'A', price: 110 },
      { time: 3, type: 'entry', id: 'B', dir: 'long', price: 50 },
      { time: 4, type: 'close', id: 'B', price: 45 },
      { time: 5, type: 'entry', id: 'C', dir: 'long', price: 200 },
      { time: 6, type: 'close', id: 'C', price: 220 },
    ];
    const r = buildStrategyReport(events);
    expect(r.trades).toHaveLength(3);
    expect(r.stats.wins).toBe(2);
    expect(r.stats.losses).toBe(1);
    expect(r.stats.totalPnl).toBe(25);
    expect(r.stats.winRate).toBeCloseTo(66.666, 1);
    expect(r.stats.avgTrade).toBeCloseTo(25 / 3);
  });

  it('ignores closes without a matching entry', () => {
    const events = [{ time: 1, type: 'close', id: 'X', price: 100 }];
    const r = buildStrategyReport(events);
    expect(r.trades).toHaveLength(0);
  });

  it('supports closing only the matching id', () => {
    const events = [
      { time: 1, type: 'entry', id: 'A', dir: 'long', price: 100 },
      { time: 2, type: 'entry', id: 'B', dir: 'long', price: 200 },
      { time: 3, type: 'close', id: 'A', price: 110 },
    ];
    const r = buildStrategyReport(events);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].id).toBe('A');
    expect(r.trades[0].pnl).toBe(10);
  });

  it('computes profitFactor as Infinity when there are no losses', () => {
    const events = [
      { time: 1, type: 'entry', id: 'A', dir: 'long', price: 100 },
      { time: 2, type: 'close', id: 'A', price: 110 },
    ];
    const r = buildStrategyReport(events);
    expect(r.stats.profitFactor).toBe(Infinity);
  });
});

describe('eventsToMarkers', () => {
  it('builds long entry belowBar and exit aboveBar', () => {
    const events = normalizeStrategyEvents([
      { kind: 'entry', id: 'L', direction: 'long', bar_time: 10, ohlc: [1, 1, 1, 100] },
      { kind: 'close', id: 'L', bar_time: 20, ohlc: [1, 1, 1, 110] },
    ]);
    const markers = eventsToMarkers(events);
    expect(markers).toHaveLength(2);
    expect(markers[0].shape).toBe('arrowUp');
    expect(markers[0].position).toBe('belowBar');
    expect(markers[1].shape).toBe('arrowDown');
    expect(markers[1].position).toBe('aboveBar');
  });

  it('keeps both entry and exit markers on the same bar', () => {
    // LWC v5 stacks same-time markers — do not collapse to last-only
    const events = normalizeStrategyEvents([
      { kind: 'entry', id: 'L', direction: 'long', bar_time: 10, ohlc: [1, 1, 1, 100] },
      { kind: 'exit', id: 'X', from_entry: 'L', bar_time: 10, ohlc: [1, 1, 1, 101] },
    ]);
    const markers = eventsToMarkers(events);
    expect(markers).toHaveLength(2);
    expect(markers[0].shape).toBe('arrowUp');
    expect(markers[1].shape).toBe('arrowDown');
    expect(markers[0].time).toBe(markers[1].time);
  });

  it('skips pending order events when includeOrders false', () => {
    const events = normalizeStrategyEvents(
      [
        { kind: 'order', id: 'P', bar_time: 5, ohlc: [1, 1, 1, 50] },
        { kind: 'entry', id: 'L', direction: 'long', bar_time: 10, ohlc: [1, 1, 1, 100] },
      ],
      { includeOrders: false },
    );
    expect(events.every((e) => e.type !== 'order')).toBe(true);
    expect(eventsToMarkers(events)).toHaveLength(1);
  });

  it('does not draw markers for cancel / cancel_all (markers path)', () => {
    // Pro API: strategy.cancel / cancel_all emit kind cancel|cancel_all — never entries
    const events = normalizeStrategyEvents(
      [
        {
          kind: 'order',
          id: 'L',
          direction: 'long',
          qty: 1,
          bar_time: 5,
          ohlc: [1, 1, 1, 50],
        },
        { kind: 'cancel', id: 'L', qty: null, bar_time: 6, ohlc: [1, 1, 1, 50] },
        { kind: 'cancel_all', id: null, bar_time: 7, ohlc: [1, 1, 1, 51] },
        {
          kind: 'entry',
          id: 'L',
          direction: 'long',
          qty: 1,
          bar_time: 10,
          ohlc: [1, 1, 1, 100],
        },
      ],
      { includeOrders: false },
    );
    expect(events.map((e) => e.kind)).toEqual(['entry']);
    const markers = eventsToMarkers(events);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.shape).toBe('arrowUp');
    expect(markers[0]!.text).toBe('L');
  });

  it('even with includeOrders, eventsToMarkers ignores cancel kinds', () => {
    const events = normalizeStrategyEvents(
      [
        { kind: 'cancel', id: 'X', bar_time: 1, ohlc: [1, 1, 1, 10] },
        { kind: 'cancel_all', id: null, bar_time: 2, ohlc: [1, 1, 1, 11] },
        { kind: 'order', id: 'P', direction: 'long', bar_time: 3, ohlc: [1, 1, 1, 12] },
      ],
      { includeOrders: true },
    );
    expect(events.length).toBe(3);
    expect(eventsToMarkers(events)).toHaveLength(0);
  });

  it('drops zero-qty close/exit (Pro no-fill) from markers and report', () => {
    // pyne: strategy.close while flat → kind close, qty 0.0
    const raw = [
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        qty: 1,
        bar_time: 10,
        ohlc: [100, 100, 100, 100],
      },
      {
        kind: 'close',
        id: 'L',
        direction: null,
        qty: 0,
        bar_time: 15,
        ohlc: [105, 105, 105, 105],
      },
      {
        kind: 'close',
        id: 'L',
        direction: 'long',
        qty: 1,
        bar_time: 20,
        ohlc: [110, 110, 110, 110],
      },
      // flat no-op after real close
      {
        kind: 'close',
        id: 'L',
        qty: 0.0,
        bar_time: 25,
        ohlc: [111, 111, 111, 111],
      },
      {
        kind: 'exit',
        id: 'TP',
        from_entry: 'L',
        qty: 0,
        bar_time: 30,
        ohlc: [112, 112, 112, 112],
      },
    ];
    const events = normalizeStrategyEvents(raw as any, { includeOrders: false });
    expect(events.map((e) => e.kind)).toEqual(['entry', 'close']);
    expect(events.every((e) => e.qty !== 0)).toBe(true);

    const markers = eventsToMarkers(events);
    expect(markers).toHaveLength(2);
    expect(markers[0]!.shape).toBe('arrowUp');
    expect(markers[1]!.shape).toBe('arrowDown');

    const report = buildStrategyReport(raw as any);
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0]!.pnl).toBe(10);
  });

  it('eventsToMarkers skips qty=0 close even if normalize was skipped', () => {
    const markers = eventsToMarkers([
      { kind: 'entry', type: 'entry', id: 'L', dir: 'long', time: 1, qty: 1 },
      { kind: 'close', type: 'close', id: 'L', time: 2, qty: 0 },
    ] as never[]);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.shape).toBe('arrowUp');
  });
});

describe('buildEquityCurve', () => {
  it('accumulates pnl on initial capital', () => {
    const curve = buildEquityCurve(
      [
        { exitTime: 2, pnl: 10 },
        { exitTime: 4, pnl: -5 },
      ],
      10000,
    );
    expect(curve).toEqual([
      { time: 2, value: 10010 },
      { time: 4, value: 10005 },
    ]);
  });

  it('coalesces same-bar exits into one equity point', () => {
    const curve = buildEquityCurve(
      [
        { exitTime: 5, pnl: 10 },
        { exitTime: 5, pnl: -3 },
      ],
      1000,
    );
    expect(curve).toEqual([{ time: 5, value: 1007 }]);
  });
});

describe('pyne-shaped pairing gaps', () => {
  it('pairs strategy.exit via from_entry when exit order id differs', () => {
    // pyne: entry id="L"; exit id="TP" from_entry="L"
    const events = [
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        bar_time: 100,
        ohlc: [100, 101, 99, 100],
      },
      {
        kind: 'entry',
        id: 'S',
        direction: 'short',
        bar_time: 110,
        ohlc: [200, 201, 199, 200],
      },
      {
        kind: 'exit',
        id: 'TP',
        from_entry: 'L',
        bar_time: 120,
        ohlc: [110, 111, 109, 110],
      },
    ];
    const r = buildStrategyReport(events as any);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].id).toBe('L');
    expect(r.trades[0].pnl).toBe(10);
  });

  it('pairs exit by sole open when exit id is order name (no from_entry)', () => {
    // Real pyne event shape omits from_entry; sole open still pairs
    const events = [
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        bar_time: 100,
        ohlc: [50, 51, 49, 50],
      },
      {
        kind: 'exit',
        id: 'XL',
        direction: null,
        bar_time: 200,
        ohlc: [55, 56, 54, 55],
      },
    ];
    const r = buildStrategyReport(events as any);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].pnl).toBe(5);
  });

  it('close_all flattens every open position', () => {
    const events = [
      { kind: 'entry', id: 'A', direction: 'long', bar_time: 1, ohlc: [10, 10, 10, 10] },
      { kind: 'entry', id: 'B', direction: 'long', bar_time: 2, ohlc: [20, 20, 20, 20] },
      { kind: 'close_all', id: null, bar_time: 3, ohlc: [25, 25, 25, 25] },
    ];
    const r = buildStrategyReport(events as any);
    expect(r.trades).toHaveLength(2);
    expect(r.stats.totalPnl).toBe(15 + 5);
  });

  it('pairs same-bar entry then exit (kind order)', () => {
    const events = [
      // exit listed first in payload — sort must still process entry first
      { kind: 'exit', id: 'L', bar_time: 50, ohlc: [110, 110, 110, 110] },
      { kind: 'entry', id: 'L', direction: 'long', bar_time: 50, ohlc: [100, 100, 100, 100] },
    ];
    const r = buildStrategyReport(events as any);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].pnl).toBe(10);
  });

  it('aligns event seconds to ms bars for price + pairing', () => {
    const bars = [
      { time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 80 },
      { time: 1_700_086_400_000, open: 1, high: 2, low: 0.5, close: 90 },
    ];
    const events = [
      {
        kind: 'entry',
        id: 'A',
        direction: 'long',
        bar_time: 1_700_000_000,
        ohlc: [0, 0, 0, 0],
      },
      {
        kind: 'close',
        id: 'A',
        bar_time: 1_700_086_400,
        ohlc: [0, 0, 0, 0],
      },
    ];
    const r = buildStrategyReport(events as any, bars);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entry).toBe(80);
    expect(r.trades[0].exit).toBe(90);
  });
});

/**
 * PYNE may emit a `kind: "close"` row for every `strategy.close(..., when=cond)`
 * evaluation — including when=false / flat. Those events always carry qty=0 and
 * must not become fake exits, markers, or closed trades.
 */
describe('no-fill strategy.close spam (qty=0)', () => {
  /** Shape from a real "5212 EMA Strategy" run: thousands of closes, 0 entries. */
  function closeSpamEvent(
    barIndex: number,
    id: string,
    barTime: number,
  ): Record<string, unknown> {
    return {
      kind: 'close',
      id,
      direction: null,
      qty: 0,
      bar_index: barIndex,
      bar_time: barTime,
      ohlc: [100 + barIndex, 101 + barIndex, 99 + barIndex, 100.5 + barIndex],
      comment: id,
      script_id: '',
      run_id: '',
    };
  }

  it('isNoFillCloseEvent detects explicit qty≤0 closes only', () => {
    expect(isNoFillCloseEvent({ kind: 'close', qty: 0 })).toBe(true);
    expect(isNoFillCloseEvent({ kind: 'exit', qty: 0 })).toBe(true);
    expect(isNoFillCloseEvent({ type: 'close', qty: -1 })).toBe(true);
    expect(isNoFillCloseEvent({ kind: 'close', qty: 1 })).toBe(false);
    // Legacy payloads omit qty on real fills — keep them
    expect(isNoFillCloseEvent({ kind: 'close', id: 'L' })).toBe(false);
    expect(isNoFillCloseEvent({ kind: 'entry', qty: 0 })).toBe(false);
  });

  it('normalize drops qty=0 close spam and keeps real fills', () => {
    const raw = [
      closeSpamEvent(0, 'EX Long', 1000),
      closeSpamEvent(1, 'MD Short', 1060),
      closeSpamEvent(2, 'EX Long', 1120),
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        qty: 1,
        bar_time: 1200,
        ohlc: [100, 101, 99, 100],
      },
      {
        kind: 'close',
        id: 'L',
        direction: null,
        qty: 1,
        bar_time: 1300,
        ohlc: [110, 111, 109, 110],
      },
      // legacy close without qty still kept
      {
        kind: 'close',
        id: 'legacy',
        bar_time: 1400,
        ohlc: [1, 1, 1, 1],
      },
    ];
    const n = normalizeStrategyEvents(raw);
    expect(n.every((e) => e.qty !== 0)).toBe(true);
    expect(n.filter((e) => String(e.kind).includes('close'))).toHaveLength(2);
    expect(n.find((e) => e.id === 'L' && e.kind === 'entry')).toBeTruthy();
  });

  it('buildStrategyReport yields 0 trades on close-only qty=0 spam', () => {
    const spam = Array.from({ length: 200 }, (_, i) =>
      closeSpamEvent(i, i % 2 === 0 ? 'EX Long' : 'MD Short', 1000 + i * 60),
    );
    const r = buildStrategyReport(spam as any);
    expect(r.trades).toHaveLength(0);
    expect(r.stats.trades).toBe(0);
    expect(r.stats.totalPnl).toBe(0);
  });

  it('does not pair qty=0 spam closes onto a real open (sole-open trap)', () => {
    // Without filtering, sole-open fallback would close "L" on the first spam id
    const events = [
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        qty: 1,
        bar_time: 1000,
        ohlc: [100, 101, 99, 100],
      },
      closeSpamEvent(1, 'EX Long', 1060),
      closeSpamEvent(2, 'MD Short', 1120),
      // real fill later
      {
        kind: 'close',
        id: 'L',
        direction: null,
        qty: 1,
        bar_time: 1300,
        ohlc: [115, 116, 114, 115],
      },
    ];
    const r = buildStrategyReport(events as any);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.id).toBe('L');
    expect(r.trades[0]!.entry).toBe(100);
    expect(r.trades[0]!.exit).toBe(115);
    expect(r.trades[0]!.pnl).toBe(15);
  });

  it('eventsToMarkers ignores close-only spam (no phantom exits when flat)', () => {
    const spam = Array.from({ length: 50 }, (_, i) =>
      closeSpamEvent(i, 'EX Long', 1000 + i),
    );
    const markers = eventsToMarkers(normalizeStrategyEvents(spam));
    expect(markers).toHaveLength(0);
  });

  it('eventsToMarkers still draws real entry→exit around spam noise', () => {
    const events = normalizeStrategyEvents([
      closeSpamEvent(0, 'EX Long', 900),
      {
        kind: 'entry',
        id: 'L',
        direction: 'long',
        qty: 1,
        bar_time: 1000,
        ohlc: [100, 100, 100, 100],
      },
      closeSpamEvent(2, 'MD Short', 1050),
      {
        kind: 'close',
        id: 'L',
        qty: 1,
        bar_time: 1100,
        ohlc: [110, 110, 110, 110],
      },
      closeSpamEvent(4, 'EX Long', 1200),
    ]);
    const markers = eventsToMarkers(events);
    expect(markers).toHaveLength(2);
    expect(markers[0]!.shape).toBe('arrowUp');
    expect(markers[1]!.shape).toBe('arrowDown');
  });
});
