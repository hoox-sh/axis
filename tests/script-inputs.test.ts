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
