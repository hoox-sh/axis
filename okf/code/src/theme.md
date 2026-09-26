---
type: "Code Module"
title: "src/theme"
description: "AXIS Theme Manager — public API."
resource: "src/theme"
tags: [code, theme]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-26T11:59:11Z
sources:
  - id: tree
    resource: "src/theme"
    title: "src/theme"
    author: process:git
okf_lock: generated
---

# Files

* `apply.ts` — applyThemeToChart, applyThemeToDocument, applyThemeToPriceSeries, buildAreaSeriesOptions, buildBarSeriesOptions, buildBaselineSeriesOptions, buildCandleSeriesOptions, buildChartOptionsFromTokens, buildChromeCssVars, buildLineSeriesOptions, pineHostColors, tokensToVoidLike
* `catalog.ts` — THEME_GROUPS, THEME_TOKEN_DEFS, TOKEN_ALIASES, canonicalTokenKey, catalogDefaults, getTokenDef, pineColorMap, tokensForGroup
* `index.ts` — ApplyChartThemeOpts, ApplySeriesThemeOpts, BarColorTheme, ChartThemeState, EmbeddedBarTheme, MAX_BAR_THEMES, MAX_SAVED_THEMES, PRESET_CLASSIC, PRESET_DUSK, PRESET_GRAPHITE, PRESET_MONO, PRESET_OBSIDIAN
* `library.ts` — MAX_BAR_THEMES, MAX_SAVED_THEMES, attachBarTheme, barTokenKeys, barTokensEqual, barTokensFromState, captureCustomTheme, clampThemeName, coerceBarTokenBag, detachBarThemeRef, fillBarTokens, hydrateBarColorTheme
* `manager.ts` — ThemeListener, ThemeManager, getThemeManager, pineColorMap, resetThemeManagerForTests
* `presets.ts` — PRESET_CLASSIC, PRESET_DUSK, PRESET_GRAPHITE, PRESET_HIGH_CONTRAST, PRESET_MONO, PRESET_OBSIDIAN, PRESET_PACIFIC, PRESET_PARCHMENT, PRESET_PORCELAIN, PRESET_VOID_DARK, PRESET_VOID_LIGHT, THEME_PRESETS
* `resolve.ts` — allTokenKeys, coerceTokenValue, defaultChartThemeState, getColor, getToken, hydrateChartTheme, normalizeOverrides, resetOverrides, resolveTokens, serializeTheme, themesEqual, withPreset
* `types.ts` — ApplyChartThemeOpts, ApplySeriesThemeOpts, BarColorTheme, ChartThemeState, EmbeddedBarTheme, SavedCustomTheme, ThemeGroupId, ThemePreset, ThemeTokenDef, ThemeTokenType, ThemeTokenValue, ThemeTokens

# Packages

`lightweight-charts`

# Depends on

* [src/utils](/code/src/utils.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/mcp](/code/src/mcp.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
