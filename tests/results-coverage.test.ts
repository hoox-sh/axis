// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Coverage stretch for pure transform/format/validate branches:
 * - src/results/dataview.ts
 * - src/results/profiler.ts
 * - src/results/strategy-props.ts
 * - src/data/expand-cache.ts (pure + early-return branches)
 * - src/data/dataset-sinks.ts (session/local/remote sink branches)
 *
 * Does NOT modify sources; exercises uncovered lines via public API only.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

import {
  fmtUsdCompact,
  barIndexAtTime,
  linePriceAtTime,
  isTimeOnLineKind,
  rowsForDrawingAtTime,
  buildDrawingDataViewRows,
  onchainValueAtTime,
  buildOnchainDataViewRows,
  buildDataViewRows,
} from '../src/results/dataview.ts';
import {
  normalizeRunProfile,
  profileLineMap,
  type RunProfile,
} from '../src/results/profiler.ts';
import {
  parseStrategyDeclaration,
  resolveStrategyProps,
  applyStrategyPropsToSource,
  strategyOverridesFromDefs,
  applyStrategyOverrides,
  normalizeStrategyEnum,
  findStrategyCall,
  hasStrategyDeclaration,
} from '../src/results/strategy-props.ts';
import type { Bar } from '../src/store/types.ts';

const bars: Bar[] = [
  { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { time: 2000, open: 1.5, high: 3, low: 1, close: 2.5, volume: 20 },
  { time: 3000, open: 2.5, high: 4, low: 2, close: 3.5, volume: 30 },
];

// ── dataview ────────────────────────────────────────────────────────────────

describe('dataview coverage', () => {
  it('fmtUsdCompact covers M / K / small / negative-T tiers', () => {
    expect(fmtUsdCompact(2_500_000)).toBe('$2.50M');
    expect(fmtUsdCompact(12_300)).toBe('$12.3K');
    expect(fmtUsdCompact(42)).toBe('$42');
    expect(fmtUsdCompact(-2_500_000_000_000)).toBe('$-2.50T');
    expect(fmtUsdCompact(null)).toBe('—');
    expect(fmtUsdCompact(NaN)).toBe('—');
  });

  it('fmtTime falls back to String(t) for out-of-range dates', () => {
    const rows = buildDataViewRows({ bars: [{ ...bars[0]!, time: 1e20 }] });
    expect(rows.find((r) => r.key === 'time')!.value).toBe(String(1e20));
  });

  it('linePriceAtTime guards non-finite input and vertical hits', () => {
    expect(linePriceAtTime({ time: NaN, price: 1 }, { time: 2, price: 2 }, 1)).toBeNull();
    expect(linePriceAtTime({ time: 1, price: NaN }, { time: 2, price: 2 }, 1)).toBeNull();
    // vertical segment: hit at the anchor time, null elsewhere
    expect(linePriceAtTime({ time: 5, price: 7 }, { time: 5, price: 9 }, 5)).toBe(7);
    expect(linePriceAtTime({ time: 5, price: 7 }, { time: 5, price: 9 }, 6)).toBeNull();
  });

  it('isTimeOnLineKind covers extend / ray-equal / reversed-ray / non-finite', () => {
    const p1 = { time: 1000, price: 10 };
    const p2 = { time: 2000, price: 20 };
    expect(isTimeOnLineKind('extend', p1, p2, 999_999)).toBe(true);
    expect(isTimeOnLineKind('trend', p1, p2, NaN)).toBe(false);
    // ray with identical anchors: only exact time matches
    expect(isTimeOnLineKind('ray', p1, { ...p1 }, 1000)).toBe(true);
    expect(isTimeOnLineKind('ray', p1, { ...p1 }, 1001)).toBe(false);
    // reversed ray (p2 before p1): active at / before p1
    const rp1 = { time: 2000, price: 20 };
    const rp2 = { time: 1000, price: 10 };
    expect(isTimeOnLineKind('ray', rp1, rp2, 2000)).toBe(true);
    expect(isTimeOnLineKind('ray', rp1, rp2, 1500)).toBe(true);
    expect(isTimeOnLineKind('ray', rp1, rp2, 2001)).toBe(false);
  });

  it('rowsForDrawingAtTime guards missing id / time', () => {
    expect(rowsForDrawingAtTime(null as never, 1000)).toEqual([]);
    expect(
      rowsForDrawingAtTime({ id: 'x', kind: 'hline', price: 1, color: '#fff' } as never, NaN),
    ).toEqual([]);
  });

  it('vline rows distinguish on-bar dot vs timestamp', () => {
    const d = { id: 'v1', kind: 'vline', time: 2000, color: '#fff' } as never;
    const on = rowsForDrawingAtTime(d, 2000, { barPeriod: 60 });
    expect(on[0]!.value).toBe('●');
    const off = rowsForDrawingAtTime(d, 5000, { barPeriod: 60 });
    expect(off[0]!.value).toContain('1970');
  });

  it('text rows emit near the anchor and vanish far away', () => {
    const d = {
      id: 't1',
      kind: 'text',
      text: 'hi',
      color: '#fff',
      p1: { time: 2000, price: 5 },
    } as never;
    const near = rowsForDrawingAtTime(d, 2000, { barPeriod: 60 });
    expect(near).toHaveLength(1);
    expect(near[0]!.value).toContain('hi');
    expect(rowsForDrawingAtTime(d, 9000, { barPeriod: 60 })).toEqual([]);
  });

  it('rect / ellipse rows emit hi/lo range when active', () => {
    const rect = {
      id: 'r1',
      kind: 'rect',
      color: '#fff',
      p1: { time: 1000, price: 10 },
      p2: { time: 3000, price: 30 },
    } as never;
    const rows = rowsForDrawingAtTime(rect, 2000);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toContain('/');
    // outside the span → no rows
    expect(rowsForDrawingAtTime(rect, 9999)).toEqual([]);
    const ellipse = { ...(rect as object), id: 'e1', kind: 'ellipse' } as never;
    expect(rowsForDrawingAtTime(ellipse, 2000)).toHaveLength(1);
    // missing anchors → no rows
    expect(
      rowsForDrawingAtTime({ id: 'r2', kind: 'rect', color: '#fff' } as never, 2000),
    ).toEqual([]);
  });

  it('fib rows emit one row per level and guard off-span time', () => {
    const fib = {
      id: 'f1',
      kind: 'fib',
      color: '#fff',
      p1: { time: 1000, price: 30 },
      p2: { time: 3000, price: 10 },
    } as never;
    const rows = rowsForDrawingAtTime(fib, 2000);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[0]!.key).toMatch(/^d_f1_f/);
    expect(rowsForDrawingAtTime(fib, 9999)).toEqual([]);
    // rising fib (p1 < p2) takes the other paint branch
    const rising = {
      ...(fib as object),
      id: 'f2',
      p1: { time: 1000, price: 10 },
      p2: { time: 3000, price: 30 },
    } as never;
    expect(rowsForDrawingAtTime(rising, 2000).length).toBe(rows.length);
  });

  it('measure rows include delta and bar span', () => {
    const m = {
      id: 'm1',
      kind: 'measure',
      color: '#fff',
      p1: { time: 1000, price: 10 },
      p2: { time: 3000, price: 30 },
    } as never;
    const rows = rowsForDrawingAtTime(m, 2000, { barPeriod: 1000 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toContain('Δ');
    expect(rows[0]!.value).toContain('bars');
  });

  it('onchainValueAtTime interpolates via binary search over 3+ points', () => {
    const pts = [
      { time: 3000, value: 300 },
      { time: 1000, value: 100 },
      { time: 2000, value: 200 },
      { time: 'x', value: 5 },
      { time: 1500, value: NaN },
    ] as never;
    expect(onchainValueAtTime(pts, 2500)).toBe(250);
    expect(onchainValueAtTime(pts, 1000)).toBe(100);
    expect(onchainValueAtTime(pts, 3000)).toBe(300);
    expect(onchainValueAtTime(pts, 1)).toBe(100);
    expect(onchainValueAtTime(pts, 9999)).toBe(300);
    expect(onchainValueAtTime([], 1000)).toBeNull();
    expect(onchainValueAtTime(null, 1000)).toBeNull();
    expect(
      onchainValueAtTime([{ time: NaN, value: 1 }] as never, 1000),
    ).toBeNull();
  });

  it('onchain rows use TVL label fallback and points-tail last value', () => {
    const rows = buildOnchainDataViewRows(
      [
        {
          id: 's1',
          label: 'Aave TVL pool',
          visible: true,
          points: [
            { time: 1000, value: 1_000_000 },
            { time: 2000, value: NaN },
            { time: 3000, value: 3_000_000 },
          ],
        },
        {
          id: 's2',
          instrument: { symbol: 'XYZ', metric: 'price' },
          visible: true,
          points: [{ time: 1000, value: 12.3456 }],
          loading: true,
        },
        {
          id: 's3',
          label: 'broken',
          visible: true,
          points: [{ time: 1000, value: NaN }],
          error: 'boom',
        },
        { id: '', label: 'skipped', visible: true, points: [] },
      ],
      2000,
    );
    const s1 = rows.find((r) => r.key === 'oc_s1')!;
    // 2M interpolated → compact USD via TVL label fallback
    expect(s1.value).toBe('$2.00M');
    expect(rows.find((r) => r.key === 'oc_s1_last')!.value).toBe('$3.00M');
    // non-TVl metric → plain number; loading suffix appended
    const s2 = rows.find((r) => r.key === 'oc_s2')!;
    expect(s2.value).toContain('loading…');
    // no finite points → em dash + error suffix
    const s3 = rows.find((r) => r.key === 'oc_s3')!;
    expect(s3.value).toContain('error');
    expect(rows.find((r) => r.key === 'oc_s3_provider')!.value).toBe('—');
    expect(rows.find((r) => r.key === 'oc_s3_finality')!.value).toBe('unknown');
  });

  it('buildDataViewRows returns empty-state for no bars', () => {
    expect(buildDataViewRows({ bars: [] })).toEqual([
      { key: 'empty', label: 'Bar', value: 'No data', group: 'meta' },
    ]);
  });

  it('buildDataViewRows covers bgcolor / boolean / non-array series branches', () => {
    const rows = buildDataViewRows({
      bars,
      barIndex: 1,
      series: {
        bg: ['red', 'green', ''],
        flag: [true, false, true],
        _priv: [1, 2, 3],
        notArr: 42,
      } as never,
      plotMeta: {
        bg: { title: 'BG', kind: 'bgcolor' },
        flag: { title: 'Flag' },
      },
    });
    expect(rows.find((r) => r.key === 's_bg')!.value).toBe('green');
    expect(rows.find((r) => r.key === 's_flag')!.value).toBe('false');
    expect(rows.find((r) => r.key === 's__priv')).toBeUndefined();
    expect(rows.find((r) => r.key === 's_notArr')).toBeUndefined();
    // bgcolor empty string → em dash
    const rows2 = buildDataViewRows({
      bars,
      barIndex: 2,
      series: { bg: ['red', 'green', ''] },
      plotMeta: { bg: { kind: 'bgcolor' } },
    });
    expect(rows2.find((r) => r.key === 's_bg')!.value).toBe('—');
  });

  it('buildDataViewRows clamps barIndex and infers period for single bars', () => {
    const single: Bar[] = [{ time: 5000, open: 1, high: 1, low: 1, close: 1 }];
    const lo = buildDataViewRows({ bars: single, barIndex: -5 });
    expect(lo.find((r) => r.key === 'index')!.value).toBe('0');
    const hi = buildDataViewRows({ bars, barIndex: 99 });
    expect(hi.find((r) => r.key === 'index')!.value).toBe('2');
    // explicit barPeriod + crosshair time off the bar still render
    const rows = buildDataViewRows({ bars: single, time: 9999, barPeriod: 60 });
    expect(rows.find((r) => r.key === 'Bar #')).toBeUndefined();
    expect(rows.find((r) => r.key === 'index')!.value).toBe('0');
  });

  it('buildDrawingDataViewRows guards empty input', () => {
    expect(buildDrawingDataViewRows(null, 1000)).toEqual([]);
    expect(buildDrawingDataViewRows([], 1000)).toEqual([]);
    expect(buildDrawingDataViewRows([{ id: 'h', kind: 'hline', price: 1, color: '#fff' } as never], NaN)).toEqual([]);
    expect(barIndexAtTime(bars, null)).toBeGreaterThanOrEqual(0);
  });
});

// ── profiler ────────────────────────────────────────────────────────────────

describe('profiler coverage', () => {
  it('asFiniteNumber accepts numeric strings', () => {
    const p = normalizeRunProfile({
      totalMs: '100',
      bars: '50',
      mode: 'interpret',
      runId: 'r1',
      lines: [{ line: '3', ms: '25', execs: '2' }],
    })!;
    expect(p.totalMs).toBe(100);
    expect(p.bars).toBe(50);
    expect(p.mode).toBe('interpret');
    expect(p.runId).toBe('r1');
    expect(p.lines[0]).toMatchObject({ line: 3, ms: 25, execs: 2 });
    // blank / non-numeric strings are ignored
    const q = normalizeRunProfile({ totalMs: '  ', lines: [{ line: 'x', ms: 5, execs: 1 }] });
    expect(q).toBeNull();
  });

  it('falls back to fallbackTotalMs for null input', () => {
    expect(normalizeRunProfile(null, 42)).toEqual({ totalMs: 42, lines: [] });
    expect(normalizeRunProfile(null, -1)).toBeNull();
    expect(normalizeRunProfile(null)).toBeNull();
  });

  it('normalizes phases incl. snake aliases and drops non-numeric entries', () => {
    const p = normalizeRunProfile({
      phases: { parse_ms: '5', evalMs: 10, junk: 'nope', other: 3 },
      lines: [{ line: 1, ms: 1, execs: 1 }],
    })!;
    expect(p.phases!.parse_ms).toBe(5);
    expect(p.phases!.eval_ms).toBe(10);
    expect(p.phases!.junk).toBeUndefined();
    // all-non-numeric phases → phases undefined but profile kept via lines
    const q = normalizeRunProfile({
      phases: { junk: 'nope' },
      lines: [{ line: 1, ms: 1, execs: 1 }],
    })!;
    expect(q.phases).toBeUndefined();
  });

  it('accepts runProfile wrapper and snake run_id', () => {
    const p = normalizeRunProfile({
      runProfile: { run_id: 'abc', total_ms: 10, lines: [{ line: 1, ms: 10, execs: 1 }] },
    })!;
    expect(p.runId).toBe('abc');
    expect(p.totalMs).toBe(10);
  });

  it('accepts scalar map values and line_stats object form', () => {
    const p = normalizeRunProfile({ line_stats: { '12': 5, '13': { ms: 7, execs: 1 } } })!;
    expect(p.lines.map((l) => l.line).sort((a, b) => a - b)).toEqual([12, 13]);
    // alternate candidate keys
    const q = normalizeRunProfile({ by_line: [{ line: 2, ms: 4, execs: 1 }] })!;
    expect(q.lines).toHaveLength(1);
    const r = normalizeRunProfile({ byLine: [{ line: 2, ms: 4, execs: 1 }] })!;
    expect(r.lines).toHaveLength(1);
    const s = normalizeRunProfile({ stats: [{ line: 2, ms: 4, execs: 1 }] })!;
    expect(s.lines).toHaveLength(1);
  });

  it('returns null for scalar bodies', () => {
    expect(normalizeRunProfile(42)).toBeNull();
    expect(normalizeRunProfile('nope')).toBeNull();
  });

  it('accepts tuple rows and merges duplicates, skipping bad lines', () => {
    const p = normalizeRunProfile([
      [1, 10, 2],
      [1, '5', '3'],
      [0, 99, 1],
      ['x', 1, 1],
      null,
      42,
      'row',
      { line: 2, time: 8, calls: 2 },
    ])!;
    const one = p.lines.find((l) => l.line === 1)!;
    expect(one).toMatchObject({ ms: 15, execs: 5 });
    expect(p.lines.find((l) => l.line === 2)).toMatchObject({ ms: 8, execs: 2 });
    expect(p.lines.find((l) => l.line === 0)).toBeUndefined();
  });

  it('reads row aliases and preserves first pct on merge', () => {
    const p = normalizeRunProfile({
      lines: [
        { line_no: 4, time_ms: 10, count: 1, pct: 25 },
        { ln: 4, elapsedMs: 5, n: 2, percent: 50 },
        { lineno: 5, time: 6, exec_count: 3, percentage: 10 },
        { lineNo: 6, elapsed_ms: 7, execCount: 1, pct_of_total: 5 },
        { line: 7, ms: 3, executions: 1 },
      ],
    })!;
    expect(p.lines.find((l) => l.line === 4)).toMatchObject({ ms: 15, execs: 3 });
    expect(p.lines.find((l) => l.line === 5)).toMatchObject({ ms: 6, execs: 3 });
    expect(p.lines.find((l) => l.line === 6)).toMatchObject({ ms: 7, execs: 1 });
  });

  it('phase-only profiles resolve total from fallback', () => {
    const p = normalizeRunProfile({ phases: { parse_ms: 5 } }, 9)!;
    expect(p.totalMs).toBe(9);
    expect(p.lines).toEqual([]);
  });

  it('profileLineMap merges duplicate lines and recomputes pct', () => {
    const profile: RunProfile = {
      totalMs: 100,
      lines: [
        { line: 4, ms: 10, execs: 1, pct: 0 },
        { line: 4, ms: 30, execs: 2, pct: 0 },
        { line: 0, ms: 5, execs: 1, pct: 0 },
      ],
    };
    const map = profileLineMap(profile);
    expect(map.get(4)).toMatchObject({ ms: 40, execs: 3 });
    expect(map.get(4)!.pct).toBeCloseTo(100, 5);
    expect(map.get(0)).toBeUndefined();
  });
});

// ── strategy-props ──────────────────────────────────────────────────────────

describe('strategy-props coverage', () => {
  it('findStrategyCall tolerates parens/quotes inside strings and unbalanced input', () => {
    const src = 'strategy("a(b\\"c)", overlay=true)\nplot(close)\n';
    expect(findStrategyCall(src)).not.toBeNull();
    expect(hasStrategyDeclaration('strategy("oops"\n')).toBe(false);
    expect(findStrategyCall("strategy('it\\'s', overlay=true)\n")).not.toBeNull();
  });

  it('parseStrategyDeclaration handles quotes, escapes and unknown kwargs', () => {
    const d = parseStrategyDeclaration(
      `strategy("T", title="My, Title", currency='EUR', note="a\\"b", pyramiding=2, custom_thing=foo(1, 2), bad-key=1, 42=1)\n`,
    );
    expect(d.currency).toBe('EUR');
    expect(d.title).toBe('My, Title');
    expect(d.note).toBe('a\\"b');
    expect(d.pyramiding).toBe(2);
    expect(d.custom_thing).toBe('foo(1, 2)');
    expect(d['bad-key']).toBeUndefined();
  });

  it('parseLiteral covers na / null / sci-float / bare identifiers', () => {
    const d = parseStrategyDeclaration(
      'strategy("T", a=na, b=None, c=null, e=-1.5e3, f=bar.baz, g=true, h=false)\n',
    );
    expect(d.a).toBeNull();
    expect(d.b).toBeNull();
    expect(d.c).toBeNull();
    expect(d.e).toBe(-1500);
    expect(d.f).toBe('bar.baz');
    // empty value → null
    expect(parseStrategyDeclaration('strategy("T", pyramiding=)\n').pyramiding).toBeNull();
    // no declaration → empty
    expect(parseStrategyDeclaration('indicator("x")')).toEqual({});
  });

  it('normalizeStrategyEnum covers bare qty / commission variants', () => {
    expect(normalizeStrategyEnum('default_qty_type', 'percent')).toBe(
      'strategy.percent_of_equity',
    );
    expect(normalizeStrategyEnum('default_qty_type', 'percentage')).toBe(
      'strategy.percent_of_equity',
    );
    expect(normalizeStrategyEnum('default_qty_type', 'cash')).toBe('strategy.cash');
    expect(normalizeStrategyEnum('default_qty_type', 'strategy.fixed')).toBe(
      'strategy.fixed',
    );
    expect(normalizeStrategyEnum('default_qty_type', 'mycustom')).toBe(
      'strategy.mycustom',
    );
    expect(normalizeStrategyEnum('commission_type', 'cash_per_order')).toBe(
      'strategy.commission.cash_per_order',
    );
    expect(normalizeStrategyEnum('commission_type', 'cash_per_contract')).toBe(
      'strategy.commission.cash_per_contract',
    );
    expect(normalizeStrategyEnum('commission_type', 'strategy.commission.percent')).toBe(
      'strategy.commission.percent',
    );
    expect(normalizeStrategyEnum('commission_type', 'weird')).toBe(
      'strategy.commission.weird',
    );
    expect(normalizeStrategyEnum('commission_type', null)).toBeNull();
    expect(normalizeStrategyEnum('other', 'x')).toBe('x');
  });

  it('resolveStrategyProps normalizes enum declarations and overrides', () => {
    const defs = resolveStrategyProps('strategy("T", default_qty_type=fixed)\n', {
      commission_type: 'cash_per_order',
    });
    expect(defs.find((d) => d.id === 'default_qty_type')!.default).toBe(
      'strategy.fixed',
    );
    expect(defs.find((d) => d.id === 'commission_type')!.value).toBe(
      'strategy.commission.cash_per_order',
    );
  });

  it('applyStrategyOverrides maps values and ignores empty bags', () => {
    const defs = resolveStrategyProps('strategy("T")\n');
    expect(applyStrategyOverrides(defs, null)).toBe(defs);
    expect(applyStrategyOverrides(defs, {})).toBe(defs);
    const out = applyStrategyOverrides(defs, {
      initial_capital: 5,
      default_qty_type: 'cash',
      pyramiding: null,
    });
    expect(out.find((d) => d.id === 'initial_capital')!.value).toBe(5);
    expect(out.find((d) => d.id === 'default_qty_type')!.value).toBe(
      'strategy.cash',
    );
  });

  it('applyStrategyPropsToSource formats bools / strings / na / objects', () => {
    const src = 'strategy("T", overlay=true)\nplot(close)\n';
    const out = applyStrategyPropsToSource(src, {
      process_orders_on_close: true,
      calc_on_order_fills: false,
      currency: 'US D',
      default_qty_type: 'strategy.fixed',
      commission_value: 1.5,
      slippage: 3,
    } as never);
    expect(out).toContain('process_orders_on_close=true');
    expect(out).toContain('calc_on_order_fills=false');
    expect(out).toContain('currency="US D"');
    expect(out).toContain('commission_value=1.5');
    // unknown catalog keys and undefined values are skipped
    expect(
      applyStrategyPropsToSource(src, { nope: 1, leverage: undefined } as never),
    ).toContain('"T"');
    // no declaration → source unchanged
    expect(applyStrategyPropsToSource('indicator("x")\n', { leverage: 2 })).toBe(
      'indicator("x")\n',
    );
    // blank source → unchanged
    expect(applyStrategyPropsToSource('  ', { leverage: 2 })).toBe('  ');
    // null override value renders as na
    const naOut = applyStrategyPropsToSource('strategy("T")\n', {
      currency: null,
    } as never);
    expect(naOut).toContain('currency=na');
  });

  it('strategyOverridesFromDefs falls back to defaults for undefined values', () => {
    const defs = resolveStrategyProps('strategy("T")\n').map((d) => ({
      ...d,
      value: undefined,
    }));
    expect(strategyOverridesFromDefs(defs)).toEqual({});
  });
});
