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
import {
  ownedOverlayPrefix,
  sanitizeOverlayOwnerId,
} from '../src/chart/pane-manager';

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
