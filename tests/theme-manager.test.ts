// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Theme Manager: catalog, presets, resolve, apply, ThemeManager singleton.
 * Guards Pine host color aliases, token overrides, LWC option builders, DOM bridge.
 */

import './setup';
import { mock, describe, expect, it, beforeEach, afterEach } from 'bun:test';

import {
  TOKEN_ALIASES,
  THEME_TOKEN_DEFS,
  THEME_GROUPS,
  canonicalTokenKey,
  getTokenDef,
  tokensForGroup,
  catalogDefaults,
  pineColorMap,
  PRESET_VOID_DARK,
  PRESET_VOID_LIGHT,
  THEME_PRESETS,
  getPreset,
  listPresets,
  defaultChartThemeState,
  normalizeOverrides,
  coerceTokenValue,
  hydrateChartTheme,
  resolveTokens,
  getToken,
  getColor,
  withTokenOverride,
  withPreset,
  withTokenOverrides,
  resetOverrides,
  themesEqual,
  serializeTheme,
  allTokenKeys,
  applyThemeToDocument,
  buildChartOptionsFromTokens,
  applyThemeToChart,
  buildCandleSeriesOptions,
  buildBarSeriesOptions,
  buildLineSeriesOptions,
  buildAreaSeriesOptions,
  buildBaselineSeriesOptions,
  applyThemeToPriceSeries,
  volumeColors,
  tokensToVoidLike,
  pineHostColors,
  ThemeManager,
  getThemeManager,
} from '../src/theme';
import { resetThemeManagerForTests } from '../src/theme/manager';
import type { ChartThemeState, ThemeTokenDef } from '../src/theme';

function colorDef(key: string): ThemeTokenDef {
  const d = getTokenDef(key);
  if (!d) throw new Error(`missing def ${key}`);
  return d;
}

describe('theme catalog', () => {
  it('catalogDefaults has chart.bg_color and chart.fg_color', () => {
    const d = catalogDefaults();
    expect(d['chart.bg_color']).toMatch(/^#/);
    expect(d['chart.fg_color']).toMatch(/^#/);
    expect(d['chart.bg_color']).toBe(PRESET_VOID_DARK.tokens['chart.bg_color']);
    expect(d['chart.fg_color']).toBe(PRESET_VOID_DARK.tokens['chart.fg_color']);
  });

  it('canonicalTokenKey maps chart.color_background → chart.bg_color', () => {
    expect(canonicalTokenKey('chart.color_background')).toBe('chart.bg_color');
    expect(TOKEN_ALIASES['chart.color_background']).toBe('chart.bg_color');
  });

  it('canonicalTokenKey maps chart.color_foreground → chart.fg_color', () => {
    expect(canonicalTokenKey('chart.color_foreground')).toBe('chart.fg_color');
    expect(TOKEN_ALIASES['chart.color_foreground']).toBe('chart.fg_color');
  });

  it('canonicalTokenKey passes through unknown and trims', () => {
    expect(canonicalTokenKey('  bar.up.color  ')).toBe('bar.up.color');
    expect(canonicalTokenKey('not.a.token')).toBe('not.a.token');
    expect(canonicalTokenKey('')).toBe('');
  });

  it('pineColorMap returns both official and alias keys', () => {
    const tokens = catalogDefaults();
    const map = pineColorMap(tokens);
    expect(map['chart.bg_color']).toBe(String(tokens['chart.bg_color']));
    expect(map['chart.fg_color']).toBe(String(tokens['chart.fg_color']));
    expect(map['chart.color_background']).toBe(map['chart.bg_color']);
    expect(map['chart.color_foreground']).toBe(map['chart.fg_color']);
  });

  it("tokensForGroup('bar') includes body/thin/border tokens", () => {
    const keys = tokensForGroup('bar').map((t) => t.key);
    expect(keys).toContain('bar.up.color');
    expect(keys).toContain('bar.down.color');
    expect(keys).toContain('bar.body_fill');
    expect(keys).toContain('bar.thin_bars');
    expect(keys).toContain('bar.border_visible');
  });

  it('getTokenDef resolves aliases', () => {
    expect(getTokenDef('chart.color_background')?.key).toBe('chart.bg_color');
    expect(getTokenDef('bar.up')?.key).toBe('bar.up.color');
    expect(getTokenDef('nope')).toBeUndefined();
  });
});

describe('theme presets', () => {
  it('listPresets is 10 curated high-end presets', () => {
    const list = listPresets();
    expect(list.length).toBe(10);
    expect(list.length).toBe(THEME_PRESETS.length);
    const ids = list.map((p) => p.id);
    expect(ids).toContain('void-dark');
    expect(ids).toContain('obsidian');
    expect(ids).toContain('porcelain');
    // No neon high-contrast preset
    expect(ids).not.toContain('high-contrast');
  });

  it("getPreset('void-dark') / unknown falls back", () => {
    expect(getPreset('void-dark').id).toBe('void-dark');
    expect(getPreset(undefined).id).toBe('void-dark');
    expect(getPreset(null).id).toBe('void-dark');
    expect(getPreset('does-not-exist').id).toBe('void-dark');
  });

  it('void-light has light base and different bg than void-dark', () => {
    expect(PRESET_VOID_LIGHT.base).toBe('light');
    expect(PRESET_VOID_DARK.base).toBe('dark');
    expect(PRESET_VOID_LIGHT.tokens['chart.bg_color']).not.toBe(
      PRESET_VOID_DARK.tokens['chart.bg_color'],
    );
  });

  it('named presets are unique and fully tokenized', () => {
    const ids = new Set(THEME_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(THEME_PRESETS.length);
    for (const p of THEME_PRESETS) {
      expect(p.tokens['chart.bg_color']).toBeDefined();
      expect(p.tokens['bar.up.color']).toBeDefined();
    }
  });
});

describe('theme resolve', () => {
  it('resolveTokens merges overrides', () => {
    const state: ChartThemeState = {
      presetId: 'void-dark',
      base: 'dark',
      overrides: { 'bar.up.color': '#112233' },
    };
    const t = resolveTokens(state);
    expect(t['bar.up.color']).toBe('#112233');
    expect(t['chart.bg_color']).toBe(catalogDefaults()['chart.bg_color']);
  });

  it("withTokenOverride('chart.color_background') sets chart.bg_color and marks custom", () => {
    const base = defaultChartThemeState();
    const next = withTokenOverride(base, 'chart.color_background', '#112233');
    expect(next.overrides['chart.bg_color']).toBe('#112233');
    expect(next.overrides['chart.color_background']).toBeUndefined();
    expect(next.presetId).toBe('custom');
  });

  it("withPreset('classic') clears overrides", () => {
    const dirty: ChartThemeState = {
      presetId: 'custom',
      base: 'dark',
      overrides: { 'bar.up.color': '#fff' },
    };
    const next = withPreset('classic');
    expect(next.presetId).toBe('classic');
    expect(next.overrides).toEqual({});
    expect(next.base).toBe('dark');
    // ensure dirty state is not mutated by withPreset
    expect(dirty.overrides['bar.up.color']).toBe('#fff');
  });

  it('hydrateChartTheme tolerates null/garbage', () => {
    expect(hydrateChartTheme(null)).toEqual(defaultChartThemeState());
    expect(hydrateChartTheme(undefined)).toEqual(defaultChartThemeState());
    expect(hydrateChartTheme('nope')).toEqual(defaultChartThemeState());
    expect(hydrateChartTheme([])).toEqual(defaultChartThemeState());
    expect(hydrateChartTheme(42)).toEqual(defaultChartThemeState());

    const partial = hydrateChartTheme({
      presetId: 'classic',
      overrides: { 'chart.bg_color': '#010101', 'unknown.x': '#fff' },
    });
    expect(partial.presetId).toBe('classic');
    expect(partial.base).toBe('dark');
    expect(partial.overrides['chart.bg_color']).toBe('#010101');
    expect(partial.overrides['unknown.x']).toBeUndefined();
  });

  it('coerceTokenValue rejects bad colors, clamps numbers', () => {
    const color = colorDef('chart.bg_color');
    expect(coerceTokenValue(color, '#112233')).toBe('#112233');
    expect(coerceTokenValue(color, 'rgb(1,2,3)')).toBe('rgb(1,2,3)');
    expect(coerceTokenValue(color, 'not a color!!!')).toBeUndefined();
    expect(coerceTokenValue(color, 123)).toBeUndefined();
    expect(coerceTokenValue(color, '')).toBeUndefined();
    expect(coerceTokenValue(color, null)).toBeUndefined();

    const num = colorDef('bar.border_width');
    expect(coerceTokenValue(num, 2)).toBe(2);
    expect(coerceTokenValue(num, 99)).toBe(4); // max 4
    expect(coerceTokenValue(num, -3)).toBe(0); // min 0
    expect(coerceTokenValue(num, '2')).toBe(2);
    expect(coerceTokenValue(num, 'nope')).toBeUndefined();
    expect(coerceTokenValue(num, NaN)).toBeUndefined();

    const bool = colorDef('bar.body_fill');
    expect(coerceTokenValue(bool, true)).toBe(true);
    expect(coerceTokenValue(bool, 'false')).toBe(false);
    expect(coerceTokenValue(bool, 1)).toBe(true);
    expect(coerceTokenValue(bool, 'maybe')).toBeUndefined();
  });

  it('normalizeOverrides drops unknown keys', () => {
    const n = normalizeOverrides({
      'bar.up.color': '#abcdef',
      'chart.color_background': '#112233',
      'totally.fake': '#000',
      'bar.body_fill': true, // same as default → dropped
    });
    expect(n['bar.up.color']).toBe('#abcdef');
    expect(n['chart.bg_color']).toBe('#112233');
    expect(n['totally.fake']).toBeUndefined();
    // default-equal boolean skipped
    expect(n['bar.body_fill']).toBeUndefined();
    expect(normalizeOverrides(null)).toEqual({});
    expect(normalizeOverrides([])).toEqual({});
  });

  it('getToken / getColor support aliases', () => {
    const state = defaultChartThemeState();
    expect(getColor(state, 'chart.color_background')).toBe(
      String(catalogDefaults()['chart.bg_color']),
    );
    expect(getToken(state, 'bar.thin_bars')).toBe(true);
  });

  it('withTokenOverrides / resetOverrides / themesEqual / serializeTheme', () => {
    const base = defaultChartThemeState();
    const multi = withTokenOverrides(base, {
      'bar.up.color': '#111111',
      'bar.down.color': '#222222',
    });
    expect(multi.presetId).toBe('custom');
    expect(multi.overrides['bar.up.color']).toBe('#111111');

    const reset = resetOverrides(multi);
    expect(reset.presetId).toBe('void-dark');
    expect(reset.overrides).toEqual({});

    const a = withPreset('mono');
    const b = withPreset('mono');
    expect(themesEqual(a, b)).toBe(true);
    expect(themesEqual(a, multi)).toBe(false);

    const ser = serializeTheme(multi);
    expect(ser.overrides['bar.up.color']).toBe('#111111');
    expect(allTokenKeys().length).toBe(THEME_TOKEN_DEFS.length);
  });
});

describe('theme apply', () => {
  it('buildCandleSeriesOptions has upColor/downColor from tokens', () => {
    const tokens = catalogDefaults();
    const opts = buildCandleSeriesOptions(tokens);
    expect(opts.upColor).toBe(tokens['bar.up.color']);
    expect(opts.downColor).toBe(tokens['bar.down.color']);
    expect(opts.borderVisible).toBe(true);
  });

  it('body_fill false → transparent upColor', () => {
    const tokens = { ...catalogDefaults(), 'bar.body_fill': false };
    const opts = buildCandleSeriesOptions(tokens);
    expect(opts.upColor).toBe('rgba(0,0,0,0)');
    expect(opts.downColor).toBe(tokens['bar.down.color']);
  });

  it('hollow chartType → transparent up body', () => {
    const tokens = catalogDefaults();
    const opts = buildCandleSeriesOptions(tokens, { chartType: 'hollow' });
    expect(opts.upColor).toBe('rgba(0,0,0,0)');
    expect(opts.downColor).toBe(tokens['bar.down.color']);
    expect(opts.borderVisible).toBe(true);
  });

  it('buildBarSeriesOptions respects thin_bars', () => {
    const thin = buildBarSeriesOptions(catalogDefaults());
    expect(thin.thinBars).toBe(true);
    const thick = buildBarSeriesOptions({
      ...catalogDefaults(),
      'bar.thin_bars': false,
    });
    expect(thick.thinBars).toBe(false);
    expect(thick.upColor).toBe(catalogDefaults()['bar.up.color']);
  });

  it('buildChartOptionsFromTokens sets layout.background.color', () => {
    const tokens = catalogDefaults();
    const opts = buildChartOptionsFromTokens(tokens) as {
      layout: { background: { color: string }; textColor: string };
      grid: { vertLines: { visible: boolean } };
    };
    expect(opts.layout.background.color).toBe(String(tokens['chart.bg_color']));
    expect(opts.grid.vertLines.visible).toBe(true);

    const noGrid = buildChartOptionsFromTokens({
      ...tokens,
      'grid.visible': false,
    }) as { grid: { vertLines: { color: string; visible: boolean } } };
    expect(noGrid.grid.vertLines.visible).toBe(false);
    expect(noGrid.grid.vertLines.color).toBe('transparent');
  });

  it('applyThemeToDocument sets data-theme and CSS vars', () => {
    const state = withPreset('void-dark');
    applyThemeToDocument(state);
    const root = document.documentElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.getPropertyValue('--chart-bg')).toBe(
      String(catalogDefaults()['chart.bg_color']),
    );
    expect(root.style.getPropertyValue('--chart-fg')).toBe(
      String(catalogDefaults()['chart.fg_color']),
    );
    expect(root.style.getPropertyValue('--chart-bar-up')).toBe(
      String(catalogDefaults()['bar.up.color']),
    );
    expect(root.dataset.chartBgColor).toBe(String(catalogDefaults()['chart.bg_color']));

    applyThemeToDocument(withPreset('void-light'));
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('pineHostColors returns bg_color, fg_color, color_background, color_foreground', () => {
    const pine = pineHostColors(defaultChartThemeState());
    expect(pine.bg_color).toBe(String(catalogDefaults()['chart.bg_color']));
    expect(pine.fg_color).toBe(String(catalogDefaults()['chart.fg_color']));
    expect(pine.color_background).toBe(pine.bg_color);
    expect(pine.color_foreground).toBe(pine.fg_color);
  });

  it('tokensToVoidLike maps correctly', () => {
    const v = tokensToVoidLike(catalogDefaults());
    expect(v.bg).toBe(String(catalogDefaults()['chart.bg_color']));
    expect(v.panel).toBe(String(catalogDefaults()['chart.panel']));
    expect(v.elev).toBe(String(catalogDefaults()['chart.elev']));
    expect(v.text).toBe(String(catalogDefaults()['chart.fg_color']));
    expect(v.up).toBe(String(catalogDefaults()['bar.up.color']));
    expect(v.down).toBe(String(catalogDefaults()['bar.down.color']));
    expect(v.indigo).toBe(String(catalogDefaults()['ui.accent']));
    expect(v.green).toBe(String(catalogDefaults()['ui.up']));
    expect(v.orange).toBe('#e8a03a');
  });

  it('line / area / baseline / volume builders', () => {
    const tokens = catalogDefaults();
    expect(buildLineSeriesOptions(tokens).color).toBe(tokens['line.color']);
    expect(buildAreaSeriesOptions(tokens).lineColor).toBe(tokens['area.line']);
    expect(buildBaselineSeriesOptions(tokens).topLineColor).toBe(
      tokens['baseline.top_line'],
    );
    const vol = volumeColors(defaultChartThemeState());
    expect(vol.up).toBe(String(tokens['volume.up']));
    expect(vol.down).toBe(String(tokens['volume.down']));
  });

  it('applyThemeToChart calls applyOptions on mock chart', () => {
    const applyOptions = mock(() => {});
    const priceApply = mock(() => {});
    const chart = {
      applyOptions,
      priceScale: () => ({ applyOptions: priceApply }),
    };
    applyThemeToChart(chart as never, defaultChartThemeState());
    expect(applyOptions).toHaveBeenCalled();
    expect(priceApply).toHaveBeenCalled();
    const bag = applyOptions.mock.calls[0]![0] as {
      layout: { background: { color: string } };
    };
    expect(bag.layout.background.color).toBe(String(catalogDefaults()['chart.bg_color']));
  });

  it('applyThemeToPriceSeries dispatches by chartType', () => {
    const applyOptions = mock(() => {});
    const series = { applyOptions };
    applyThemeToPriceSeries(series as never, defaultChartThemeState(), {
      chartType: 'bars',
    });
    expect(applyOptions).toHaveBeenCalled();
    const barOpts = applyOptions.mock.calls[0]![0] as { thinBars: boolean };
    expect(barOpts.thinBars).toBe(true);

    applyOptions.mockClear();
    applyThemeToPriceSeries(series as never, defaultChartThemeState(), {
      chartType: 'hollow',
    });
    const hollow = applyOptions.mock.calls[0]![0] as { upColor: string };
    expect(hollow.upColor).toBe('rgba(0,0,0,0)');
  });
});

describe('ThemeManager', () => {
  beforeEach(() => {
    resetThemeManagerForTests();
  });

  afterEach(() => {
    resetThemeManagerForTests();
  });

  it('getThemeManager is a singleton', () => {
    const a = getThemeManager();
    const b = getThemeManager();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(ThemeManager);
    resetThemeManagerForTests();
    const c = getThemeManager();
    expect(c).not.toBe(a);
  });

  it('setToken / applyPreset', () => {
    const tm = getThemeManager();
    const afterToken = tm.setToken('chart.color_background', '#aabbcc');
    expect(afterToken.presetId).toBe('custom');
    expect(afterToken.overrides['chart.bg_color']).toBe('#aabbcc');
    expect(tm.getColor('chart.bg_color')).toBe('#aabbcc');
    expect(tm.get('chart.color_background')).toBe('#aabbcc');

    const afterPreset = tm.applyPreset('classic');
    expect(afterPreset.presetId).toBe('classic');
    expect(afterPreset.overrides).toEqual({});
    expect(tm.getTokens()['chart.bg_color']).toBe(
      getPreset('classic').tokens['chart.bg_color'],
    );
  });

  it('registerChart mock gets applyOptions on setState', () => {
    const tm = getThemeManager();
    const applyOptions = mock(() => {});
    const priceApply = mock(() => {});
    const chart = {
      applyOptions,
      priceScale: () => ({ applyOptions: priceApply }),
    };
    const unreg = tm.registerChart(chart as never);
    // registration applies immediately
    expect(applyOptions.mock.calls.length).toBeGreaterThanOrEqual(1);
    const callsAfterReg = applyOptions.mock.calls.length;

    tm.setState(withPreset('classic'));
    expect(applyOptions.mock.calls.length).toBeGreaterThan(callsAfterReg);

    unreg();
    const afterUnreg = applyOptions.mock.calls.length;
    tm.setState(withPreset('mono'));
    // unregistered chart should not receive more applies
    expect(applyOptions.mock.calls.length).toBe(afterUnreg);
  });

  it('registerPriceSeries mock series applyOptions on theme change', () => {
    const tm = getThemeManager();
    const applyOptions = mock(() => {});
    const series = { applyOptions };
    const unreg = tm.registerPriceSeries(series as never, 'candles');
    expect(applyOptions.mock.calls.length).toBeGreaterThanOrEqual(1);
    const n = applyOptions.mock.calls.length;

    tm.setToken('bar.up.color', '#00ff00');
    expect(applyOptions.mock.calls.length).toBeGreaterThan(n);
    const last = applyOptions.mock.calls.at(-1)![0] as { upColor: string };
    expect(last.upColor).toBe('#00ff00');

    tm.updateSeriesType(series as never, 'bars');
    const barLast = applyOptions.mock.calls.at(-1)![0] as { thinBars?: boolean };
    expect(barLast.thinBars).toBe(true);

    unreg();
  });

  it('subscribe listeners fire on setState; errors are swallowed', () => {
    const tm = getThemeManager();
    const good = mock(() => {});
    const bad = mock(() => {
      throw new Error('listener boom');
    });
    const offGood = tm.subscribe(good);
    const offBad = tm.subscribe(bad);
    tm.applyPreset('mono');
    expect(good).toHaveBeenCalled();
    expect(bad).toHaveBeenCalled();
    offGood();
    offBad();
    good.mockClear();
    tm.applyPreset('classic');
    expect(good).not.toHaveBeenCalled();
  });

  it('getPineColors / getVoidLike / getVolumeColors', () => {
    const tm = getThemeManager();
    tm.applyPreset('void-dark');
    const pine = tm.getPineColors();
    expect(pine.bg_color).toBeDefined();
    expect(pine.color_background).toBe(pine.bg_color);
    expect(tm.getVoidLike().bg).toBe(pine.bg_color);
    expect(tm.getVolumeColors().up).toMatch(/rgba|#/);
  });
});

describe('component groups', () => {
  it('every THEME_GROUPS id has at least one token in THEME_TOKEN_DEFS', () => {
    for (const g of THEME_GROUPS) {
      const defs = tokensForGroup(g.id);
      expect(defs.length).toBeGreaterThan(0);
      expect(THEME_TOKEN_DEFS.some((d) => d.group === g.id)).toBe(true);
    }
  });

  it('every token def group is listed in THEME_GROUPS', () => {
    const groupIds = new Set(THEME_GROUPS.map((g) => g.id));
    for (const d of THEME_TOKEN_DEFS) {
      expect(groupIds.has(d.group)).toBe(true);
    }
  });
});
