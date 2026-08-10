// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  activeChartContext,
  cycleLiveRerunOn,
  detectDeclaredOverlay,
  detectScriptKind,
  engineFamily,
  engineFamilyLabel,
  isPricePane,
  lastRunStatus,
  liveRerunTitle,
  panePlacementLabel,
} from '../src/indicators/script-meta';

describe('detectScriptKind', () => {
  test('detects indicator / strategy / library', () => {
    expect(detectScriptKind('//@version=5\nindicator("RSI")\n')).toBe('indicator');
    expect(detectScriptKind('//@version=5\nstrategy("S", overlay=true)\n')).toBe(
      'strategy',
    );
    expect(detectScriptKind('//@version=5\nlibrary("Lib")\n')).toBe('library');
    expect(detectScriptKind('plot(close)')).toBe('unknown');
  });
});

describe('detectDeclaredOverlay', () => {
  test('reads overlay flag', () => {
    expect(detectDeclaredOverlay('indicator("x", overlay=true)')).toBe(true);
    expect(detectDeclaredOverlay('indicator("x", overlay=false)')).toBe(false);
    expect(detectDeclaredOverlay('indicator("x")')).toBe(null);
  });
});

describe('pane / engine / run', () => {
  test('pane helpers', () => {
    expect(isPricePane({ paneId: 'price' })).toBe(true);
    expect(isPricePane({ paneId: 'ind_1' })).toBe(false);
    expect(panePlacementLabel({ paneId: 'price' })).toContain('overlay');
  });

  test('engine family', () => {
    expect(engineFamily('server')).toBe('server');
    expect(engineFamily('pyodide')).toBe('pyodide');
    expect(engineFamily('cf-worker')).toBe('worker');
    expect(engineFamilyLabel('server', 'server')).toMatch(/Server/);
  });

  test('lastRunStatus', () => {
    expect(lastRunStatus(null)).toBe('none');
    expect(lastRunStatus({ status: 'success' })).toBe('ok');
    expect(lastRunStatus({ status: 'error' })).toBe('error');
  });

  test('liveRerunTitle', () => {
    expect(liveRerunTitle(false, 'every-tick')).toMatch(/Live is off/i);
    expect(liveRerunTitle(true, 'bar-close')).toMatch(/bar close/i);
    expect(liveRerunTitle(true, 'every-tick')).toMatch(/every tick/i);
    expect(liveRerunTitle(true, 'every-tick', true)).toMatch(/Click/i);
  });

  test('cycleLiveRerunOn', () => {
    expect(cycleLiveRerunOn('every-tick')).toBe('bar-close');
    expect(cycleLiveRerunOn('bar-close')).toBe('every-tick');
    expect(cycleLiveRerunOn(undefined)).toBe('bar-close');
  });

  test('activeChartContext', () => {
    const one = activeChartContext({
      symbol: 'btcusdt',
      interval: '1h',
      slotCount: 1,
    });
    expect(one.line).toBe('BTCUSDT · 1h');
    const multi = activeChartContext({
      symbol: 'ETHUSDT',
      interval: '15m',
      slotCount: 4,
      activeSlotId: 'a',
    });
    expect(multi.line).toContain('4 charts');
    expect(multi.title).toMatch(/slots/i);
  });
});
