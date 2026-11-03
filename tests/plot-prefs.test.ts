// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Per-plot panel prefs: width, line type (AXIS override), `display.*` targets.
 */
import { describe, expect, it } from 'bun:test';
import {
  PANEL_DISPLAY_MASK,
  PLOT_LINE_STYLES,
  effectivePlotDisplay,
  effectivePlotLineStyle,
  effectivePlotWidth,
  formatPlotDisplay,
  formatPlotDisplayCompact,
  hasDisplayOverride,
  normalizePlotLineStyle,
  pinePlotDisplay,
  pinePlotMeta,
  plotDisplayTargets,
  togglePlotDisplayBit,
} from '../src/indicators/plot-prefs';
import { PLOT_DISPLAY } from '../src/results/plot-visuals';

const plot = (patch: Record<string, unknown> = {}) => ({ color: '#fff', ...patch }) as never;

describe('normalizePlotLineStyle', () => {
  it('accepts panel tokens and Pine drawing spellings', () => {
    expect(normalizePlotLineStyle('solid')).toBe('solid');
    expect(normalizePlotLineStyle('line.style_dashed')).toBe('dashed');
    expect(normalizePlotLineStyle('style_dotted')).toBe('dotted');
    expect(normalizePlotLineStyle('large_dashed')).toBe('large_dashed');
    expect(normalizePlotLineStyle('LARGE-DASH')).toBe('large_dashed');
  });

  it('returns null for empty / unknown tokens', () => {
    expect(normalizePlotLineStyle(null)).toBeNull();
    expect(normalizePlotLineStyle('')).toBeNull();
    expect(normalizePlotLineStyle('wavy')).toBeNull();
  });

  it('exposes the picker order', () => {
    expect(PLOT_LINE_STYLES).toEqual(['solid', 'dotted', 'dashed', 'large_dashed']);
  });
});

describe('effectivePlotLineStyle', () => {
  it('prefers the panel override, then the Pine declaration', () => {
    expect(
      effectivePlotLineStyle(plot({ linestyle: 'dotted', pine: { linestyle: 'dashed' } })),
    ).toBe('dotted');
    expect(effectivePlotLineStyle(plot({ pine: { linestyle: 'dashed' } }))).toBe('dashed');
    expect(effectivePlotLineStyle(plot())).toBeNull();
  });
});

describe('display.* masks', () => {
  it('prefers the panel override, then the declaration, then all', () => {
    expect(effectivePlotDisplay(plot({ display: 1, pine: { display: 15 } }))).toBe(1);
    expect(effectivePlotDisplay(plot({ pine: { display: 2 } }))).toBe(2);
    expect(effectivePlotDisplay(plot())).toBe(PLOT_DISPLAY.all);
  });

  it('reads the Pine declaration for the reset hint', () => {
    expect(pinePlotDisplay(plot({ pine: { display: 4 } }))).toBe(4);
    expect(pinePlotDisplay(plot())).toBeNull();
    expect(hasDisplayOverride(plot({ display: 3 }))).toBe(true);
    expect(hasDisplayOverride(plot({ pine: { display: 3 } }))).toBe(false);
  });

  it('toggles targets without touching the status-line bit', () => {
    const pine = PLOT_DISPLAY.all; // includes status_line
    const onlyPane = togglePlotDisplayBit(plot({ pine: { display: pine } }), PLOT_DISPLAY.pane);
    // pane was on → off; data/scale/status untouched
    expect(onlyPane & PLOT_DISPLAY.pane).toBe(0);
    expect(onlyPane & PLOT_DISPLAY.data_window).toBe(PLOT_DISPLAY.data_window);
    expect(onlyPane & PLOT_DISPLAY.status_line).toBe(PLOT_DISPLAY.status_line);
    // toggling back restores it
    const back = togglePlotDisplayBit(plot({ display: onlyPane }), PLOT_DISPLAY.pane);
    expect(back & PLOT_DISPLAY.pane).toBe(PLOT_DISPLAY.pane);
    // panel-managed bits never include the status line
    expect(PANEL_DISPLAY_MASK & PLOT_DISPLAY.status_line).toBe(0);
  });

  it('formats a mask for the card chip', () => {
    expect(formatPlotDisplay(PLOT_DISPLAY.all)).toBe('all');
    expect(formatPlotDisplay(PLOT_DISPLAY.none)).toBe('hidden');
    expect(formatPlotDisplay(PLOT_DISPLAY.pane | PLOT_DISPLAY.price_scale)).toBe('pane · scale');
    expect(formatPlotDisplay(PLOT_DISPLAY.data_window)).toBe('data');
    expect(formatPlotDisplayCompact(PLOT_DISPLAY.all)).toBe('all');
    expect(formatPlotDisplayCompact(PLOT_DISPLAY.none)).toBe('off');
    expect(formatPlotDisplayCompact(PLOT_DISPLAY.pane | PLOT_DISPLAY.data_window)).toBe('PD');
    expect(formatPlotDisplayCompact(PLOT_DISPLAY.all - PLOT_DISPLAY.price_scale)).toBe('PDT');
    expect(plotDisplayTargets(PLOT_DISPLAY.none)).toEqual({
      pane: false,
      dataWindow: false,
      priceScale: false,
      statusLine: false,
      none: true,
    });
  });
});

describe('effectivePlotWidth', () => {
  it('panel override → Pine linewidth → 1, clamped 1–4', () => {
    expect(effectivePlotWidth(plot({ width: 3, pine: { linewidth: 2 } }))).toBe(3);
    expect(effectivePlotWidth(plot({ pine: { linewidth: 2 } }))).toBe(2);
    // The reported bug: an unset width must read 1, so “+” goes 1 → 2.
    expect(effectivePlotWidth(plot())).toBe(1);
    expect(effectivePlotWidth(plot({ width: 9 }))).toBe(4);
    expect(effectivePlotWidth(plot({ width: 0 }))).toBe(1);
    expect(effectivePlotWidth(plot({ width: 2.7 }))).toBe(3);
  });
});

describe('pinePlotMeta', () => {
  it('captures the declared style, display, and linewidth', () => {
    expect(
      pinePlotMeta({ linestyle: 'line.style_dashed', display: 'display.pane', linewidth: 3 }),
    ).toEqual({ linestyle: 'dashed', display: PLOT_DISPLAY.pane, linewidth: 3 });
  });

  it('returns null when the payload declared nothing', () => {
    expect(pinePlotMeta(null)).toBeNull();
    expect(pinePlotMeta({})).toBeNull();
    expect(pinePlotMeta({ display: '' })).toBeNull();
  });
});
