/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  DEFAULT_SCREENSHOT_OPTIONS,
  loadScreenshotOptions,
  saveScreenshotOptions,
  screenshotFilename,
  stackLayout,
  watermarkText,
} from '../src/chart/screenshot';
import { buildDefaultCommands } from '../src/ui/command-registry';
import { ICON_MAP } from '../src/ui/icon-map';

describe('screenshotFilename', () => {
  it('uses symbol, interval, and UTC stamp', () => {
    const at = new Date(Date.UTC(2026, 8, 16, 15, 4));
    expect(screenshotFilename('BTCUSDT', '15m', at)).toBe(
      'axis-BTCUSDT-15m-20260916-1504.png',
    );
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
