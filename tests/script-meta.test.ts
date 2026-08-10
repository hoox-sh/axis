// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  activeChartContext,
  cycleLiveRerunOn,
  detectDeclaredOverlay,
  detectPineVersion,
  detectScriptKind,
  engineFamily,
  engineFamilyLabel,
  formatScriptUpdatedAt,
  isPricePane,
  lastRunStatus,
  liveRerunTitle,
  metaFromScriptContent,
  panePlacementLabel,
  scriptKindLabel,
  scriptKindShort,
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

describe('detectPineVersion / metaFromScriptContent', () => {
  test('reads //@version=N', () => {
    expect(detectPineVersion('//@version=5\nindicator("x")')).toBe('5');
    expect(detectPineVersion('// @version = 6\nstrategy("s")')).toBe('6');
    expect(detectPineVersion('indicator("x")')).toBe(null);
  });

  test('metaFromScriptContent fills kind + version', () => {
    const m = metaFromScriptContent('//@version=5\nstrategy("S")\nplot(close)');
    expect(m.scriptKind).toBe('strategy');
    expect(m.pineVersion).toBe('5');
  });

  test('labels', () => {
    expect(scriptKindLabel('indicator')).toBe('Indicator');
    expect(scriptKindShort('library')).toBe('LIB');
  });

  test('formatScriptUpdatedAt relative', () => {
    const now = 1_700_000_000_000;
    expect(formatScriptUpdatedAt(now - 10_000, now)).toBe('just now');
    expect(formatScriptUpdatedAt(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatScriptUpdatedAt(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatScriptUpdatedAt(undefined, now)).toBe('');
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
