/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Plot/series → chart visuals (histograms, shapes→markers, kind split).
 * Invariant: truthy plot values and shape maps stay chart-compatible for PaneManager.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  bgcolorSeriesToHistogramData,
  barcolorSeriesToMap,
  buildPlotVisuals,
  coerceBarColor,
  defaultShapeMarkerGlyph,
  isActiveColor,
  isBreakPlotStyle,
  isHistogramSeriesKind,
  isOhlcPlotKind,
  isPointMarkerSeriesKind,
  isTruthyPlotValue,
  lineSeriesToOverlayData,
  lineSeriesToOverlayDataWithBreaks,
  splitOverlayLineSegments,
  mapPlotStyleToSeriesKind,
  mapShapeLocation,
  mapShapeSize,
  mapShapeStyle,
  normalizeLineStyleToken,
  normalizePlotStyleToken,
  ohlcSeriesToBarData,
  parseOhlcCell,
  parsePlotDisplay,
  plotDisplayHas,
  PLOT_DISPLAY,
  resolvePlotFillBands,
  shapeSeriesToMarkers,
  splitSeriesByKind,
} from '../src/results/plot-visuals';
import { toLwcLineData } from '../src/chart/pane-manager';

describe('isTruthyPlotValue', () => {
  it('treats true/non-zero as truthy', () => {
    expect(isTruthyPlotValue(true)).toBe(true);
    expect(isTruthyPlotValue(1)).toBe(true);
    expect(isTruthyPlotValue(-1)).toBe(true);
  });
  it('treats false/null/0/na as falsy', () => {
    expect(isTruthyPlotValue(false)).toBe(false);
    expect(isTruthyPlotValue(null)).toBe(false);
    expect(isTruthyPlotValue(undefined)).toBe(false);
    expect(isTruthyPlotValue(0)).toBe(false);
    expect(isTruthyPlotValue(NaN)).toBe(false);
    expect(isTruthyPlotValue('na')).toBe(false);
  });
});

describe('isActiveColor', () => {
  it('accepts hex and rgba', () => {
    expect(isActiveColor('#F23645')).toBe(true);
    expect(isActiveColor('rgba(255,0,0,0.2)')).toBe(true);
  });
  it('rejects null/empty/transparent', () => {
    expect(isActiveColor(null)).toBe(false);
    expect(isActiveColor('')).toBe(false);
    expect(isActiveColor('na')).toBe(false);
    expect(isActiveColor('rgba(0,0,0,0)')).toBe(false);
  });
});

describe('bgcolorSeriesToHistogramData', () => {
  it('emits bands only for non-null colors', () => {
    const times = [1, 2, 3, 4];
    const colors = [null, 'rgba(255,0,0,0.2)', null, '#00ff00'];
    const data = bgcolorSeriesToHistogramData(times, colors);
    expect(data).toEqual([
      { time: 2, value: 1, color: 'rgba(255,0,0,0.2)' },
      { time: 4, value: 1, color: '#00ff00' },
    ]);
  });

  it('uses fallback when value is boolean true', () => {
    const data = bgcolorSeriesToHistogramData([10], [true], 'rgba(1,2,3,0.1)');
    expect(data).toHaveLength(1);
    expect(data[0]!.color).toBe('rgba(1,2,3,0.1)');
  });
});

describe('shapeSeriesToMarkers', () => {
  it('maps truthy bars to markers with style/location', () => {
    const times = [100, 200, 300];
    const values = [false, true, 1];
    const markers = shapeSeriesToMarkers(times, values, {
      title: 'up',
      color: '#0f0',
      style: 'shape.triangleup',
      location: 'location.belowbar',
      text: 'B',
    });
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      time: 200,
      shape: 'arrowUp',
      position: 'belowBar',
      color: '#0f0',
      text: 'B',
    });
    expect(markers[1]!.time).toBe(300);
  });

  it('plotchar uses circle and char text', () => {
    const markers = shapeSeriesToMarkers([1], [true], {
      kind: 'plotchar',
      char: 'X',
      color: '#fff',
    });
    expect(markers[0]).toMatchObject({ shape: 'circle', text: 'X' });
    expect(markers[0]!.size).toBeUndefined();
  });

  it('includes mapped size from meta.size', () => {
    const markers = shapeSeriesToMarkers([10], [true], {
      style: 'shape.triangleup',
      size: 'size.tiny',
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]!.size).toBe(0.6);
  });

  it('falls back to text_size when size omitted (pyne plotshape)', () => {
    const markers = shapeSeriesToMarkers([10], [true], {
      text_size: 'huge',
    });
    expect(markers[0]!.size).toBe(1.8);
  });

  it('prefers size over text_size', () => {
    const markers = shapeSeriesToMarkers([10], [true], {
      size: 'small',
      text_size: 'huge',
    });
    expect(markers[0]!.size).toBe(0.8);
  });

  it('omits size key when auto / unset', () => {
    const auto = shapeSeriesToMarkers([1], [true], { size: 'size.auto' });
    expect(auto[0]!.size).toBeUndefined();
    expect('size' in auto[0]!).toBe(false);
    const unset = shapeSeriesToMarkers([1], [true], {});
    expect(unset[0]!.size).toBeUndefined();
  });
});

describe('mapShapeSize', () => {
  it('maps size.* tokens and bare names', () => {
    expect(mapShapeSize('size.tiny')).toBe(0.6);
    expect(mapShapeSize('tiny')).toBe(0.6);
    expect(mapShapeSize('size.small')).toBe(0.8);
    expect(mapShapeSize('size.normal')).toBe(1);
    expect(mapShapeSize('size.large')).toBe(1.4);
    expect(mapShapeSize('size.huge')).toBe(1.8);
  });

  it('omits auto / null / empty / na', () => {
    expect(mapShapeSize('size.auto')).toBeUndefined();
    expect(mapShapeSize(null)).toBeUndefined();
    expect(mapShapeSize('')).toBeUndefined();
    expect(mapShapeSize('na')).toBeUndefined();
  });

  it('uses small numerics as LWC size; scales Pine point sizes', () => {
    expect(mapShapeSize(1)).toBe(1);
    expect(mapShapeSize(0.6)).toBe(0.6);
    expect(mapShapeSize(8)).toBeCloseTo(8 / 12);
    expect(mapShapeSize(12)).toBe(1);
    expect(mapShapeSize('12')).toBe(1);
  });

  it('rejects non-positive / non-finite numbers', () => {
    expect(mapShapeSize(0)).toBeUndefined();
    expect(mapShapeSize(-1)).toBeUndefined();
    expect(mapShapeSize(NaN)).toBeUndefined();
  });
});

describe('parsePlotDisplay', () => {
  it('defaults missing to display.all', () => {
    expect(parsePlotDisplay(undefined)).toBe(PLOT_DISPLAY.all);
    expect(parsePlotDisplay(null)).toBe(PLOT_DISPLAY.all);
    expect(parsePlotDisplay('')).toBe(PLOT_DISPLAY.all);
    expect(plotDisplayHas(undefined, PLOT_DISPLAY.pane)).toBe(true);
    expect(plotDisplayHas(undefined, PLOT_DISPLAY.data_window)).toBe(true);
  });

  it('maps tokens and display.* prefixes', () => {
    expect(parsePlotDisplay('display.none')).toBe(PLOT_DISPLAY.none);
    expect(parsePlotDisplay('none')).toBe(0);
    expect(parsePlotDisplay('display.data_window')).toBe(PLOT_DISPLAY.data_window);
    expect(parsePlotDisplay('pane')).toBe(PLOT_DISPLAY.pane);
    expect(parsePlotDisplay('display.all')).toBe(PLOT_DISPLAY.all);
    expect(plotDisplayHas('display.data_window', PLOT_DISPLAY.pane)).toBe(false);
    expect(plotDisplayHas('display.data_window', PLOT_DISPLAY.data_window)).toBe(true);
    expect(plotDisplayHas('display.none', PLOT_DISPLAY.pane)).toBe(false);
    expect(plotDisplayHas('display.none', PLOT_DISPLAY.data_window)).toBe(false);
  });

  it('parses integer bitfields and combined tokens', () => {
    expect(parsePlotDisplay(2)).toBe(PLOT_DISPLAY.data_window);
    expect(parsePlotDisplay(15)).toBe(PLOT_DISPLAY.all);
    expect(parsePlotDisplay(PLOT_DISPLAY.pane + PLOT_DISPLAY.data_window)).toBe(3);
    expect(parsePlotDisplay('pane+data_window')).toBe(3);
    expect(plotDisplayHas(3, PLOT_DISPLAY.pane)).toBe(true);
    expect(plotDisplayHas(3, PLOT_DISPLAY.price_scale)).toBe(false);
  });
});

describe('mapShapeStyle / mapShapeLocation', () => {
  it('maps plotarrow direction from signed sample', () => {
    expect(mapShapeStyle(undefined, 'plotarrow', 1.5)).toBe('arrowUp');
    expect(mapShapeStyle(undefined, 'plotarrow', -2)).toBe('arrowDown');
  });

  it('maps triangle down / abovebar', () => {
    expect(mapShapeStyle('shape.triangledown')).toBe('arrowDown');
    expect(mapShapeLocation('location.abovebar')).toBe('aboveBar');
  });

  it('maps diamond to square (LWC has no diamond shape)', () => {
    expect(mapShapeStyle('shape.diamond')).toBe('square');
    expect(mapShapeStyle('diamond')).toBe('square');
  });

  it('maps cross / xcross to square (distinct from circle)', () => {
    expect(mapShapeStyle('shape.cross')).toBe('square');
    expect(mapShapeStyle('shape.xcross')).toBe('square');
    expect(mapShapeStyle('cross')).toBe('square');
    expect(mapShapeStyle('shape.circle')).toBe('circle');
  });

  it('defaultShapeMarkerGlyph supplies + / ✕ when text omitted', () => {
    expect(defaultShapeMarkerGlyph('shape.cross')).toBe('+');
    expect(defaultShapeMarkerGlyph('shape.xcross')).toBe('✕');
    expect(defaultShapeMarkerGlyph('shape.diamond')).toBeNull();
    expect(defaultShapeMarkerGlyph(null)).toBeNull();
  });

  it('shapeSeriesToMarkers uses cross glyph when no text/char/title', () => {
    const markers = shapeSeriesToMarkers([10], [true], {
      style: 'shape.xcross',
      color: '#f00',
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ shape: 'square', text: '✕', color: '#f00' });
  });

  it('shapeSeriesToMarkers prefers explicit text over cross glyph', () => {
    const markers = shapeSeriesToMarkers([10], [true], {
      style: 'shape.cross',
      text: 'BUY',
    });
    expect(markers[0]!.text).toBe('BUY');
    expect(markers[0]!.shape).toBe('square');
  });
});

describe('mapPlotStyleToSeriesKind', () => {
  it('normalizes plot.style_* tokens', () => {
    expect(normalizePlotStyleToken('plot.style_stepline')).toBe('stepline');
    expect(normalizePlotStyleToken('style_columns')).toBe('columns');
    expect(normalizePlotStyleToken('histogram')).toBe('histogram');
    expect(normalizePlotStyleToken('plot.style_stepline_diamond')).toBe('stepline_diamond');
    expect(normalizePlotStyleToken('plot.style_cross')).toBe('cross');
  });

  it('maps Pine plot styles to distinct LWC series kinds', () => {
    expect(mapPlotStyleToSeriesKind('plot.style_line')).toBe('line');
    expect(mapPlotStyleToSeriesKind('plot.style_stepline')).toBe('stepline');
    expect(mapPlotStyleToSeriesKind('plot.style_steplinebr')).toBe('stepline');
    expect(mapPlotStyleToSeriesKind('plot.style_stepline_diamond')).toBe('stepline_diamond');
    expect(mapPlotStyleToSeriesKind('plot.style_histogram')).toBe('histogram');
    expect(mapPlotStyleToSeriesKind('plot.style_columns')).toBe('columns');
    expect(mapPlotStyleToSeriesKind('plot.style_area')).toBe('area');
    expect(mapPlotStyleToSeriesKind('plot.style_areabr')).toBe('area');
    expect(mapPlotStyleToSeriesKind('plot.style_circles')).toBe('circles');
    expect(mapPlotStyleToSeriesKind('plot.style_cross')).toBe('cross');
    expect(mapPlotStyleToSeriesKind(null)).toBe('line');
  });

  it('classifies histogram family and point-marker kinds', () => {
    expect(isHistogramSeriesKind('histogram')).toBe(true);
    expect(isHistogramSeriesKind('columns')).toBe(true);
    expect(isHistogramSeriesKind('line')).toBe(false);
    expect(isPointMarkerSeriesKind('circles')).toBe(true);
    expect(isPointMarkerSeriesKind('cross')).toBe(true);
    expect(isPointMarkerSeriesKind('stepline_diamond')).toBe(true);
    expect(isPointMarkerSeriesKind('stepline')).toBe(false);
  });

  const PLOT_STYLE_TO_KIND: Array<{
    token: string;
    bare: string;
    kind: ReturnType<typeof mapPlotStyleToSeriesKind>;
  }> = [
    { token: 'plot.style_line', bare: 'line', kind: 'line' },
    { token: 'plot.style_linebr', bare: 'linebr', kind: 'line' },
    { token: 'plot.style_stepline', bare: 'stepline', kind: 'stepline' },
    { token: 'plot.style_steplinebr', bare: 'steplinebr', kind: 'stepline' },
    { token: 'plot.style_stepline_diamond', bare: 'stepline_diamond', kind: 'stepline_diamond' },
    { token: 'plot.style_histogram', bare: 'histogram', kind: 'histogram' },
    { token: 'plot.style_cross', bare: 'cross', kind: 'cross' },
    { token: 'plot.style_area', bare: 'area', kind: 'area' },
    { token: 'plot.style_areabr', bare: 'areabr', kind: 'area' },
    { token: 'plot.style_columns', bare: 'columns', kind: 'columns' },
    { token: 'plot.style_circles', bare: 'circles', kind: 'circles' },
  ];

  it('maps every documented plot.style_* token to a series kind', () => {
    for (const { token, bare, kind } of PLOT_STYLE_TO_KIND) {
      expect(normalizePlotStyleToken(token)).toBe(bare);
      expect(normalizePlotStyleToken(`style_${bare}`)).toBe(bare);
      expect(normalizePlotStyleToken(bare)).toBe(bare);
      expect(mapPlotStyleToSeriesKind(token)).toBe(kind);
      expect(mapPlotStyleToSeriesKind(`style_${bare}`)).toBe(kind);
      expect(mapPlotStyleToSeriesKind(bare)).toBe(kind);
    }
  });

  it('defaults unknown / null / empty style to line', () => {
    expect(mapPlotStyleToSeriesKind(null)).toBe('line');
    expect(mapPlotStyleToSeriesKind('')).toBe('line');
    expect(mapPlotStyleToSeriesKind('plot.style_not_a_real_style')).toBe('line');
  });
});

describe('normalizeLineStyleToken', () => {
  it('maps plot.linestyle_* and bare tokens', () => {
    expect(normalizeLineStyleToken('plot.linestyle_solid')).toBe('solid');
    expect(normalizeLineStyleToken('plot.linestyle_dashed')).toBe('dashed');
    expect(normalizeLineStyleToken('plot.linestyle_dotted')).toBe('dotted');
    expect(normalizeLineStyleToken('linestyle_dashed')).toBe('dashed');
    expect(normalizeLineStyleToken('style_dotted')).toBe('dotted');
    expect(normalizeLineStyleToken('hline.style_dashed')).toBe('dashed');
    expect(normalizeLineStyleToken('dashed')).toBe('dashed');
    expect(normalizeLineStyleToken(null)).toBe('solid');
    expect(normalizeLineStyleToken('')).toBe('solid');
    expect(normalizeLineStyleToken('unknown')).toBe('solid');
  });
});

describe('isBreakPlotStyle', () => {
  it('true only for linebr / areabr / steplinebr', () => {
    expect(isBreakPlotStyle('plot.style_linebr')).toBe(true);
    expect(isBreakPlotStyle('style_linebr')).toBe(true);
    expect(isBreakPlotStyle('plot.style_areabr')).toBe(true);
    expect(isBreakPlotStyle('plot.style_steplinebr')).toBe(true);
    expect(isBreakPlotStyle('plot.style_line')).toBe(false);
    expect(isBreakPlotStyle(null)).toBe(false);
  });

  it('lineSeriesToOverlayData emits whitespace gaps for linebr na segments', () => {
    // Supertrend dual-line: inactive side is na (time slots kept; LWC still connects)
    const times = [1, 2, 3, 4, 5];
    const up = [10, 11, null, null, 14];
    const data = lineSeriesToOverlayData(times, up);
    expect(data).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 11 },
      { time: 3 },
      { time: 4 },
      { time: 5, value: 14 },
    ]);
    expect(mapPlotStyleToSeriesKind('style_linebr')).toBe('line');
    expect(splitOverlayLineSegments(data)).toEqual([
      [
        { time: 1, value: 10 },
        { time: 2, value: 11 },
      ],
      [{ time: 5, value: 14 }],
    ]);
  });
});

describe('buildPlotVisuals style / linestyle forward', () => {
  it('forwards style and linestyle from plot_meta onto line specs', () => {
    const times = [1, 2, 3];
    const series = {
      macd: [1, 2, 3],
      hist: [0.5, -0.2, 0.1],
    };
    const meta = {
      macd: {
        kind: 'plot' as const,
        color: '#6366f1',
        style: 'plot.style_stepline',
        linestyle: 'line.style_dashed',
        linewidth: 2,
      },
      hist: {
        kind: 'plot' as const,
        color: '#34d399',
        style: 'plot.style_columns',
        histbase: 50,
      },
    };
    const visuals = buildPlotVisuals(series, meta, times);
    expect(visuals.lines).toHaveLength(2);
    const byName = Object.fromEntries(visuals.lines.map((l) => [l.name, l]));
    expect(byName['macd']!.style).toBe('plot.style_stepline');
    expect(byName['macd']!.linestyle).toBe('line.style_dashed');
    expect(byName['macd']!.linewidth).toBe(2);
    expect(byName['hist']!.style).toBe('plot.style_columns');
    expect(byName['hist']!.histbase).toBe(50);
    expect(mapPlotStyleToSeriesKind(byName['macd']!.style)).toBe('stepline');
    expect(mapPlotStyleToSeriesKind(byName['hist']!.style)).toBe('columns');
    expect(isHistogramSeriesKind(mapPlotStyleToSeriesKind(byName['hist']!.style))).toBe(true);
  });

  it('forwards null style when meta omits style (defaults to line kind)', () => {
    const visuals = buildPlotVisuals(
      { close: [10, 11] },
      { close: { kind: 'plot', color: '#fff' } },
      [1, 2],
    );
    expect(visuals.lines).toHaveLength(1);
    expect(visuals.lines[0]!.style).toBeNull();
    expect(mapPlotStyleToSeriesKind(visuals.lines[0]!.style)).toBe('line');
  });
});

describe('lineSeriesToOverlayData whitespace', () => {
  it('keeps one point per bar time; leading na become whitespace', () => {
    const times = [100, 200, 300, 400];
    // SMA-style warmup: first two bars na
    const values = [null, null, 1.5, 2.5];
    const data = lineSeriesToOverlayData(times, values);
    expect(data).toHaveLength(4);
    expect(data[0]).toEqual({ time: 100 });
    expect(data[1]).toEqual({ time: 200 });
    expect(data[2]).toEqual({ time: 300, value: 1.5 });
    expect(data[3]).toEqual({ time: 400, value: 2.5 });

    const lwc = toLwcLineData(data);
    expect(lwc).toHaveLength(4);
    expect(lwc[0]).toEqual({ time: 100 });
    expect(lwc[2]).toEqual({ time: 300, value: 1.5 });
  });

  it('pads to full times length when series is shorter', () => {
    const data = lineSeriesToOverlayData([1, 2, 3], [9]);
    expect(data).toEqual([{ time: 1, value: 9 }, { time: 2 }, { time: 3 }]);
  });

  it('mid-series na gaps stay as whitespace (LWC still connects; *br splits runs)', () => {
    const times = [1, 2, 3, 4, 5];
    const values = [10, null, null, 20, 30];
    const data = lineSeriesToOverlayData(times, values);
    expect(data).toEqual([
      { time: 1, value: 10 },
      { time: 2 },
      { time: 3 },
      { time: 4, value: 20 },
      { time: 5, value: 30 },
    ]);
    expect(lineSeriesToOverlayDataWithBreaks(times, values, { breaks: true })).toEqual(data);
    expect(isBreakPlotStyle('plot.style_linebr')).toBe(true);
    expect(splitOverlayLineSegments(data)).toEqual([
      [{ time: 1, value: 10 }],
      [
        { time: 4, value: 20 },
        { time: 5, value: 30 },
      ],
    ]);
  });
});

describe('splitOverlayLineSegments', () => {
  it('splits Supertrend-style na islands into separate runs', () => {
    const data = [
      { time: 1, value: 10 },
      { time: 2, value: 11 },
      { time: 3 },
      { time: 4 },
      { time: 5, value: 14 },
      { time: 6, value: 15 },
      { time: 7 },
      { time: 8, value: 17 },
    ];
    expect(splitOverlayLineSegments(data)).toEqual([
      [
        { time: 1, value: 10 },
        { time: 2, value: 11 },
      ],
      [
        { time: 5, value: 14 },
        { time: 6, value: 15 },
      ],
      [{ time: 8, value: 17 }],
    ]);
  });

  it('treats NaN / non-finite as a break, not a vertex', () => {
    const data = [
      { time: 1, value: 1 },
      { time: 2, value: Number.NaN },
      { time: 3, value: 3 },
    ];
    expect(splitOverlayLineSegments(data)).toEqual([
      [{ time: 1, value: 1 }],
      [{ time: 3, value: 3 }],
    ]);
  });

  it('returns empty when every sample is na', () => {
    expect(splitOverlayLineSegments([{ time: 1 }, { time: 2 }])).toEqual([]);
  });
});

describe('splitSeriesByKind + buildPlotVisuals', () => {
  it('splits plot / bgcolor / plotshape and builds chart payloads', () => {
    const times = [1, 2, 3];
    const series = {
      close: [10, 11, 12],
      bg: [null, 'rgba(255,0,0,0.15)', null],
      ups: [false, true, false],
    };
    const meta = {
      close: { kind: 'plot', color: '#939fff' },
      bg: { kind: 'bgcolor', title: 'bg' },
      ups: {
        kind: 'plotshape',
        style: 'shape.triangleup',
        location: 'location.belowbar',
        color: '#8ef5a8',
        title: 'up',
      },
    };
    const split = splitSeriesByKind(series, meta);
    expect(split.lines.map((l) => l.key)).toEqual(['close']);
    expect(split.bgcolors.map((b) => b.key)).toEqual(['bg']);
    expect(split.shapes.map((s) => s.key)).toEqual(['ups']);

    const visuals = buildPlotVisuals(series, meta, times);
    expect(visuals.lines).toHaveLength(1);
    expect(visuals.lines[0]!.data).toHaveLength(3);
    expect(visuals.bgcolors[0]!.data).toEqual([
      { time: 2, value: 1, color: 'rgba(255,0,0,0.15)' },
    ]);
    expect(visuals.shapes).toHaveLength(1);
    expect(visuals.shapes[0]!.time).toBe(2);
  });

  it('treats missing kind as line plot (compat)', () => {
    const split = splitSeriesByKind({ a: [1, 2] }, {});
    expect(split.lines).toHaveLength(1);
    expect(split.bgcolors).toHaveLength(0);
  });

  it('routes styled plot kinds (histogram/area/columns/line) to lines, never drops them', () => {
    const series = {
      h: [1, 2, 3],
      a: [4, 5, 6],
      c: [7, 8, 9],
      l: [10, 11, 12],
    };
    const meta = {
      h: { kind: 'histogram' },
      a: { kind: 'area' },
      c: { kind: 'columns' },
      l: { kind: 'line' },
    };
    const split = splitSeriesByKind(series, meta);
    expect(split.lines.map((x) => x.key).sort()).toEqual(['a', 'c', 'h', 'l']);
    expect(split.bgcolors).toHaveLength(0);
    expect(split.shapes).toHaveLength(0);
    expect(split.ohlc).toHaveLength(0);
  });

  it('routes barcolor series and builds time→color map', () => {
    const times = [10, 20, 30];
    const series = {
      bc: [null, '#F23645', 'rgba(0,255,0,0.5)'],
    };
    const meta = { bc: { kind: 'barcolor', title: 'bc' } };
    const split = splitSeriesByKind(series, meta);
    expect(split.barcolors.map((b) => b.key)).toEqual(['bc']);
    expect(split.lines).toHaveLength(0);
    expect(coerceBarColor('#abc')).toBe('#abc');
    expect(coerceBarColor('na')).toBeNull();
    const map = barcolorSeriesToMap(times, split.barcolors);
    expect(map.get(20)).toBe('#F23645');
    expect(map.get(30)).toBe('rgba(0,255,0,0.5)');
    expect(map.has(10)).toBe(false);
  });

  it('coerceBarColor rejects na-like / empty and accepts hex rgb hsl color.* names', () => {
    expect(coerceBarColor(null)).toBeNull();
    expect(coerceBarColor(undefined)).toBeNull();
    expect(coerceBarColor('')).toBeNull();
    expect(coerceBarColor('   ')).toBeNull();
    expect(coerceBarColor('na')).toBeNull();
    expect(coerceBarColor('NA')).toBeNull();
    expect(coerceBarColor('nan')).toBeNull();
    expect(coerceBarColor('null')).toBeNull();
    expect(coerceBarColor('none')).toBeNull();
    expect(coerceBarColor('undefined')).toBeNull();
    expect(coerceBarColor(true)).toBeNull();
    expect(coerceBarColor({})).toBeNull();
    expect(coerceBarColor('not a color!!!')).toBeNull();

    expect(coerceBarColor('#F23645')).toBe('#F23645');
    expect(coerceBarColor('  #abc  ')).toBe('#abc');
    expect(coerceBarColor('rgb(1,2,3)')).toBe('rgb(1,2,3)');
    expect(coerceBarColor('rgba(1,2,3,0.5)')).toBe('rgba(1,2,3,0.5)');
    expect(coerceBarColor('hsl(120,50%,40%)')).toBe('hsl(120,50%,40%)');
    expect(coerceBarColor('color.red')).toBe('color.red');
    expect(coerceBarColor('red')).toBe('red');
  });

  it('coerceBarColor maps finite integer 0xRRGGBB / 0xAARRGGBB', () => {
    expect(coerceBarColor(0xff0000)).toBe('#ff0000');
    expect(coerceBarColor(0x00ff00)).toBe('#00ff00');
    expect(coerceBarColor(0)).toBe('#000000');
    // ARGB: alpha high byte, RGB lower 24 — implementation masks R/G/B from low 24 bits
    expect(coerceBarColor(0x80ff0000)).toBe('#ff0000');
    expect(coerceBarColor(Number.NaN)).toBeNull();
    expect(coerceBarColor(Number.POSITIVE_INFINITY)).toBeNull();
    expect(coerceBarColor(-1)).toBeNull();
  });

  it('barcolorSeriesToMap later series win; empty / non-array safe', () => {
    expect(barcolorSeriesToMap([], [{ values: ['#f00'] }]).size).toBe(0);
    expect(barcolorSeriesToMap([1, 2], []).size).toBe(0);
    expect(
      barcolorSeriesToMap([1, 2], [{ values: null as unknown as unknown[] }]).size,
    ).toBe(0);

    const times = [100, 200, 300, 400];
    const map = barcolorSeriesToMap(times, [
      { values: ['#111111', null, 'na', '#222222'] },
      { values: [null, '#aaaaaa', '#bbbbbb'] }, // shorter: only first 3 bars
    ]);
    expect(map.get(100)).toBe('#111111'); // first series only
    expect(map.get(200)).toBe('#aaaaaa'); // second overwrites null skip of first
    expect(map.get(300)).toBe('#bbbbbb'); // second overwrites na of first
    expect(map.get(400)).toBe('#222222'); // only first series reaches bar 4
    expect(map.has(200)).toBe(true);

    // Non-finite times skipped
    const sparse = barcolorSeriesToMap([Number.NaN, 50], [{ values: ['#f00', '#0f0'] }]);
    expect(sparse.has(Number.NaN as unknown as number)).toBe(false);
    expect(sparse.get(50)).toBe('#0f0');
  });

  /**
   * PYNE modern success payload: top-level `plots` is often `[null, …]` of bar
   * length while real values live in named `series` + `meta.plot_meta`.
   * Chart path must still emit overlay line data (runner prefers series first).
   */
  it('named series + plot_meta produce lines when legacy plots[] is all-null', () => {
    const times = [1, 2, 3, 4, 5];
    const plots = times.map(() => null);
    const series = {
      bgcolor: [null, null, null, null, null],
      'EMAma Girang': [null, null, 84088.79, 84100.1, 84120.5],
      'EMAma Muda': [null, 83000, 83100, 83200, 83300],
      'EMAma Tua': [82000, 82100, 82200, 82300, 82400],
    };
    const plotMeta = {
      bgcolor: { kind: 'bgcolor' as const, index: 0 },
      'EMAma Girang': { kind: 'plot' as const, color: '#f23645', index: 1 },
      'EMAma Muda': { kind: 'plot' as const, color: '#2962ff', index: 2 },
      'EMAma Tua': { kind: 'plot' as const, color: '#ff9800', index: 3 },
    };

    expect(plots.length).toBe(times.length);
    expect(plots.every((v) => v == null)).toBe(true);

    const split = splitSeriesByKind(series, plotMeta);
    // Runner: seriesEntries = split.lines — must be non-empty so legacy plots[] is ignored
    expect(split.lines.map((l) => l.key).sort()).toEqual([
      'EMAma Girang',
      'EMAma Muda',
      'EMAma Tua',
    ]);
    expect(split.bgcolors.map((b) => b.key)).toEqual(['bgcolor']);

    const visuals = buildPlotVisuals(series, plotMeta, times);
    expect(visuals.lines).toHaveLength(3);
    const byName = Object.fromEntries(visuals.lines.map((l) => [l.name, l]));
    expect(byName['EMAma Girang']!.color).toBe('#f23645');
    expect(byName['EMAma Girang']!.data.filter((d) => d.value != null)).toHaveLength(3);
    expect(byName['EMAma Muda']!.data.filter((d) => d.value != null)).toHaveLength(4);
    expect(byName['EMAma Tua']!.data.filter((d) => d.value != null)).toHaveLength(5);
    // Finite sample at last bar (overlay chart must not be empty)
    expect(byName['EMAma Tua']!.data[4]).toEqual({ time: 5, value: 82400 });
    // bgcolor all-null → no bands
    expect(visuals.bgcolors).toHaveLength(0);
  });

  it('resolves fill(plot1, plot2) bands with color and edge series', () => {
    const series = {
      avg: [10, 11, 12, 13],
      lp: [8, 9, 10, 11],
      band: [
        'rgba(255, 82, 82, 0.2)',
        'rgba(255, 82, 82, 0.2)',
        'rgba(255, 82, 82, 0.2)',
        'rgba(255, 82, 82, 0.2)',
      ],
    };
    const meta = {
      avg: { kind: 'plot' as const, title: 'avg' },
      lp: { kind: 'plot' as const, title: 'lp' },
      band: {
        kind: 'fill' as const,
        title: 'band',
        color: 'rgba(255, 82, 82, 0.2)',
        plot1: 'avg',
        plot2: 'lp',
      },
    };
    const split = splitSeriesByKind(series, meta);
    expect(split.fills.map((f) => f.key)).toEqual(['band']);
    expect(split.lines.map((l) => l.key).sort()).toEqual(['avg', 'lp']);

    const bands = resolvePlotFillBands(series, meta);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.plot1).toBe('avg');
    expect(bands[0]!.plot2).toBe('lp');
    expect(bands[0]!.upper).toEqual([10, 11, 12, 13]);
    expect(bands[0]!.lower).toEqual([8, 9, 10, 11]);
    expect(bands[0]!.color).toContain('255, 82, 82');

    const visuals = buildPlotVisuals(series, meta, [1, 2, 3, 4]);
    expect(visuals.fills).toHaveLength(1);
    expect(visuals.fills[0]!.name).toBe('band');
  });
});

describe('plotbar / plotcandle OHLC', () => {
  it('isOhlcPlotKind recognizes plotbar and plotcandle', () => {
    expect(isOhlcPlotKind('plotbar')).toBe(true);
    expect(isOhlcPlotKind('plotcandle')).toBe(true);
    expect(isOhlcPlotKind('PlotBar')).toBe(true);
    expect(isOhlcPlotKind('plot')).toBe(false);
  });

  it('parseOhlcCell accepts objects, arrays, and scalar close', () => {
    expect(parseOhlcCell({ open: 1, high: 3, low: 0.5, close: 2 })).toEqual({
      open: 1,
      high: 3,
      low: 0.5,
      close: 2,
    });
    expect(parseOhlcCell({ o: 1, h: 2, l: 0.5, c: 1.5, color: '#f00' })).toEqual({
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      color: '#f00',
    });
    expect(parseOhlcCell([10, 12, 9, 11])).toEqual({
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    });
    expect(parseOhlcCell(42)).toEqual({ open: 42, high: 42, low: 42, close: 42 });
    expect(parseOhlcCell(null)).toBeNull();
    expect(parseOhlcCell({ open: 1, high: null, low: 0, close: 1 })).toBeNull();
  });

  it('ohlcSeriesToBarData: object cells', () => {
    const times = [100, 200, 300];
    const values = [
      { open: 10, high: 12, low: 9, close: 11 },
      null,
      { o: 11, h: 14, l: 10, c: 13 },
    ];
    const data = ohlcSeriesToBarData(times, values);
    expect(data).toEqual([
      { time: 100, open: 10, high: 12, low: 9, close: 11 },
      { time: 300, open: 11, high: 14, low: 10, close: 13 },
    ]);
  });

  it('ohlcSeriesToBarData: length-4 array cells', () => {
    const times = [1, 2];
    const values = [
      [1, 2, 0.5, 1.5],
      [1.5, 3, 1.5, 2.8],
    ];
    const data = ohlcSeriesToBarData(times, values);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 });
    expect(data[1]).toEqual({ time: 2, open: 1.5, high: 3, low: 1.5, close: 2.8 });
  });

  it('ohlcSeriesToBarData: close-only scalar fallback (flat OHLC)', () => {
    const data = ohlcSeriesToBarData([10, 20, 30], [null, 5, 7.5]);
    expect(data).toEqual([
      { time: 20, open: 5, high: 5, low: 5, close: 5 },
      { time: 30, open: 7.5, high: 7.5, low: 7.5, close: 7.5 },
    ]);
  });

  it('ohlcSeriesToBarData: meta-linked sibling series', () => {
    const times = [1, 2, 3];
    const series = {
      myBars: [null, null, null],
      o: [10, 11, 12],
      h: [12, 13, 14],
      l: [9, 10, 11],
      c: [11, 12, 13],
    };
    const meta = {
      kind: 'plotbar' as const,
      open: 'o',
      high: 'h',
      low: 'l',
      close: 'c',
    };
    const data = ohlcSeriesToBarData(times, series.myBars, series, meta);
    expect(data).toEqual([
      { time: 1, open: 10, high: 12, low: 9, close: 11 },
      { time: 2, open: 11, high: 13, low: 10, close: 12 },
      { time: 3, open: 12, high: 14, low: 11, close: 13 },
    ]);
  });

  it('splitSeriesByKind + buildPlotVisuals route plotbar/plotcandle to ohlc', () => {
    const times = [1, 2, 3];
    const series = {
      bars: [
        { open: 1, high: 2, low: 0.5, close: 1.5 },
        { open: 1.5, high: 2.5, low: 1, close: 2 },
        { open: 2, high: 3, low: 1.5, close: 2.5 },
      ],
      candles: [
        [10, 12, 9, 11],
        [11, 13, 10, 12],
        [12, 14, 11, 13],
      ],
      line: [1, 2, 3],
    };
    const plotMeta = {
      bars: { kind: 'plotbar' as const, color: '#5ecf8a' },
      candles: { kind: 'plotcandle' as const, color: '#e85d4c' },
      line: { kind: 'plot' as const, color: '#939fff' },
    };
    const split = splitSeriesByKind(series, plotMeta);
    expect(split.ohlc.map((e) => e.key).sort()).toEqual(['bars', 'candles']);
    expect(split.lines.map((l) => l.key)).toEqual(['line']);

    const visuals = buildPlotVisuals(series, plotMeta, times);
    expect(visuals.ohlc).toHaveLength(2);
    const byName = Object.fromEntries(visuals.ohlc.map((o) => [o.name, o]));
    expect(byName.bars!.kind).toBe('plotbar');
    expect(byName.candles!.kind).toBe('plotcandle');
    expect(byName.bars!.data).toHaveLength(3);
    expect(byName.candles!.data[0]).toEqual({
      time: 1,
      open: 10,
      high: 12,
      low: 9,
      close: 11,
    });
    expect(byName.bars!.color).toBe('#5ecf8a');
  });

  it('skips OHLC sibling series from line split when meta refs present', () => {
    const series = {
      renko: [1, 2, 3],
      renko_open: [1, 2, 3],
      renko_high: [2, 3, 4],
      renko_low: [0.5, 1, 2],
      renko_close: [1.5, 2.5, 3.5],
    };
    const meta = {
      renko: {
        kind: 'plotcandle' as const,
        open: 'renko_open',
        high: 'renko_high',
        low: 'renko_low',
        close: 'renko_close',
      },
    };
    const split = splitSeriesByKind(series, meta);
    expect(split.ohlc.map((e) => e.key)).toEqual(['renko']);
    expect(split.lines).toHaveLength(0);
  });
});
