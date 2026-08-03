/**
 * Copyright (c) 2026 HOOX · AXIS · jango-blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Solid store mutators + localStorage persist/hydrate.
 * Guards setActivePlugin, logs, lastRun, and persist round-trip on AXIS key.
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import { reconcile } from 'solid-js/store';
import {
  store,
  setStore,
  persist,
  flushPersist,
  flushPersistIfPending,
  isPersistPending,
  isPersistQuotaExceeded,
  resetPersistQuotaFlag,
  isQuotaExceededError,
  parsePersistedState,
  loadRawState,
  setActivePlugin,
  appendLog,
  clearLogs,
  setLastRun,
  setStatus,
  setProfilerEnabled,
  toggleProfilerEnabled,
  setDebugPinsEnabled,
  toggleDebugPinsEnabled,
  loadBars,
  addIndicator,
  removeIndicator,
  toggleIndicator,
  setIndicatorColor,
  setIndicatorSeries,
  addPane,
  removePane,
  resizePane,
  reorderPanes,
  appendBar,
  noteTick,
  recordRunLatency,
  setLive,
  toggleTheme,
  resetUiLayout,
  setChartGridMode,
  saveChartLayout,
  loadChartLayout,
  setActiveChartSlot,
  setEditorWidth,
  setPanelDock,
  setPanelOpen,
  getPanelChrome,
  setWatchlistWidth,
  setIndicatorWidth,
  setEditorOpen,
  setEditorMode,
  setWatchlistOpen,
  setIndicatorPanelOpen,
  toggleIndicatorPanel,
  addWatchlistSymbol,
  removeWatchlistSymbol,
  setWatchlistRefreshSec,
  saveEditorDoc,
  loadEditorDoc,
  setDrawingTool,
  setDrawings,
  clearDrawings,
  deleteSelectedDrawing,
  STORAGE_KEY,
  LEGACY_STORAGE_KEYS,
  EDITOR_DOC_KEY,
  clampHistoryBars,
  HISTORY_BARS_DEFAULT,
  HISTORY_BARS_MIN,
  HISTORY_BARS_MAX,
} from '../src/store';
import { SAMPLE_BARS, makeBars } from './fixtures/bars';

function resetStoreBasics() {
  clearLogs();
  setStore('bars', []);
  setStore('scripts', []);
  setStore('panes', [
    { id: 'price', type: 'price', height: 0, order: 0, visible: true, label: 'Price' },
    { id: 'volume', type: 'volume', height: 120, order: 1, visible: true, label: 'Volume' },
  ]);
  setStore('symbol', 'BTCUSDT');
  setStore('interval', '1d');
  setStore('exchange', 'binance');
  setStore('source', 'binance-rest');
  setStore('engine', 'server');
  setStore('activePlugins', {
    source: 'binance-rest',
    stream: 'binance-ws',
    engine: 'server',
    storage: 'local',
  });
  setStore('live', { active: false, needsRerun: false, lastBarTime: 0, streamId: 'binance-ws' });
  setStore('theme', 'dark');
  setStore('editor', { open: true, width: 460, mode: 'docked' });
  setStore('watchlist', {
    open: true,
    width: 200,
    symbols: ['BTCUSDT'],
    refreshSec: 15,
  });
  setStore('status', 'ready');
  setStore('statusMessage', 'Ready.');
  setStore('lastRun', null);
  setStore('lastRunMs', null);
  setStore('drawingTool', 'cursor');
  setStore('drawings', []);
  localStorage.removeItem(STORAGE_KEY);
}

beforeEach(() => {
  resetStoreBasics();
  resetPersistQuotaFlag();
});

describe('setActivePlugin', () => {
  it('syncs flat fields for source/engine/stream', () => {
    setActivePlugin('source', 'mock-walk');
    expect(store.source).toBe('mock-walk');
    expect(store.activePlugins.source).toBe('mock-walk');

    setActivePlugin('engine', 'pyodide');
    expect(store.engine).toBe('pyodide');
    expect(store.activePlugins.engine).toBe('pyodide');

    setActivePlugin('stream', 'mock-poll');
    expect(store.live.streamId).toBe('mock-poll');
    expect(store.activePlugins.stream).toBe('mock-poll');

    setActivePlugin('storage', 'cloud');
    expect(store.activePlugins.storage).toBe('cloud');
  });
});

describe('logs and status', () => {
  it('appendLog and clearLogs', () => {
    appendLog('info', 'hello', 'test');
    expect(store.logs.length).toBeGreaterThanOrEqual(1);
    expect(store.logs[store.logs.length - 1].message).toBe('hello');
    clearLogs();
    expect(store.logs).toEqual([]);
  });

  it('setStatus writes message and logs', () => {
    clearLogs();
    setStatus('error', 'boom');
    expect(store.status).toBe('error');
    expect(store.statusMessage).toBe('boom');
    expect(store.logs.some((l) => l.message === 'boom')).toBe(true);
  });

  it('setLastRun captures meta.ms', () => {
    setLastRun({ status: 'success', plots: [], events: [], meta: { ms: 42.5 } });
    expect(store.lastRunMs).toBe(42.5);
  });
});

describe('profilerEnabled', () => {
  it('setProfilerEnabled and toggleProfilerEnabled', () => {
    setProfilerEnabled(false);
    expect(store.profilerEnabled).toBe(false);
    setProfilerEnabled(true);
    expect(store.profilerEnabled).toBe(true);
    toggleProfilerEnabled();
    expect(store.profilerEnabled).toBe(false);
    toggleProfilerEnabled();
    expect(store.profilerEnabled).toBe(true);
  });

  it('persists profilerEnabled flag', async () => {
    setProfilerEnabled(true);
    flushPersist();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.profilerEnabled).toBe(true);
  });
});

describe('debugPinsEnabled', () => {
  it('setDebugPinsEnabled and toggleDebugPinsEnabled', () => {
    setDebugPinsEnabled(false);
    expect(store.debugPinsEnabled).toBe(false);
    setDebugPinsEnabled(true);
    expect(store.debugPinsEnabled).toBe(true);
    toggleDebugPinsEnabled();
    expect(store.debugPinsEnabled).toBe(false);
    toggleDebugPinsEnabled();
    expect(store.debugPinsEnabled).toBe(true);
  });

  it('persists debugPinsEnabled flag', () => {
    setDebugPinsEnabled(true);
    flushPersist();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).debugPinsEnabled).toBe(true);
  });
});

describe('telemetry', () => {
  it('loadBars bumps chartDataGen without changing on appendBar', () => {
    const g0 = store.chartDataGen;
    loadBars(SAMPLE_BARS, 'ETHUSDT', '1h', 'binance');
    expect(store.chartDataGen).toBe(g0 + 1);
    const g1 = store.chartDataGen;
    appendBar({ time: 9_999_999, open: 1, high: 1, low: 1, close: 1 });
    expect(store.chartDataGen).toBe(g1);
  });

  it('noteTick and recordRunLatency update telemetry', () => {
    noteTick(100, 1);
    expect(store.telemetry.lastTick?.price).toBe(100);
    noteTick(101, 2);
    expect(store.telemetry.lastTick?.dir).toBe('up');
    recordRunLatency(55);
    expect(store.telemetry.engine.latencyMs).toBe(55);
    expect(store.telemetry.runLatencySamples.at(-1)).toBe(55);
  });
});

describe('bars and indicators', () => {
  it('loadBars sets symbol/interval/exchange', () => {
    loadBars(SAMPLE_BARS, 'ETHUSDT', '1h', 'binance');
    expect(store.bars).toHaveLength(SAMPLE_BARS.length);
    expect(store.symbol).toBe('ETHUSDT');
    expect(store.interval).toBe('1h');
  });

  it('appendBar updates same time then appends new', () => {
    loadBars(SAMPLE_BARS, 'BTCUSDT', '1d', 'binance');
    const last = store.bars[store.bars.length - 1];
    appendBar({ ...last, close: 999 });
    expect(store.bars[store.bars.length - 1].close).toBe(999);
    expect(store.live.needsRerun).toBe(true);

    appendBar({
      time: last.time + 100,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
    });
    expect(store.bars[store.bars.length - 1].time).toBe(last.time + 100);
  });

  it('indicator CRUD', () => {
    const id = addIndicator('RSI', 'plot(1)', 'price', { RSI: { color: '#f00' } });
    expect(store.scripts.some((s) => s.id === id)).toBe(true);
    toggleIndicator(id);
    expect(store.scripts.find((s) => s.id === id)?.visible).toBe(false);
    setIndicatorColor(id, 'RSI', '#0f0');
    expect(store.scripts.find((s) => s.id === id)?.plots.RSI.color).toBe('#0f0');
    removeIndicator(id);
    expect(store.scripts.some((s) => s.id === id)).toBe(false);
  });
});

describe('panes', () => {
  it('add/remove/resize/reorder', () => {
    const id = addPane('indicator', 'Ind');
    expect(store.panes.some((p) => p.id === id)).toBe(true);
    resizePane(id, 200);
    expect(store.panes.find((p) => p.id === id)?.height).toBe(200);
    const ids = store.panes.map((p) => p.id).reverse();
    reorderPanes(ids);
    expect(store.panes[0].id).toBe(ids[0]);
    removePane(id);
    expect(store.panes.some((p) => p.id === id)).toBe(false);
  });
});

describe('layout helpers', () => {
  it('clamps widths and toggles editor/watchlist', () => {
    setEditorWidth(100);
    expect(store.editor.width).toBe(100);
    setEditorWidth(0);
    expect(store.editor.width).toBe(1);
    setEditorWidth(99999);
    expect(store.editor.width).toBeLessThanOrEqual(Math.floor(1280 * 0.9));

    setWatchlistWidth(50);
    expect(store.watchlist.width).toBe(50);
    setWatchlistWidth(0);
    expect(store.watchlist.width).toBe(1);
    setIndicatorWidth(50);
    expect(store.indicatorPanel.width).toBe(50);
    setIndicatorWidth(0);
    expect(store.indicatorPanel.width).toBe(1);

    setEditorOpen(false);
    expect(store.editor.open).toBe(false);
    setEditorMode('popout');
    expect(store.editor.mode).toBe('popout');
    expect(store.editor.open).toBe(false);
    setWatchlistOpen(false);
    expect(store.watchlist.open).toBe(false);

    setIndicatorPanelOpen(false);
    expect(store.indicatorPanel.open).toBe(false);
    toggleIndicatorPanel();
    expect(store.indicatorPanel.open).toBe(true);
    toggleIndicatorPanel();
    expect(store.indicatorPanel.open).toBe(false);
  });

  it('watchlist symbols and refresh clamp', () => {
    addWatchlistSymbol('ethusdt');
    expect(store.watchlist.symbols).toContain('ETHUSDT');
    addWatchlistSymbol('ETHUSDT'); // no-op duplicate
    removeWatchlistSymbol('ETHUSDT');
    expect(store.watchlist.symbols).not.toContain('ETHUSDT');

    setWatchlistRefreshSec(1);
    expect(store.watchlist.refreshSec).toBe(5);
    setWatchlistRefreshSec(999);
    expect(store.watchlist.refreshSec).toBe(120);
  });

  it('theme toggle', () => {
    const before = store.theme;
    toggleTheme();
    expect(store.theme).not.toBe(before);
    toggleTheme();
    expect(store.theme).toBe(before);
  });

  it('chart grid mode and saved layouts', () => {
    setChartGridMode('2h');
    expect(store.chartLayout.mode).toBe('2h');
    expect(store.chartLayout.slots.length).toBe(2);
    const second = store.chartLayout.slots[1]!;
    setActiveChartSlot(second.id);
    expect(store.chartLayout.activeId).toBe(second.id);
    expect(store.symbol).toBe(second.symbol);

    const snap = saveChartLayout('Test 2H');
    expect(store.savedLayouts.some((l) => l.id === snap.id)).toBe(true);

    setChartGridMode('1');
    expect(store.chartLayout.slots.length).toBe(1);
    expect(loadChartLayout(snap.id)).toBe(true);
    expect(store.chartLayout.mode).toBe('2h');
    expect(store.chartLayout.slots.length).toBe(2);
  });

  it('resetUiLayout restores docks and scale without clearing market data', () => {
    setStore('symbol', 'ETHUSDT');
    setStore('uiScale', 1.2);
    setStore('editor', 'width', 320);
    setPanelDock('editor', 'left');
    setPanelOpen('layers', true);
    setPanelDock('layers', 'left');
    setStore('watchlist', 'symbols', ['BTCUSDT', 'CUSTOMUSDT']);

    resetUiLayout();

    expect(store.symbol).toBe('ETHUSDT');
    expect(store.uiScale).toBe(1);
    expect(store.editor.open).toBe(true);
    expect(store.editor.width).toBe(460);
    expect(store.editor.mode).toBe('docked');
    expect(getPanelChrome('editor').dock).toBe('right');
    expect(getPanelChrome('watchlist').dock).toBe('left');
    expect(getPanelChrome('layers').open).toBe(false);
    expect(store.watchlist.symbols).toContain('CUSTOMUSDT');
    expect(store.drawingTool).toBe('cursor');
  });

  it('setLive', () => {
    setLive(true);
    expect(store.live.active).toBe(true);
  });
});

describe('historyBars', () => {
  it('clampHistoryBars enforces bounds', () => {
    expect(clampHistoryBars(undefined)).toBe(HISTORY_BARS_DEFAULT);
    expect(clampHistoryBars(10)).toBe(HISTORY_BARS_MIN);
    expect(clampHistoryBars(99999)).toBe(HISTORY_BARS_MAX);
    expect(clampHistoryBars(750.6)).toBe(751);
  });

  it('persists historyBars', () => {
    setStore('historyBars', clampHistoryBars(1000));
    flushPersist();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.historyBars).toBe(1000);
  });
});

describe('editor doc + drawings', () => {
  it('save/load editor doc', () => {
    saveEditorDoc('plot(close)');
    expect(loadEditorDoc()).toBe('plot(close)');
    expect(localStorage.getItem(EDITOR_DOC_KEY)).toBe('plot(close)');
  });

  it('drawings set/clear/delete', () => {
    setDrawingTool('trend');
    expect(store.drawingTool).toBe('trend');
    const d = [{ id: 'd1' }] as never[];
    setDrawings(d);
    expect(store.drawings).toHaveLength(1);
    deleteSelectedDrawing([]);
    expect(store.drawings).toEqual([]);
    setDrawings(d);
    clearDrawings();
    expect(store.drawings).toEqual([]);
  });
});

describe('persist', () => {
  it('writes AXIS key without bars/logs/lastRun', async () => {
    loadBars(makeBars(3), 'BTCUSDT', '1d', 'binance');
    appendLog('info', 'x');
    setLastRun({ status: 'success', plots: [], events: [] });
    setStore('symbol', 'SOLUSDT');
    persist();
    await new Promise((r) => setTimeout(r, 250));
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.symbol).toBe('SOLUSDT');
    expect(parsed.bars).toBeUndefined();
    expect(parsed.logs).toBeUndefined();
    expect(parsed.lastRun).toBeUndefined();
  });

  it('never persists bars, lastRun, logs, indicatorSeries, chartDataGen, selectedDrawingId', () => {
    loadBars(makeBars(5), 'BTCUSDT', '1d', 'binance');
    appendLog('error', 'ephemeral log');
    setLastRun({ status: 'success', plots: [{ name: 'x' }], events: [] });
    setIndicatorSeries('ind1', {
      name: 'RSI',
      series: { RSI: [1, 2, 3] },
    });
    setStore('selectedDrawingId', 'draw-1');
    setStore('chartDataGen', 99);
    setStore('crosshair', { time: 123, barIndex: 4 });
    setStore('scriptSettings', { open: true, indicatorId: 'ind1' });

    expect(flushPersist()).toBe(true);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);

    expect(parsed.bars).toBeUndefined();
    expect(parsed.lastRun).toBeUndefined();
    expect(parsed.logs).toBeUndefined();
    expect(parsed.indicatorSeries).toBeUndefined();
    expect(parsed.chartDataGen).toBeUndefined();
    expect(parsed.selectedDrawingId).toBeUndefined();
    expect(parsed.crosshair).toBeUndefined();
    expect(parsed.scriptSettings).toBeUndefined();
    // Only HUD layout from telemetry
    expect(parsed.telemetry?.source).toBeUndefined();
    expect(parsed.telemetry?.hud).toBeDefined();
    // In-memory still holds ephemeral data
    expect(store.bars.length).toBe(5);
    expect(store.logs.length).toBeGreaterThan(0);
    expect(store.lastRun).toBeTruthy();
  });

  it('flushPersist writes immediately (settings save path)', () => {
    setStore('endpoint', 'http://127.0.0.1:5002');
    setStore('interval', '15m');
    setStore('uiScale', 1.15);
    setStore('live', 'rerunOn', 'bar-close');
    setStore(
      'pluginsConfig',
      'engine:server',
      reconcile({
        endpoint: 'http://127.0.0.1:5002',
        mode: 'compile',
        preferWs: true,
      }),
    );
    expect(flushPersist()).toBe(true);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.endpoint).toBe('http://127.0.0.1:5002');
    expect(parsed.interval).toBe('15m');
    expect(parsed.uiScale).toBe(1.15);
    expect(parsed.live.rerunOn).toBe('bar-close');
    expect(parsed.pluginsConfig['engine:server']).toEqual({
      endpoint: 'http://127.0.0.1:5002',
      mode: 'compile',
      preferWs: true,
    });
  });

  it('settings-like batch keeps mode when overwriting engine config', () => {
    setStore('pluginsConfig', 'engine:server', {
      endpoint: 'http://old:5002',
      mode: 'interpret',
      preferWs: false,
      stale: true,
    });
    // Mimic SettingsDialog: snapshot then write mode=compile via reconcile replace
    const nextMode = 'compile';
    const nextEndpoint = 'http://127.0.0.1:5002';
    setStore('endpoint', nextEndpoint);
    setStore(
      'pluginsConfig',
      'engine:server',
      reconcile({
        endpoint: nextEndpoint,
        mode: nextMode,
        preferWs: true,
      }),
    );
    flushPersist();
    const cfg = store.pluginsConfig['engine:server'];
    expect(cfg.mode).toBe('compile');
    expect(cfg.endpoint).toBe('http://127.0.0.1:5002');
    expect(cfg.preferWs).toBe(true);
    expect(cfg.stale).toBeUndefined();
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.pluginsConfig['engine:server'].mode).toBe('compile');
  });

  it('flushPersistIfPending only writes when debounce is pending', async () => {
    setStore('symbol', 'PENDING1');
    expect(isPersistPending()).toBe(false);
    expect(flushPersistIfPending()).toBe(false);

    persist();
    expect(isPersistPending()).toBe(true);
    expect(flushPersistIfPending()).toBe(true);
    expect(isPersistPending()).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).symbol).toBe('PENDING1');

    // Second call with nothing pending is a no-op
    setStore('symbol', 'PENDING2');
    expect(flushPersistIfPending()).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).symbol).toBe('PENDING1');
  });
});

describe('parsePersistedState / corrupt hydrate', () => {
  it('returns null on corrupt JSON without throwing', () => {
    expect(() => parsePersistedState('{not json')).not.toThrow();
    expect(parsePersistedState('{not json')).toBeNull();
    expect(parsePersistedState('')).toBeNull();
    expect(parsePersistedState('null')).toBeNull();
    expect(parsePersistedState('[]')).toBeNull();
    expect(parsePersistedState('"string"')).toBeNull();
    expect(parsePersistedState('42')).toBeNull();
  });

  it('strips ephemeral fields even if present in the blob', () => {
    const raw = JSON.stringify({
      symbol: 'ETHUSDT',
      bars: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }],
      lastRun: { status: 'success' },
      logs: [{ id: '1', message: 'x' }],
      live: { active: true, streamId: 'mock-poll' },
      selectedDrawingId: 'd1',
      indicatorSeries: { a: {} },
      chartDataGen: 9,
      telemetry: {
        source: { id: 'x', state: 'open' },
        hud: { compact: true, overlay: false },
      },
    });
    const overlay = parsePersistedState(raw);
    expect(overlay).toBeTruthy();
    expect(overlay!.symbol).toBe('ETHUSDT');
    expect(overlay!.bars).toEqual([]);
    expect(overlay!.lastRun).toBeNull();
    expect(overlay!.logs).toEqual([]);
    expect(overlay!.live?.active).toBe(false);
    expect(overlay!.live?.streamId).toBe('mock-poll');
    expect(overlay!.selectedDrawingId).toBeNull();
    expect(overlay!.indicatorSeries).toEqual({});
    expect(overlay!.chartDataGen).toBe(0);
    expect(overlay!.telemetry?.hud?.compact).toBe(true);
    // Full plane telemetry is not restored from disk
    expect(overlay!.telemetry?.source?.state).not.toBe('open');
  });

  it('loadRawState write-forwards v2 → v1', () => {
    localStorage.removeItem(STORAGE_KEY);
    const legacyKey = LEGACY_STORAGE_KEYS[0];
    const blob = JSON.stringify({ symbol: 'DOGEUSDT', engine: 'pyodide' });
    localStorage.setItem(legacyKey, blob);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const raw = loadRawState();
    expect(raw).toBe(blob);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(blob);
  });

  it('parsePersistedState accepts a v2-shaped payload', () => {
    const overlay = parsePersistedState(
      JSON.stringify({
        symbol: 'SOLUSDT',
        interval: '4h',
        engine: 'pyodide',
        activePlugins: { engine: 'pyodide', source: 'mock-walk' },
      }),
    );
    expect(overlay?.symbol).toBe('SOLUSDT');
    expect(overlay?.interval).toBe('4h');
    expect(overlay?.activePlugins?.engine).toBe('pyodide');
    expect(overlay?.engine).toBe('pyodide');
  });
});

describe('QuotaExceededError handling', () => {
  it('isQuotaExceededError recognizes common shapes', () => {
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError({ code: 1014 })).toBe(true);
    expect(isQuotaExceededError({ message: 'Quota exceeded' })).toBe(true);
    expect(isQuotaExceededError({ name: 'TypeError' })).toBe(false);
  });

  it('flushPersist returns false and never throws when setItem always fails', () => {
    const orig = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => {
      const err = new DOMException('quota', 'QuotaExceededError');
      throw err;
    };
    try {
      setStore('symbol', 'QUOTA1');
      expect(() => flushPersist()).not.toThrow();
      expect(flushPersist()).toBe(false);
      expect(isPersistQuotaExceeded()).toBe(true);
      // App state still works in memory
      expect(store.symbol).toBe('QUOTA1');
    } finally {
      localStorage.setItem = orig;
    }
  });

  it('flushPersist retries slim payload after quota on full write', () => {
    const orig = localStorage.setItem.bind(localStorage);
    let calls = 0;
    localStorage.setItem = (key: string, value: string) => {
      calls++;
      // Fail full payloads that include drawings; allow slim (empty drawings)
      if (calls <= 2) {
        // 1st full + 2nd full after legacy cleanup
        const err = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        throw err;
      }
      orig(key, value);
    };
    try {
      setDrawings([{ id: 'd-heavy' }] as never[]);
      setStore('symbol', 'SLIMOK');
      const ok = flushPersist();
      expect(ok).toBe(true);
      expect(isPersistQuotaExceeded()).toBe(true);
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(parsed.symbol).toBe('SLIMOK');
      expect(parsed.drawings).toEqual([]);
      // In-memory drawings preserved
      expect(store.drawings).toHaveLength(1);
    } finally {
      localStorage.setItem = orig;
    }
  });
});
