// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Named chart themes and the bar coloring stored inside each theme.
 */

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  attachBarTheme,
  barTokensEqual,
  barTokensFromState,
  captureCustomTheme,
  defaultChartThemeState,
  detachBarThemeRef,
  hydrateBarColorThemes,
  hydrateChartTheme,
  getPreset,
  hydrateSavedChartThemes,
  resolveTokens,
  syncBarThemeIntoCharts,
  withBarColorTheme,
  withPreset,
  withTokenOverride,
  type BarColorTheme,
} from '../src/theme';

function barTheme(id: string, name: string, up: string): BarColorTheme {
  const state = withBarColorTheme(defaultChartThemeState(), { 'bar.up.color': up }, id);
  return {
    id,
    name,
    tokens: barTokensFromState(state),
    updatedAt: 10,
  };
}

describe('bar coloring inside a chart theme', () => {
  it('replaces bar tokens and keeps the rest of the chart theme', () => {
    const base = withTokenOverride(defaultChartThemeState(), 'chart.bg_color', '#112233');
    const next = withBarColorTheme(base, { 'bar.up.color': '#abcdef', 'bar.down.color': '#fedcba' }, 'bar_mint');
    expect(next.overrides['chart.bg_color']).toBe('#112233');
    expect(next.overrides['bar.up.color']).toBe('#abcdef');
    expect(next.overrides['bar.down.color']).toBe('#fedcba');
    expect(next.barThemeId).toBe('bar_mint');
    expect(next.presetId).toBe('custom');
  });

  it('keeps the bar-coloring link across canvas edits and clears it on a bar edit', () => {
    let state = withBarColorTheme(defaultChartThemeState(), { 'bar.up.color': '#111111' }, 'bar_mint');
    state = withTokenOverride(state, 'chart.bg_color', '#222222');
    expect(state.barThemeId).toBe('bar_mint');
    expect(state.overrides['chart.bg_color']).toBe('#222222');
    state = withTokenOverride(state, 'bar.down.color', '#333333');
    expect(state.barThemeId).toBeNull();
    expect(state.overrides['chart.bg_color']).toBe('#222222');
    expect(state.overrides['bar.up.color']).toBe('#111111');
    expect(state.overrides['bar.down.color']).toBe('#333333');
  });

  it('a saved theme embeds the linked bar coloring', () => {
    const state = withBarColorTheme(
      withTokenOverride(withPreset('obsidian'), 'chart.bg_color', '#101114'),
      { 'bar.up.color': '#3ddc97' },
      'bar_mint',
    );
    const mint: BarColorTheme = {
      id: 'bar_mint',
      name: 'Mint',
      tokens: barTokensFromState(state),
      updatedAt: 1,
    };
    const saved = captureCustomTheme({
      id: 'thm_night',
      name: '  Night   desk  ',
      state,
      barThemes: [mint],
      activeBarThemeId: 'bar_mint',
      now: 50,
    });
    expect(saved.name).toBe('Night desk');
    expect(saved.barTheme.refId).toBe('bar_mint');
    expect(saved.barTheme.name).toBe('Mint');
    expect(saved.theme.barThemeId).toBe('bar_mint');
    expect(saved.theme.overrides['chart.bg_color']).toBe('#101114');
    expect(barTokensEqual(saved.barTheme.tokens, mint.tokens)).toBe(true);
  });

  it('keeps the previous bar-coloring name when the live bars no longer match the library', () => {
    const state = withBarColorTheme(defaultChartThemeState(), { 'bar.up.color': '#999999' }, null);
    const saved = captureCustomTheme({
      id: 'thm_night',
      name: 'Night',
      state,
      barThemes: [barTheme('bar_mint', 'Mint', '#3ddc97')],
      activeBarThemeId: 'bar_mint',
      previousBar: { refId: 'bar_mint', name: 'Mint', tokens: {} },
    });
    expect(saved.barTheme.refId).toBeNull();
    expect(saved.barTheme.name).toBe('Mint');
    expect(saved.barTheme.tokens['bar.up.color']).toBe('#999999');
  });

  it('updating a bar coloring rewrites only themes that use it', () => {
    const mint = barTheme('bar_mint', 'Mint', '#111111');
    const rose = barTheme('bar_rose', 'Rose', '#ff8899');
    const night = captureCustomTheme({
      id: 'thm_night',
      name: 'Night',
      state: withBarColorTheme(defaultChartThemeState(), mint.tokens, mint.id),
      barThemes: [mint],
      activeBarThemeId: mint.id,
    });
    const day = captureCustomTheme({
      id: 'thm_day',
      name: 'Day',
      state: withBarColorTheme(withPreset('porcelain'), rose.tokens, rose.id),
      barThemes: [rose],
      activeBarThemeId: rose.id,
    });
    const edited: BarColorTheme = {
      ...mint,
      name: 'Mint 2',
      tokens: barTheme('bar_mint', 'Mint 2', '#abcdef').tokens,
      updatedAt: 80,
    };
    const synced = syncBarThemeIntoCharts([night, day], edited);
    expect(synced[0]?.barTheme.name).toBe('Mint 2');
    expect(synced[0]?.barTheme.tokens['bar.up.color']).toBe('#abcdef');
    expect(synced[0]?.theme.overrides['bar.up.color']).toBe('#abcdef');
    expect(synced[1]?.barTheme.refId).toBe('bar_rose');
    expect(synced[1]?.barTheme.tokens['bar.up.color']).toBe('#ff8899');

    const attached = attachBarTheme(day, edited);
    expect(attached.barTheme.refId).toBe('bar_mint');
    expect(attached.theme.base).toBe('light');
    expect(attached.barTheme.tokens['bar.up.color']).toBe('#abcdef');
    expect(resolveTokens(attached.theme)['chart.bg_color']).toBe(
      getPreset('porcelain').tokens['chart.bg_color'],
    );

    const detached = detachBarThemeRef(synced, 'bar_mint');
    expect(detached[0]?.barTheme.refId).toBeNull();
    expect(detached[0]?.barTheme.tokens['bar.up.color']).toBe('#abcdef');
    expect(detached[0]?.theme.barThemeId).toBeNull();
    expect(detached[1]?.barTheme.refId).toBe('bar_rose');
  });

  it('hydrates partial libraries and drops junk', () => {
    expect(hydrateBarColorThemes(null)).toEqual([]);
    expect(hydrateSavedChartThemes([{ id: '', name: 'Nope' }])).toEqual([]);
    const bars = hydrateBarColorThemes([
      { id: 'bar_mint', name: 'Mint', tokens: { 'bar.up.color': '#abcdef', 'nope': 1 }, updatedAt: 3 },
      { id: 'bar_mint', name: 'Duplicate id', tokens: {} },
      { id: 'bar_dup', name: 'Mint', tokens: {} },
      'bad',
    ]);
    expect(bars).toHaveLength(1);
    expect(bars[0]?.tokens['bar.up.color']).toBe('#abcdef');
    expect(bars[0]?.tokens['bar.down.color']).toBeTruthy();

    const themes = hydrateSavedChartThemes([
      {
        id: 'thm_night',
        name: 'Night',
        theme: { presetId: 'void-dark', base: 'dark', overrides: { 'chart.bg_color': '#010101' } },
        updatedAt: 4,
      },
    ]);
    expect(themes).toHaveLength(1);
    expect(themes[0]?.theme.overrides['chart.bg_color']).toBe('#010101');
    expect(themes[0]?.barTheme.name).toBe('Night bars');
    expect(themes[0]?.barTheme.refId).toBeNull();
    expect(hydrateChartTheme(themes[0]?.theme).presetId).toBe('void-dark');
  });
});
