// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layout recipe descriptors (pure) + apply via store helpers.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  LAYOUT_RECIPES,
  MAJOR_SYMBOLS,
  applyLayoutRecipe,
  findLayoutRecipe,
  recipeToLayout,
  resolveRecipeSlots,
} from '../src/chart/layout-recipes.ts';
import { slotCountForMode } from '../src/chart/layout.ts';
import {
  saveChartLayout,
  loadChartLayout,
  setChartGridMode,
  store,
  updateChartSlot,
} from '../src/store/index.ts';

describe('layout recipes (pure)', () => {
  it('exports at least 4 built-in recipes with unique ids', () => {
    expect(LAYOUT_RECIPES.length).toBeGreaterThanOrEqual(4);
    const ids = LAYOUT_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of LAYOUT_RECIPES) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
      expect(['1', '2h', '2v', '4']).toContain(r.mode);
    }
  });

  it('findLayoutRecipe by id', () => {
    expect(findLayoutRecipe('single-focus')?.label).toBe('Single focus');
    expect(findLayoutRecipe('missing')).toBeUndefined();
  });

  it('Single focus resolves one slot from seed', () => {
    const r = findLayoutRecipe('single-focus')!;
    const slots = resolveRecipeSlots(r, {
      symbol: 'ethusdt',
      interval: '4h',
      exchange: 'okx',
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.symbol).toBe('ETHUSDT');
    expect(slots[0]!.interval).toBe('4h');
    expect(slots[0]!.exchange).toBe('okx');
  });

  it('Scalp 1m+5m keeps same symbol on 2v', () => {
    const r = findLayoutRecipe('scalp-1m-5m')!;
    expect(r.mode).toBe('2v');
    const slots = resolveRecipeSlots(r, { symbol: 'SOLUSDT', interval: '1d' });
    expect(slots).toHaveLength(2);
    expect(slots[0]!.symbol).toBe('SOLUSDT');
    expect(slots[1]!.symbol).toBe('SOLUSDT');
    expect(slots[0]!.interval).toBe('1m');
    expect(slots[1]!.interval).toBe('5m');
  });

  it('Swing HTF bias is 1h + 1d same symbol', () => {
    const r = findLayoutRecipe('swing-htf-bias')!;
    expect(r.mode).toBe('2h');
    const slots = resolveRecipeSlots(r, { symbol: 'BTCUSDT' });
    expect(slots.map((s) => s.interval)).toEqual(['1h', '1d']);
    expect(slots.every((s) => s.symbol === 'BTCUSDT')).toBe(true);
  });

  it('Quad watch has 4 cells with interval + symbol variety', () => {
    const r = findLayoutRecipe('quad-watch')!;
    expect(r.mode).toBe('4');
    const slots = resolveRecipeSlots(r, { symbol: 'XRPUSDT', interval: '1m' });
    expect(slots).toHaveLength(4);
    const symbols = slots.map((s) => s.symbol);
    const intervals = slots.map((s) => s.interval);
    expect(new Set(symbols).size).toBeGreaterThan(1);
    expect(new Set(intervals).size).toBeGreaterThan(1);
    // Explicit majors, not seed XRP
    expect(symbols).toContain('BTCUSDT');
    expect(symbols).toContain('ETHUSDT');
  });

  it('BTC majors uses MAJOR_SYMBOLS on shared seed interval', () => {
    const r = findLayoutRecipe('btc-majors')!;
    expect(r.mode).toBe('4');
    const slots = resolveRecipeSlots(r, { interval: '15m', exchange: 'binance' });
    expect(slots.map((s) => s.symbol)).toEqual([...MAJOR_SYMBOLS]);
    expect(slots.every((s) => s.interval === '15m')).toBe(true);
  });

  it('recipeToLayout allocates ids and matches mode cell count', () => {
    for (const recipe of LAYOUT_RECIPES) {
      const L = recipeToLayout(recipe, { symbol: 'BTCUSDT', interval: '1h' });
      expect(L.mode).toBe(recipe.mode);
      expect(L.slots).toHaveLength(slotCountForMode(recipe.mode));
      expect(L.activeId).toBe(L.slots[0]!.id);
      expect(new Set(L.slots.map((s) => s.id)).size).toBe(L.slots.length);
    }
  });

  it('resolve pads short slot lists to mode size', () => {
    const slots = resolveRecipeSlots(
      { id: 'x', label: 'x', hint: 'x', mode: '4', slots: [{ interval: '1m' }] },
      { symbol: 'BTCUSDT', interval: '1d' },
    );
    expect(slots).toHaveLength(4);
    expect(slots[0]!.interval).toBe('1m');
    expect(slots[1]!.interval).toBe('1d');
    expect(slots[1]!.symbol).toBe('BTCUSDT');
  });
});

describe('layout recipes (apply + save/load intact)', () => {
  beforeEach(() => {
    // Reset to a known single chart so applies are deterministic
    setChartGridMode('1');
    const id = store.chartLayout.slots[0]!.id;
    updateChartSlot(id, {
      symbol: 'BTCUSDT',
      interval: '1d',
      exchange: 'binance',
    });
  });

  it('applyLayoutRecipe mutates chartLayout via store helpers', () => {
    const recipe = findLayoutRecipe('scalp-1m-5m')!;
    const resolved = applyLayoutRecipe(recipe, {
      symbol: 'ETHUSDT',
      interval: '1d',
      exchange: 'binance',
    });
    expect(resolved).toHaveLength(2);
    expect(store.chartLayout.mode).toBe('2v');
    expect(store.chartLayout.slots).toHaveLength(2);
    expect(store.chartLayout.slots[0]!.symbol).toBe('ETHUSDT');
    expect(store.chartLayout.slots[0]!.interval).toBe('1m');
    expect(store.chartLayout.slots[1]!.symbol).toBe('ETHUSDT');
    expect(store.chartLayout.slots[1]!.interval).toBe('5m');
    expect(store.chartLayout.activeId).toBe(store.chartLayout.slots[0]!.id);
    expect(store.symbol).toBe('ETHUSDT');
    expect(store.interval).toBe('1m');
  });

  it('apply quad watch sets four distinct majors', () => {
    applyLayoutRecipe(findLayoutRecipe('quad-watch')!, {
      symbol: 'BTCUSDT',
      interval: '1d',
    });
    expect(store.chartLayout.mode).toBe('4');
    expect(store.chartLayout.slots.map((s) => s.symbol)).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'BNBUSDT',
    ]);
    expect(store.chartLayout.slots.map((s) => s.interval)).toEqual([
      '15m',
      '1h',
      '4h',
      '1d',
    ]);
  });

  it('does not break named save/load after a recipe apply', () => {
    applyLayoutRecipe(findLayoutRecipe('swing-htf-bias')!, {
      symbol: 'SOLUSDT',
      interval: '1d',
    });
    const snap = saveChartLayout('recipe-swing-test');
    expect(snap.chartLayout.mode).toBe('2h');

    // Change away, then restore
    applyLayoutRecipe(findLayoutRecipe('single-focus')!, {
      symbol: 'BTCUSDT',
      interval: '1d',
    });
    expect(store.chartLayout.mode).toBe('1');

    expect(loadChartLayout(snap.id)).toBe(true);
    expect(store.chartLayout.mode).toBe('2h');
    expect(store.chartLayout.slots[0]!.interval).toBe('1h');
    expect(store.chartLayout.slots[1]!.interval).toBe('1d');
    expect(store.chartLayout.slots[0]!.symbol).toBe('SOLUSDT');
  });
});
