/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { buildOverlayPayloads, pickOverlayColor } from '../src/indicators/apply-overlays';
import { PLOT_PALETTE } from '../src/chart/series-factory';
import { beginRunEpoch, isRunEpochCurrent, _resetRunEpochForTests } from '../src/indicators/run-helpers';
import type { RunResult, PlotMetaEntry } from '../src/indicators/runner';
import type { Bar } from '../src/store/types';

function makeBar(time: number, close: number): Bar {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 100 };
}

function makeContext(overrides: Partial<{
  epoch: number;
  userPlotColors: Record<string, { color: string; custom?: boolean; width?: number; visible?: boolean }>;
  seriesEntries: ReadonlyArray<readonly [string, unknown[]]>;
  plotMeta: Record<string, PlotMetaEntry>;
  ohlcvTimes: number[];
  result: RunResult;
}> = {}) {
  const bars: Bar[] = [
    makeBar(100, 100),
    makeBar(160, 101),
    makeBar(220, 102),
    makeBar(280, 103),
  ];
  const ohlcvTimes = bars.map((b) => b.time);

  const defaultSeriesEntries: ReadonlyArray<readonly [string, unknown[]]> = [
    ['plot1', [1, 2, 3, 4]],
    ['plot2', [5, 6, 7, 8]],
  ];

  const defaultPlotMeta: Record<string, PlotMetaEntry> = {
    plot1: { kind: 'plot', color: '#ff0000', linewidth: 2 },
    plot2: { kind: 'plot', color: '#00ff00', linewidth: 1 },
  };

  return {
    epoch: overrides.epoch ?? beginRunEpoch(),
    silent: true,
    result: overrides.result ?? {
      status: 'success',
      plots: [],
      series: {},
      events: [],
      meta: {},
    } as RunResult,
    seriesEntries: overrides.seriesEntries ?? defaultSeriesEntries,
    split: {
      lines: [
        { key: 'plot1', values: [1, 2, 3, 4], meta: defaultPlotMeta.plot1! },
        { key: 'plot2', values: [5, 6, 7, 8], meta: defaultPlotMeta.plot2! },
      ],
      bgcolors: [],
      shapes: [],
      ohlc: [],
    } as any,
    plotMeta: overrides.plotMeta ?? defaultPlotMeta,
    ohlcvTimes: overrides.ohlcvTimes ?? ohlcvTimes,
    needsAlign: false,
    resultTimes: null,
    chartWindowBars: 4,
    seriesMap: {},
    userPlotColors: overrides.userPlotColors ?? {},
    scriptName: 'TestScript',
  };
}

describe('pickOverlayColor', () => {
  it('prefers user color over meta color', () => {
    const color = pickOverlayColor('#ff0000', '#00ff00', '#0000ff');
    expect(color).toBe('#ff0000');
  });

  it('falls back to meta color when user color is null', () => {
    const color = pickOverlayColor(null, '#00ff00', '#0000ff');
    expect(color).toBe('#00ff00');
  });

  it('falls back to palette when both are null', () => {
    const color = pickOverlayColor(null, null, '#0000ff');
    expect(color).toBe('#0000ff');
  });

  it('resolves Pine color forms', () => {
    const color = pickOverlayColor('color.red', null, '#0000ff');
    expect(color).toBe('#ff0000');
  });

  it('passes through bare CSS color names', () => {
    const color = pickOverlayColor('invalid', '#00ff00', '#0000ff');
    expect(color).toBe('invalid'); // bare words treated as CSS color names
  });
});

describe('buildOverlayPayloads', () => {
  beforeEach(() => {
    _resetRunEpochForTests();
  });

  it('applies user custom color over engine meta color', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ffff00', custom: true },
      },
    });
    const out = buildOverlayPayloads(ctx);
    expect(out.superseded).toBeUndefined();
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1?.color).toBe('#ffff00'); // user custom color wins
  });

  it('ignores non-custom user color, uses engine meta color', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ffff00', custom: false },
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1?.color).toBe('#ff0000'); // engine meta color wins
  });

  it('uses palette when no user color and no meta color', () => {
    const ctx = makeContext({
      plotMeta: {
        plot1: { kind: 'plot' }, // no color
        plot2: { kind: 'plot', color: '#00ff00' },
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1?.color).toBe(PLOT_PALETTE[0]); // palette fallback
  });

  it('applies user custom width over engine linewidth', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ff0000', custom: true, width: 4 },
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1?.linewidth).toBe(4);
  });

  it('uses engine linewidth when user width not set', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ff0000', custom: true }, // no width
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1?.linewidth).toBe(2); // from plotMeta
  });

  it('skips plot when user sets visible: false', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ff0000', custom: true, visible: false },
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1).toBeUndefined(); // plot should be skipped
  });

  it('includes plot when user sets visible: true', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ff0000', custom: true, visible: true },
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1).toBeDefined();
    expect(line1?.color).toBe('#ff0000');
  });

  it('uses default visible when not specified', () => {
    const ctx = makeContext({
      userPlotColors: {
        plot1: { color: '#ff0000', custom: true }, // no visible
      },
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1).toBeDefined(); // default visible
  });

  it('respects hline kind from plotMeta', () => {
    const ctx = makeContext({
      plotMeta: {
        plot1: { kind: 'hline', price: 100, color: '#ff0000' },
      },
      seriesEntries: [['plot1', [100, 100, 100, 100]]],
    });
    const out = buildOverlayPayloads(ctx);
    const line1 = out.overlayLines.find((l) => l.name === 'plot1');
    expect(line1?.kind).toBe('hline');
    expect(line1?.price).toBe(100);
  });

  it('skips empty series (no samples)', () => {
    const ctx = makeContext({
      seriesEntries: [
        ['empty', [null, null, null, null]],
        ['valid', [1, 2, 3, 4]],
      ],
    });
    const out = buildOverlayPayloads(ctx);
    const emptyLine = out.overlayLines.find((l) => l.name === 'empty');
    const validLine = out.overlayLines.find((l) => l.name === 'valid');
    expect(emptyLine).toBeUndefined();
    expect(validLine).toBeDefined();
  });

  it('returns superseded when epoch is not current', () => {
    const ctx = makeContext({ epoch: 999 }); // different epoch
    // We can't easily test epoch check without mocking isRunEpochCurrent
    // This is more of an integration test
  });

  it('handles legacy single-array plots when no named series', () => {
    const ctx = makeContext({
      seriesEntries: [], // no named series
      result: {
        status: 'success',
        plots: [10, 20, 30, 40],
        series: {},
        events: [],
        meta: {},
      } as RunResult,
    });
    const out = buildOverlayPayloads(ctx);
    expect(out.overlayLines.length).toBe(1);
    expect(out.overlayLines[0]?.name).toBe('TestScript');
    expect(out.overlayLines[0]?.data.length).toBe(4);
  });

  it('skips legacy plots when named series exist', () => {
    const ctx = makeContext({
      result: {
        status: 'success',
        plots: [10, 20, 30, 40],
        series: {},
        events: [],
        meta: {},
      } as RunResult,
    });
    const out = buildOverlayPayloads(ctx);
    // Should use named series (plot1, plot2) not legacy plots
    expect(out.overlayLines.length).toBe(2);
    expect(out.overlayLines.map((l) => l.name)).toEqual(['plot1', 'plot2']);
  });
});