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
} from '../src/results/script-inputs.ts';
import { buildDataViewRows, barIndexAtTime } from '../src/results/dataview.ts';

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
});

describe('buildDataViewRows', () => {
  const bars = [
    { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { time: 2000, open: 1.5, high: 3, low: 1, close: 2.5, volume: 20 },
  ];

  it('resolves nearest bar and series', () => {
    expect(barIndexAtTime(bars, 2000)).toBe(1);
    const rows = buildDataViewRows({
      bars,
      time: 2000,
      symbol: 'BTCUSDT',
      interval: '1h',
      series: { sma: [null, 2.1] },
      plotMeta: { sma: { title: 'SMA', color: '#939fff' } },
    });
    expect(rows.find((r) => r.key === 'close')!.value).toContain('2.5');
    expect(rows.find((r) => r.key === 's_sma')!.label).toBe('SMA');
    expect(rows.find((r) => r.key === 'symbol')!.value).toBe('BTCUSDT');
  });
});
