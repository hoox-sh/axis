// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pine `input.*` parsing/overrides + DataView row helpers.
 * Guards: int/float/bool bounds, engine input normalize, bar-index lookup.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseScriptInputs,
  resolveScriptInputs,
  applyInputOverrides,
  overridesFromDefs,
  normalizeEngineInputs,
  layoutInputRows,
  isInputActive,
  normalizeTooltip,
  findLhsIdent,
} from '../src/results/script-inputs.ts';
import {
  buildDataViewRows,
  barIndexAtTime,
  buildOnchainDataViewRows,
  onchainValueAtTime,
  fmtUsdCompact,
} from '../src/results/dataview.ts';

describe('parseScriptInputs', () => {
  it('parses int/float/bool with titles and bounds', () => {
    const src = `//@version=5
indicator("x")
length = input.int(14, "RSI Length", minval=2, maxval=100)
oversold = input.float(30.0, "Oversold", minval=1, maxval=50)
show = input.bool(true, "Show MA")
plot(close)
`;
    const defs = parseScriptInputs(src);
    expect(defs.length).toBe(3);
    expect(defs[0]!.title).toBe('RSI Length');
    expect(defs[0]!.type).toBe('int');
    expect(defs[0]!.default).toBe(14);
    expect(defs[0]!.min).toBe(2);
    expect(defs[0]!.max).toBe(100);
    expect(defs[1]!.type).toBe('float');
    expect(defs[2]!.type).toBe('bool');
    expect(defs[2]!.default).toBe(true);
  });

  it('parses keyword title= and color', () => {
    const src = `c = input.color(color.red, title="Line color")`;
    const defs = parseScriptInputs(src);
    expect(defs.length).toBe(1);
    expect(defs[0]!.title).toBe('Line color');
    expect(defs[0]!.type).toBe('color');
  });

  it('merges engine overrides and builds payload', () => {
    const src = `length = input.int(14, "Length")`;
    const eng = [{ title: 'Length', type: 'int', default: 14, value: 21, min: 1, max: 200 }];
    const defs = applyInputOverrides(resolveScriptInputs(src, eng), { Length: 42 });
    expect(defs[0]!.value).toBe(42);
    expect(overridesFromDefs(defs).Length).toBe(42);
  });

  it('normalizeEngineInputs maps fields', () => {
    const n = normalizeEngineInputs([{ title: 'A', type: 'int', defval: 3, value: 5 }]);
    expect(n[0]!.default).toBe(3);
    expect(n[0]!.value).toBe(5);
  });

  it('input.source gets default OHLC enums when options omitted', () => {
    const src = `src = input.source(close, "Source")
src2 = input.source(hlc3, title="Alt")
`;
    const defs = parseScriptInputs(src);
    expect(defs.length).toBe(2);
    expect(defs[0]!.type).toBe('source');
    expect(defs[0]!.default).toBe('close');
    expect(defs[0]!.options).toEqual([
      'open',
      'high',
      'low',
      'close',
      'hl2',
      'hlc3',
      'ohlc4',
    ]);
    expect(defs[1]!.default).toBe('hlc3');
    expect(defs[1]!.options?.includes('ohlc4')).toBe(true);
  });

  it('engine source without options still gets default enums', () => {
    const n = normalizeEngineInputs([
      { title: 'Source', type: 'source', default: 'close', value: 'close' },
    ]);
    expect(n[0]!.options).toEqual([
      'open',
      'high',
      'low',
      'close',
      'hl2',
      'hlc3',
      'ohlc4',
    ]);
  });

  it('bare input(close, "Source") parses as source with OHLC options', () => {
    const src = `src = input(close, 'Source', group='Support')`;
    const defs = parseScriptInputs(src);
    expect(defs.length).toBe(1);
    expect(defs[0]!.type).toBe('source');
    expect(defs[0]!.default).toBe('close');
    expect(defs[0]!.title).toBe('Source');
    expect(defs[0]!.group).toBe('Support');
    expect(defs[0]!.options).toEqual([
      'open',
      'high',
      'low',
      'close',
      'hl2',
      'hlc3',
      'ohlc4',
    ]);
  });

  it('recovers engine float mistype for Source title with bar price value', () => {
    // pyne may export bare input(close,"Source") as float with resolved close
    const n = normalizeEngineInputs([
      {
        type: 'float',
        default: '63210',
        value: '63210',
        title: 'Source',
        group: 'Support',
      },
    ]);
    expect(n[0]!.type).toBe('source');
    expect(n[0]!.default).toBe('close');
    expect(n[0]!.value).toBe('close');
    expect(n[0]!.group).toBe('Support');
    expect(n[0]!.options).toContain('hl2');
    expect(n[0]!.min).toBeNull();
  });

  it('does not coerce unrelated float titled Source Length', () => {
    const n = normalizeEngineInputs([
      { title: 'Source Length', type: 'float', default: 14, value: 14 },
    ]);
    expect(n[0]!.type).toBe('float');
    expect(n[0]!.default).toBe(14);
  });

  it('resolveScriptInputs prefers source when engine sends float bar value', () => {
    const src = `src = input(close, "Source", group="Support")`;
    const eng = [
      {
        type: 'float',
        default: '63210',
        value: '63210',
        title: 'Source',
        group: 'Support',
      },
    ];
    const defs = resolveScriptInputs(src, eng);
    expect(defs[0]!.type).toBe('source');
    expect(defs[0]!.default).toBe('close');
    expect(defs[0]!.value).toBe('close');
    expect(defs[0]!.options).toEqual([
      'open',
      'high',
      'low',
      'close',
      'hl2',
      'hlc3',
      'ohlc4',
    ]);
  });

  it('engine series token under wrong type still becomes source', () => {
    const n = normalizeEngineInputs([
      { title: 'MA Source', type: 'string', default: 'hlc3', value: 'hlc3' },
    ]);
    expect(n[0]!.type).toBe('source');
    expect(n[0]!.default).toBe('hlc3');
    expect(n[0]!.value).toBe('hlc3');
  });

  it('parses group, inline, tooltip, active, and LHS varName', () => {
    const src = `//@version=6
indicator("demo")
string GRP = "Moving Average"
bool showMA = input.bool(true, "Show MA", group=GRP)
int maLen = input.int(20, "Length", minval=1, group=GRP, tooltip="Lookback\\nHigher = smoother", active=showMA)
color maColor = input.color(color.blue, "Color", group=GRP, inline="style", active=showMA)
int maWidth = input.int(2, "Width", minval=1, maxval=5, group=GRP, inline="style", active=showMA)
`;
    const defs = parseScriptInputs(src);
    expect(defs.length).toBe(4);
    expect(defs[0]!.varName).toBe('showMA');
    expect(defs[0]!.group).toBe('Moving Average');
    expect(defs[1]!.activeRef).toBe('showMA');
    expect(defs[1]!.tooltip).toContain('Lookback');
    expect(defs[1]!.tooltip).toContain('\n');
    expect(defs[2]!.inline).toBe('style');
    expect(defs[3]!.inline).toBe('style');
    expect(defs[2]!.activeRef).toBe('showMA');
  });

  it('layoutInputRows clusters consecutive inline keys per group', () => {
    const src = `
g1a = input.int(1, "A", group="G1", inline="row")
g1b = input.int(2, "B", group="G1", inline="row")
g1c = input.bool(true, "C", group="G1")
g2a = input.string("x", "D", group="G2", inline="row")
`;
    const layout = layoutInputRows(parseScriptInputs(src));
    expect(layout.map((g) => g.group)).toEqual(['G1', 'G2']);
    expect(layout[0]!.rows).toHaveLength(2);
    expect(layout[0]!.rows[0]!.kind).toBe('inline');
    if (layout[0]!.rows[0]!.kind === 'inline') {
      expect(layout[0]!.rows[0]!.fields.map((f) => f.title)).toEqual(['A', 'B']);
    }
    expect(layout[0]!.rows[1]!.kind).toBe('single');
    expect(layout[1]!.rows[0]!.kind).toBe('inline');
  });

  it('isInputActive resolves activeRef against peer bool values', () => {
    const defs = parseScriptInputs(`
show = input.bool(true, "Show")
length = input.int(14, "Length", active=show)
`);
    expect(isInputActive(defs[1]!, defs)).toBe(true);
    const off = defs.map((d) =>
      d.title === 'Show' ? { ...d, value: false } : d,
    );
    expect(isInputActive(off[1]!, off)).toBe(false);
    const staticOff = parseScriptInputs(`x = input.int(1, "X", active=false)`);
    expect(isInputActive(staticOff[0]!, staticOff)).toBe(false);
  });

  it('normalizeTooltip expands escaped newlines', () => {
    expect(normalizeTooltip('a\\nb')).toBe('a\nb');
    expect(normalizeTooltip(null)).toBeNull();
  });

  it('findLhsIdent reads assignment before call', () => {
    const src = '  int length = input.int(14, "Length")';
    const idx = src.indexOf('input.int');
    expect(findLhsIdent(src, idx)).toBe('length');
  });
});

describe('buildDataViewRows', () => {
  const bars = [
    { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: 2000, open: 1.5, high: 3, low: 1, close: 2.5, volume: 20 },
    { time: 3000, open: 2.5, high: 4, low: 2, close: 3.5, volume: 30 },
  ];

  it('resolves nearest bar and series', () => {
    expect(barIndexAtTime(bars, 2000)).toBe(1);
    const rows = buildDataViewRows({
      bars,
      time: 2000,
      symbol: 'BTCUSDT',
      interval: '1h',
      series: { sma: [null, 2.1, 2.2] },
      plotMeta: { sma: { title: 'SMA', color: '#939fff' } },
    });
    expect(rows.find((r) => r.key === 'close')!.value).toContain('2.5');
    expect(rows.find((r) => r.key === 's_sma')!.label).toBe('SMA');
    expect(rows.find((r) => r.key === 'symbol')!.value).toBe('BTCUSDT');
  });

  it('includes drawing prices at crosshair time', () => {
    const rows = buildDataViewRows({
      bars,
      time: 2000,
      drawings: [
        { id: 'h1', kind: 'hline', price: 42.5, color: '#5ecf8a' },
        {
          id: 't1',
          kind: 'trend',
          color: '#939fff',
          p1: { time: 1000, price: 10 },
          p2: { time: 3000, price: 30 },
        },
        {
          id: 'r1',
          kind: 'ray',
          color: '#e8a03a',
          p1: { time: 2000, price: 100 },
          p2: { time: 3000, price: 110 },
        },
      ] as never,
    });
    const h = rows.find((r) => r.key === 'd_h1');
    expect(h?.group).toBe('drawings');
    expect(h?.value).toContain('42.5');
    // mid trend: t=2000 is halfway 10→30 → 20
    const tr = rows.find((r) => r.key === 'd_t1');
    expect(tr?.value).toMatch(/20/);
    // ray starts at 2000 → active
    expect(rows.find((r) => r.key === 'd_r1')).toBeTruthy();
  });

  it('omits trend when crosshair is outside the segment', () => {
    const rows = buildDataViewRows({
      bars,
      time: 1000,
      drawings: [
        {
          id: 't1',
          kind: 'trend',
          color: '#fff',
          p1: { time: 2000, price: 10 },
          p2: { time: 3000, price: 30 },
        },
      ] as never,
    });
    expect(rows.find((r) => r.key === 'd_t1')).toBeUndefined();
  });

  it('includes visible on-chain series with USD TVL and meta fields', () => {
    expect(fmtUsdCompact(1_250_000_000)).toBe('$1.25B');
    expect(onchainValueAtTime(
      [
        { time: 1000, value: 100 },
        { time: 3000, value: 300 },
      ],
      2000,
    )).toBe(200);

    const rows = buildDataViewRows({
      bars,
      time: 2000,
      onchainSeries: [
        {
          id: 'ocs_aave',
          label: 'Aave TVL',
          provider: 'defillama',
          visible: true,
          color: '#939fff',
          finality: 'finalized',
          lastTvl: 1_250_000_000,
          instrument: { metric: 'tvl' },
          points: [
            { time: 1000, value: 1_000_000_000 },
            { time: 3000, value: 1_500_000_000 },
          ],
        },
        {
          id: 'ocs_hidden',
          label: 'Hidden',
          provider: 'defillama',
          visible: false,
          points: [{ time: 1000, value: 1 }],
          finality: 'finalized',
        },
      ],
    });
    const val = rows.find((r) => r.key === 'oc_ocs_aave');
    expect(val?.group).toBe('onchain');
    expect(val?.label).toBe('Aave TVL');
    // Midpoint of 1B→1.5B at t=2000
    expect(val?.value).toBe('$1.25B');
    expect(rows.find((r) => r.key === 'oc_ocs_aave_provider')?.value).toBe('defillama');
    expect(rows.find((r) => r.key === 'oc_ocs_aave_last')?.value).toBe('$1.25B');
    expect(rows.find((r) => r.key === 'oc_ocs_aave_points')?.value).toBe('2');
    expect(rows.find((r) => r.key === 'oc_ocs_aave_finality')?.value).toBe('finalized');
    expect(rows.find((r) => r.key === 'oc_ocs_hidden')).toBeUndefined();
    expect(buildOnchainDataViewRows([], 2000)).toEqual([]);
  });
});
