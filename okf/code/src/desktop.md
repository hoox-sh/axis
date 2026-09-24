---
type: "Code Module"
title: "src/desktop"
description: "AXIS desktop (Tauri) shell helpers."
resource: "src/desktop"
tags: [code, desktop]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "src/desktop"
    title: "src/desktop"
    author: process:git
okf_lock: generated
---

# Files

* `index.ts` — AXIS_MENU_EVENT, installDesktopMenu, installDesktopShell, isTauriShell, pickPineScriptsFromDisk, showAboutDialog
* `is-tauri.ts` — isTauriShell
* `menu.ts` — AXIS_MENU_EVENT, AxisMenuAction, DesktopMenuHandlers, installDesktopMenu
* `open-scripts.ts` — OpenedPineScript, pickPineScriptsFromDisk
* `shell.ts` — DesktopShellOptions, installDesktopShell, openScriptsFromMenu, showAboutDialog

# Packages

`@tauri-apps/api/core`, `@tauri-apps/api/event`, `@tauri-apps/plugin-dialog`

# Depends on

* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)

# Used by

* [src](/code/src.md)
* [tests](/code/tests.md)
