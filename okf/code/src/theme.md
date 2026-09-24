---
type: "Code Module"
title: "src/theme"
description: "AXIS Theme Manager — public API."
resource: "src/theme"
tags: [code, theme]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
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
* `index.ts` — ApplyChartThemeOpts, ApplySeriesThemeOpts, ChartThemeState, PRESET_CLASSIC, PRESET_DUSK, PRESET_GRAPHITE, PRESET_MONO, PRESET_OBSIDIAN, PRESET_PACIFIC, PRESET_PARCHMENT, PRESET_PORCELAIN, PRESET_VOID_DARK
* `manager.ts` — ThemeListener, ThemeManager, getThemeManager, pineColorMap, resetThemeManagerForTests
* `presets.ts` — PRESET_CLASSIC, PRESET_DUSK, PRESET_GRAPHITE, PRESET_HIGH_CONTRAST, PRESET_MONO, PRESET_OBSIDIAN, PRESET_PACIFIC, PRESET_PARCHMENT, PRESET_PORCELAIN, PRESET_VOID_DARK, PRESET_VOID_LIGHT, THEME_PRESETS
* `resolve.ts` — allTokenKeys, coerceTokenValue, defaultChartThemeState, getColor, getToken, hydrateChartTheme, normalizeOverrides, resetOverrides, resolveTokens, serializeTheme, themesEqual, withPreset
* `types.ts` — ApplyChartThemeOpts, ApplySeriesThemeOpts, ChartThemeState, ThemeGroupId, ThemePreset, ThemeTokenDef, ThemeTokenType, ThemeTokenValue, ThemeTokens

# Packages

`lightweight-charts`

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/mcp](/code/src/mcp.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [tests](/code/tests.md)
