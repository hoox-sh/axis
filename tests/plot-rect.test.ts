/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { measureChartPlotRect } from '../src/chart/plot-rect.ts';

describe('measureChartPlotRect', () => {
  const host = {
    getBoundingClientRect: () => ({ width: 800, height: 400 }),
    clientWidth: 800,
    clientHeight: 400,
  };

  it('uses paneSize when present (excludes scales)', () => {
    const chart = {
      paneSize: () => ({ width: 700, height: 370 }),
      timeScale: () => ({ width: () => 700, height: () => 30 }),
      priceScale: (id: string) => ({
        width: () => (id === 'right' ? 100 : 0),
      }),
    };
    const r = measureChartPlotRect(chart, host);
    expect(r.width).toBe(700);
    expect(r.height).toBe(370);
    expect(r.left).toBe(0);
    expect(r.rightScale).toBe(100);
    expect(r.timeScale).toBe(30);
  });

  it('subtracts scale gutters when paneSize is missing', () => {
    const chart = {
      timeScale: () => ({ width: () => 728, height: () => 26 }),
      priceScale: (id: string) => ({
        width: () => (id === 'right' ? 72 : id === 'left' ? 0 : 0),
      }),
    };
    const r = measureChartPlotRect(chart, host);
    expect(r.width).toBe(728);
    expect(r.height).toBe(374);
    expect(r.rightScale).toBe(72);
    expect(r.timeScale).toBe(26);
  });

  it('offsets left when a left price scale is present', () => {
    const chart = {
      paneSize: () => ({ width: 668, height: 400 }),
      priceScale: (id: string) => ({
        width: () => (id === 'left' ? 60 : id === 'right' ? 72 : 0),
      }),
      timeScale: () => ({ width: () => 668, height: () => 0 }),
    };
    const r = measureChartPlotRect(chart, host);
    expect(r.left).toBe(60);
    expect(r.width).toBe(668);
    expect(r.rightScale).toBe(72);
  });

  it('falls back to full host when chart APIs are absent', () => {
    const r = measureChartPlotRect(null, host);
    expect(r.width).toBe(800);
    expect(r.height).toBe(400);
    expect(r.left).toBe(0);
    expect(r.rightScale).toBe(0);
  });
});
