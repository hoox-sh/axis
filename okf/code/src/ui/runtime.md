---
type: "Code Module"
title: "src/ui/runtime"
description: "Runtime studio canvas — active engine, endpoint, exec mode, health."
resource: "src/ui/runtime"
tags: [code, runtime, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:05:44Z
sources:
  - id: tree
    resource: "src/ui/runtime"
    title: "src/ui/runtime"
    author: process:git
okf_lock: generated
---

# Files

* `RuntimePage.tsx` — RuntimePage
* `engine-config.ts` — EXEC_MODE_OPTIONS, EngineExecMode, SaveEngineConfigInput, engineHasApiKey, engineHasExecMode, engineHasPreferWs, engineNeedsEndpoint, execModeOptionsFor, normalizeExecMode, readEnginePluginConfig, saveEngineConfig

# Packages

`solid-js`, `solid-js/store`

# Depends on

* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/studio](/code/src/ui/studio.md)
* [src/workers](/code/src/workers.md)

# Used by

* [src/ui/studio](/code/src/ui/studio.md)
* [src/ui/workers](/code/src/ui/workers.md)
