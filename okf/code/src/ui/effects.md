---
type: "Code Module"
title: "src/ui/effects"
description: "UI effect manager — tuned chrome motion."
resource: "src/ui/effects"
tags: [code, effects, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-27T14:41:44Z
sources:
  - id: tree
    resource: "src/ui/effects"
    title: "src/ui/effects"
    author: process:git
okf_lock: generated
---

# Files

* `EffectsPanel.tsx` — EffectsPanel
* `index.ts` — EffectDef, EffectParamSpec, EffectPreviewSpec, EffectTune, UI_EFFECTS_STORAGE_KEY, applyUiEffects, effectActive, effectDirty, effectEnabled, effectMs, effectParam, getEffect
* `manager.ts` — UI_EFFECTS_STORAGE_KEY, _resetUiEffectsForTests, _setReducedMotionForTests, applyUiEffects, effectActive, effectDirty, effectEnabled, effectMs, effectParam, getEffect, installUiEffects, listEffects
* `registry.ts` — BUILTIN_EFFECTS, WATCHLIST_TICK
* `resolve.ts` — clampEffectParam, effectCssVars, readEnabled, readParam, sanitizeTunes, tuneIsDirty
* `types.ts` — EffectDef, EffectParamSpec, EffectPreviewSpec, EffectTune

# Packages

`solid-js`, `solid-js/store`

# Depends on

* [src/ui/studio](/code/src/ui/studio.md)

# Used by

* [src](/code/src.md)
* [src/ui](/code/src/ui.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [tests](/code/tests.md)
