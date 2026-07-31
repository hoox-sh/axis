// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cross-indicator plot sources for input.source.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatPlotSourceId,
  parsePlotSourceId,
  listPlotSourceOptions,
  resolveInputSourceValues,
  orderIndicatorsByPlotDeps,
  sourceOptionsWithPlots,
} from '../src/results/plot-sources.ts';
import { DEFAULT_SOURCE_OPTIONS } from '../src/results/script-inputs.ts';

describe('plot source refs', () => {
  it('formats and parses plot refs', () => {
    const id = formatPlotSourceId('id_1', 'sma');
    expect(id).toBe('plot:id_1:sma');
    expect(parsePlotSourceId(id)).toEqual({ indicatorId: 'id_1', plotKey: 'sma' });
    expect(parsePlotSourceId('close')).toBeNull();
    expect(parsePlotSourceId('plot:broken')).toBeNull();
  });

  it('lists options excluding self', () => {
    const cache = {
      a: { name: 'SMA', series: { sma: [1, 2, 3] }, titles: { sma: 'SMA 14' } },
      b: { name: 'RSI', series: { rsi: [50, 51] } },
    };
    const all = listPlotSourceOptions(cache);
    expect(all.length).toBe(2);
    const onlyB = listPlotSourceOptions(cache, 'a');
    expect(onlyB.length).toBe(1);
    expect(onlyB[0]!.plotKey).toBe('rsi');
    expect(onlyB[0]!.label).toContain('RSI');
  });

  it('merges built-in + plot options', () => {
    const { options, labels } = sourceOptionsWithPlots({
      a: { name: 'SMA', series: { plot: [1, 2] } },
    });
    for (const b of DEFAULT_SOURCE_OPTIONS) {
      expect(options).toContain(b);
    }
    expect(options.some((o) => o.startsWith('plot:'))).toBe(true);
    expect(labels[formatPlotSourceId('a', 'plot')]).toContain('SMA');
  });

  it('resolves plot refs to series arrays', () => {
    const cache = {
      a: { name: 'SMA', series: { sma: [1, 2, 3, 4] } },
    };
    const inputs = {
      Source: formatPlotSourceId('a', 'sma'),
      Length: 14,
      Price: 'close',
    };
    const resolved = resolveInputSourceValues(inputs, cache)!;
    expect(resolved.Source).toEqual([1, 2, 3, 4]);
    expect(resolved.Length).toBe(14);
    expect(resolved.Price).toBe('close');
  });

  it('orders producers before consumers', () => {
    const a = { id: 'a', inputValues: { Source: 'close' } };
    const b = {
      id: 'b',
      inputValues: { Source: formatPlotSourceId('a', 'sma') },
    };
    const c = {
      id: 'c',
      inputValues: { Source: formatPlotSourceId('b', 'out') },
    };
    // Insert reverse order
    const ordered = orderIndicatorsByPlotDeps([c, b, a]);
    expect(ordered.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
});
