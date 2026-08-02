/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
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
  buildPlotVisuals,
  isActiveColor,
  isTruthyPlotValue,
  lineSeriesToOverlayData,
  mapShapeLocation,
  mapShapeStyle,
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
  });
});

describe('mapShapeStyle / mapShapeLocation', () => {
  it('maps triangle down / abovebar', () => {
    expect(mapShapeStyle('shape.triangledown')).toBe('arrowDown');
    expect(mapShapeLocation('location.abovebar')).toBe('aboveBar');
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
});
