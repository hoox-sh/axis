/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Chart script reapply + persist sanitize + detach owner isolation.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import './setup';
import {
  store,
  setStore,
  addIndicator,
  sanitizePersistedScripts,
  flushPersist,
  STORAGE_KEY,
} from '../src/store';
import { listReapplicableScripts } from '../src/indicators/reapply';
import { detachIndicatorFromChart } from '../src/indicators/detach';
import { setScriptChartVisible, toggleScriptChartVisible } from '../src/indicators/visibility';
import { setManager, setDrawingLayer } from '../src/chart/manager-access';
import {
  ownedOverlayPrefix,
  sanitizeOverlayOwnerId,
} from '../src/chart/pane-manager';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';
import { _resetMultiplexForTests } from '../src/streams/multiplex';

describe('sanitizePersistedScripts', () => {
  it('keeps scripts with id + code and drops empty shells', () => {
    const out = sanitizePersistedScripts([
      { id: 'a', name: 'RSI', code: 'plot(1)', paneId: 'ind_a', visible: true, plots: {} },
      { id: 'b', name: 'Empty', code: '   ', paneId: 'price', plots: {} },
      { id: '', name: 'No id', code: 'plot(2)', paneId: 'price', plots: {} },
      null,
      { id: 'a', name: 'Dup', code: 'plot(3)', paneId: 'price', plots: {} },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('a');
    expect(out[0]!.code).toContain('plot');
    expect(out[0]!.paneId).toBe('ind_a');
  });

  it('preserves inputValues and strategyProps', () => {
    const out = sanitizePersistedScripts([
      {
        id: 'x',
        name: 'S',
        code: 'strategy("s")',
        paneId: 'price',
        visible: true,
        plots: { eq: { color: '#fff' } },
        inputValues: { Length: 14 },
        strategyProps: { initial_capital: 10000 },
      },
    ]);
    expect(out[0]!.inputValues).toEqual({ Length: 14 });
    expect(out[0]!.strategyProps).toEqual({ initial_capital: 10000 });
    expect(out[0]!.plots.eq.color).toBe('#fff');
  });
});

describe('listReapplicableScripts', () => {
  beforeEach(() => {
    setStore('scripts', []);
  });

  it('filters visible scripts with code', () => {
    const a = addIndicator('A', 'plot(1)', 'ind_a', {});
    const b = addIndicator('B', '', 'ind_b', {});
    const c = addIndicator('C', 'plot(2)', 'ind_c', {});
    setStore('scripts', (s) =>
      s.map((x) => (x.id === c ? { ...x, visible: false } : x)),
    );
    const list = listReapplicableScripts();
    expect(list.map((x) => x.id)).toEqual([a]);
    void b;
  });

  it('skips library() sources', () => {
    addIndicator(
      'Lib',
      '//@version=6\nlibrary("Helpers")\nexport n() => 1',
      'price',
      {},
    );
    const ind = addIndicator('A', 'indicator("A")\nplot(1)', 'ind_a', {});
    expect(listReapplicableScripts().map((x) => x.id)).toEqual([ind]);
  });
});

describe('setScriptChartVisible', () => {
  let restoreFetch: (() => void) | null = null;

  beforeEach(() => {
    setStore('scripts', []);
    setStore('bars', []);
    setStore('live', { ...store.live, active: false });
    setManager(undefined);
    setDrawingLayer(undefined);
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    setStore('live', { ...store.live, active: false });
    _resetMultiplexForTests();
    setManager(undefined);
    setDrawingLayer(undefined);
  });

  it('hide flips visible off without throwing when no chart manager', () => {
    const id = addIndicator('RSI', 'plot(1)', 'ind_r', {});
    expect(store.scripts.find((s) => s.id === id)?.visible).toBe(true);
    expect(setScriptChartVisible(id, false)).toBe(false);
    expect(store.scripts.find((s) => s.id === id)?.visible).toBe(false);
    expect(toggleScriptChartVisible(id)).toBe(true);
    expect(store.scripts.find((s) => s.id === id)?.visible).toBe(true);
  });

  it('hidden scripts are not in the live reapply list', () => {
    const id = addIndicator('RSI', 'plot(1)', 'ind_r', {});
    setScriptChartVisible(id, false);
    expect(listReapplicableScripts().map((s) => s.id)).not.toContain(id);
  });

  it('hide last visible script clears drawings, fills, barcolor, and markers', () => {
    const owner: string[] = [];
    let drawings = 0;
    let fills = 0;
    let barColors = 0;
    let shapes = 0;
    let trades = 0;
    setManager({
      removeOverlaysForOwner: (pane: string, sid: string) => {
        owner.push(`${pane}:${sid}`);
      },
      clearShapeMarkers: () => {
        shapes += 1;
      },
      clearTradeMarkers: () => {
        trades += 1;
      },
      clearBarColors: () => {
        barColors += 1;
      },
    } as never);
    setDrawingLayer({
      clearScriptDrawings: () => {
        drawings += 1;
      },
      clearPlotFills: () => {
        fills += 1;
      },
    } as never);
    const id = addIndicator('RSI', 'indicator("RSI")\nplot(1)', 'ind_r', {});
    setScriptChartVisible(id, false);
    expect(owner.some((x) => x.endsWith(`:${id}`))).toBe(true);
    expect(drawings).toBe(1);
    expect(fills).toBe(1);
    expect(barColors).toBe(1);
    expect(shapes).toBe(1);
    expect(trades).toBe(1);
  });

  it('hide with another visible script owner-clears fills / barcolor / drawings', () => {
    const fills: string[] = [];
    const barColors: string[] = [];
    const drawings: string[] = [];
    setManager({
      removeOverlaysForOwner: () => {},
      clearShapeMarkers: () => {},
      clearTradeMarkers: () => {},
      clearBarColors: (owner?: string) => {
        barColors.push(owner || '');
      },
    } as never);
    setDrawingLayer({
      clearScriptDrawings: (owner?: string) => {
        drawings.push(owner || '');
      },
      clearPlotFills: (owner?: string) => {
        fills.push(owner || '');
      },
    } as never);
    addIndicator('A', 'indicator("A")\nplot(1)', 'ind_a', {});
    const b = addIndicator('B', 'indicator("B")\nplot(2)', 'ind_b', {});
    setScriptChartVisible(b, false);
    expect(fills).toEqual([b]);
    expect(barColors).toEqual([b]);
    expect(drawings).toEqual([b]);
  });

  it('fallback removeOverlays skips when a sibling shares the pane', () => {
    let wiped = 0;
    setManager({
      removeOverlays: () => {
        wiped += 1;
      },
    } as never);
    const a = addIndicator('A', 'plot(1)', 'price', {});
    addIndicator('B', 'plot(2)', 'price', {});
    setScriptChartVisible(a, false);
    expect(wiped).toBe(0);
  });

  it('fallback removeOverlays wipes pane when no sibling shares it', () => {
    const wiped: string[] = [];
    setManager({
      removeOverlays: (pane: string) => {
        wiped.push(pane);
      },
    } as never);
    const a = addIndicator('A', 'plot(1)', 'ind_a', {});
    addIndicator('B', 'plot(2)', 'price', {});
    setScriptChartVisible(a, false);
    expect(wiped).toEqual(['ind_a']);
  });

  it('hide of exclusive sub-pane destroys the empty oscillator strip', () => {
    const destroyed: string[] = [];
    setManager({
      removeOverlaysForOwner: () => {},
      destroyPane: (id: string) => {
        destroyed.push(id);
      },
    } as never);
    setStore('panes', [
      { id: 'price', type: 'price', height: 400, order: 0, visible: true },
      { id: 'ind_r', type: 'indicator', height: 140, order: 2, visible: true },
    ]);
    const id = addIndicator('RSI', 'indicator("RSI")\nplot(1)', 'ind_r', {});
    setScriptChartVisible(id, false);
    expect(destroyed).toEqual(['ind_r']);
    expect(store.panes.some((p) => p.id === 'ind_r')).toBe(false);
  });

  it('hide still clears overlays for library() sources', () => {
    const owner: string[] = [];
    setManager({
      removeOverlaysForOwner: (_pane: string, sid: string) => {
        owner.push(sid);
      },
    } as never);
    const id = addIndicator(
      'Lib',
      '//@version=6\nlibrary("Helpers")\nexport n() => 1',
      'price',
      {},
    );
    setScriptChartVisible(id, false);
    expect(owner).toContain(id);
  });

  it('show while live only schedules multiplex rerun', async () => {
    let fetches = 0;
    restoreFetch = mockFetch(async () => {
      fetches += 1;
      return jsonResponse({ status: 'success', plots: [], events: [], series: {} });
    });
    setStore('bars', [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    const id = addIndicator('RSI', 'indicator("RSI")\nplot(close)', 'ind_r', {});
    setScriptChartVisible(id, false);
    setStore('live', { ...store.live, active: true });
    expect(setScriptChartVisible(id, true)).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(fetches).toBe(0);
    setStore('live', { ...store.live, active: false });
  });

  it('show does not run library() sources', async () => {
    let fetches = 0;
    restoreFetch = mockFetch(async () => {
      fetches += 1;
      return jsonResponse({ status: 'success', plots: [], events: [], series: {} });
    });
    setStore('bars', [
      { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    const id = addIndicator(
      'Lib',
      '//@version=6\nlibrary("Helpers")\nexport n() => 1',
      'price',
      {},
    );
    setScriptChartVisible(id, false);
    expect(setScriptChartVisible(id, true)).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(fetches).toBe(0);
  });
});

describe('detachIndicatorFromChart', () => {
  beforeEach(() => {
    setStore('scripts', []);
    setStore('panes', [
      { id: 'price', type: 'price', height: 400, order: 0, visible: true },
    ]);
  });

  it('removes script from store without throwing when no manager', () => {
    const id = addIndicator('RSI', 'indicator("RSI")\nplot(1)', 'ind_x', {
      RSI: { color: '#f00' },
    });
    expect(store.scripts.some((s) => s.id === id)).toBe(true);
    detachIndicatorFromChart(id);
    expect(store.scripts.some((s) => s.id === id)).toBe(false);
  });

  it('owner prefix helpers stay stable for multi-script panes', () => {
    const id = 'id_abc';
    expect(sanitizeOverlayOwnerId(id)).toBeTruthy();
    expect(ownedOverlayPrefix(id)).toContain('overlay_');
    expect(ownedOverlayPrefix(id)).toContain('__');
  });
});

describe('persist scripts round-trip shape', () => {
  afterEach(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });

  it('buildPersistPayload includes scripts with code', () => {
    setStore('scripts', []);
    addIndicator('MACD', '//@version=6\nindicator("M")\nplot(close)', 'ind_m', {
      plot: { color: '#0f0' },
    });
    flushPersist();
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const bag = JSON.parse(raw!) as { scripts?: unknown };
    const scripts = sanitizePersistedScripts(bag.scripts);
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    expect(scripts.some((s) => s.code.includes('indicator'))).toBe(true);
  });
});
