/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  DEFAULT_SCREENSHOT_OPTIONS,
  captureScreenshot,
  loadScreenshotOptions,
  saveScreenshotOptions,
  screenshotCrop,
  screenshotFilename,
  stackLayout,
  watermarkText,
  type SharedChartPlan,
} from '../src/chart/screenshot';
import { setActiveSlotId, setSlotManager } from '../src/chart/chart-registry';
import { buildDefaultCommands } from '../src/ui/command-registry';
import { ICON_MAP } from '../src/ui/icon-map';

const SLOT = 'screenshot-test-slot';

describe('screenshotFilename', () => {
  it('uses symbol, interval, and UTC stamp', () => {
    const at = new Date(Date.UTC(2026, 8, 16, 15, 4));
    expect(screenshotFilename('BTCUSDT', '15m', at)).toBe('axis-BTCUSDT-15m-20260916-1504.png');
  });

  it('sanitizes odd symbols', () => {
    expect(screenshotFilename('ETH/USDT', '1h', new Date(Date.UTC(2026, 0, 1)))).toBe(
      'axis-ETH_USDT-1h-20260101-0000.png',
    );
  });
});

describe('watermarkText', () => {
  it('joins AXIS, symbol, interval, venue, scripts, UTC time', () => {
    const text = watermarkText({
      symbol: 'BTCUSDT',
      interval: '15m',
      venue: 'binance',
      scriptNames: ['RSI', 'MACD'],
      at: new Date(Date.UTC(2026, 8, 16, 12, 0)),
    });
    expect(text).toContain('AXIS');
    expect(text).toContain('BTCUSDT');
    expect(text).toContain('15m');
    expect(text).toContain('binance');
    expect(text).toContain('RSI');
    expect(text).toContain('2026-09-16 12:00 UTC');
  });
});

describe('stackLayout', () => {
  it('stacks pane sizes with a 2px gap', () => {
    const layout = stackLayout(
      [
        { width: 800, height: 400 },
        { width: 800, height: 120 },
      ],
      2,
    );
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(522);
    expect(layout.offsets).toEqual([0, 402]);
  });

  it('uses the widest pane', () => {
    const layout = stackLayout([
      { width: 400, height: 100 },
      { width: 640, height: 80 },
    ]);
    expect(layout.width).toBe(640);
  });
});

describe('screenshotCrop (shared chart)', () => {
  // A 4-pane v1 chart: price 400, volume 40, MACD 80, Stoch 120, time axis 24.
  const plan: SharedChartPlan = {
    width: 800,
    height: 664,
    panes: [
      { id: 'price', top: 0, height: 400 },
      { id: 'volume', top: 400, height: 40 },
      { id: 'ind_macd', top: 440, height: 80 },
      { id: 'ind_stoch', top: 520, height: 120 },
    ],
    timeAxis: { top: 640, height: 24 },
  };

  it('keeps the whole stack for the panes scope', () => {
    // One chart-level capture already contains every pane — cropping to the
    // full canvas is what stops the old per-pane loop from stacking N copies.
    expect(screenshotCrop(plan, 'panes', 1328)).toEqual({
      top: 0,
      height: 1328,
      timeAxisTop: 1280,
      timeAxisHeight: 48,
    });
  });

  it('crops to the price pane and re-attaches the time axis', () => {
    expect(screenshotCrop(plan, 'price', 1328)).toEqual({
      top: 0,
      height: 800,
      timeAxisTop: 1280,
      timeAxisHeight: 48,
    });
  });

  it('maps CSS pane heights onto the screenshot at any ratio', () => {
    // scale 1: the canvas is the CSS size, so the boxes are unchanged.
    expect(screenshotCrop(plan, 'price', 664)).toEqual({
      top: 0,
      height: 400,
      timeAxisTop: 640,
      timeAxisHeight: 24,
    });
  });

  it('returns null without a measurable plan', () => {
    expect(screenshotCrop({ ...plan, panes: [] }, 'panes', 664)).toBeNull();
    expect(screenshotCrop(plan, 'panes', 0)).toBeNull();
    expect(screenshotCrop({ ...plan, height: 0 }, 'panes', 664)).toBeNull();
  });
});

describe('captureScreenshot (v1 shared chart)', () => {
  // Regression: `chart.takeScreenshot()` is chart-level, and every logical pane
  // is a facade over the *same* LWC chart. The old per-pane loop captured the
  // whole chart once per pane and stacked the copies — a 4-pane chart produced
  // a PNG with the chart repeated 4 times.
  it('captures the shared chart once instead of stacking one copy per pane', async () => {
    let calls = 0;
    const shot = {
      width: 800,
      height: 600,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const paneIds = ['price', 'volume', 'ind_macd', 'ind_stoch'];
    const panes = paneIds.map((id) => ({
      id,
      type: id === 'price' ? 'price' : id === 'volume' ? 'volume' : 'indicator',
      visible: true,
      chart: {
        takeScreenshot: () => {
          calls += 1;
          return shot;
        },
      },
    }));
    const manager = {
      getAllPanes: () => panes,
      getPane: (id: string) => panes.find((p) => p.id === id),
      screenshotPlan: () => ({
        width: 800,
        height: 600,
        panes: [
          { id: 'price', top: 0, height: 400 },
          { id: 'volume', top: 400, height: 40 },
          { id: 'ind_macd', top: 440, height: 80 },
          { id: 'ind_stoch', top: 520, height: 60 },
        ],
        timeAxis: { top: 580, height: 20 },
      }),
    };
    setSlotManager(SLOT, manager as never);
    setActiveSlotId(SLOT);

    const canvas = await captureScreenshot({
      scope: 'panes',
      scale: 1,
      includeDrawings: false,
      includeWatermark: false,
    });

    expect(calls).toBe(1);
    expect(canvas).toBe(shot);
    setSlotManager(SLOT, undefined);
    setActiveSlotId(null);
  });
});

describe('screenshot options prefs', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem('pynescript.axis.screenshot');
    } catch {
      /* stub */
    }
  });

  it('defaults to panes / 2x / drawings / watermark', () => {
    expect(loadScreenshotOptions()).toEqual(DEFAULT_SCREENSHOT_OPTIONS);
  });

  it('round-trips saved prefs', () => {
    saveScreenshotOptions({
      scope: 'price',
      scale: 1,
      includeDrawings: false,
      includeWatermark: true,
    });
    expect(loadScreenshotOptions()).toEqual({
      scope: 'price',
      scale: 1,
      includeDrawings: false,
      includeWatermark: true,
    });
  });
});

describe('screenshot commands', () => {
  it('registers capture + copy when handlers are provided', () => {
    const cmds = buildDefaultCommands({
      toggleWatchlist: () => {},
      toggleEditor: () => {},
      toggleResults: () => {},
      toggleLogs: () => {},
      toggleLayers: () => {},
      toggleIndicators: () => {},
      toggleDataView: () => {},
      toggleTheme: () => {},
      setChartGridMode: () => {},
      runScript: () => {},
      focusSymbol: () => {},
      takeScreenshot: () => {},
      copyScreenshot: () => {},
    });
    const ids = new Set(cmds.map((c) => c.id));
    expect(ids.has('action.screenshot')).toBe(true);
    expect(ids.has('action.screenshot-copy')).toBe(true);
  });
});

describe('screenshot icon', () => {
  it('maps to Camera', () => {
    expect(ICON_MAP.screenshot).toBe('Camera');
  });
});
