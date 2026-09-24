---
type: "Code Module"
title: "src/ui/shortcuts"
description: "Public API for the keyboard shortcut system."
resource: "src/ui/shortcuts"
tags: [code, shortcuts, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/ui/shortcuts"
    title: "src/ui/shortcuts"
    author: process:git
okf_lock: generated
---

# Files

* `Feedback.tsx` — SHORTCUT_FIRED_EVENT, ShortcutFeedback, ShortcutFiredDetail
* `Hub.tsx` — ShortcutHub, buildDispatchTable, dispatchShortcut, registerShortcut
* `Settings.tsx` — KeyboardSettingsPanel
* `ShortcutsModal.tsx` — ShortcutsModal, closeShortcutsModal, isShortcutsModalOpen, openShortcutsModal
* `actions.ts`
* `index.ts`
* `keys.ts` — Platform, detectPlatform, formatChord, matchEvent, normalizeChord, normalizeEventKey, parseChord
* `palette-bridge.ts` — PaletteIntent, closePalette, getPaletteIntent, isPaletteOpen, openBuiltinPicker, openPalette, togglePalette
* `pine-snippets.ts` — PINE_SNIPPETS, PineSnippet, getPineSnippet
* `registry.ts` — DEFAULT_BINDINGS, detectConflicts, getDefaultChord, getDisplay, resolveBinding
* `runtime.ts` — DispatchRow, buildDispatchTable, dispatchShortcut, fireShortcutById, registerShortcut
* `types.ts` — Chord, ShortcutDef, ShortcutId, ShortcutOverrides, ShortcutRegistryShape
* `use-record-chord.ts` — RecordChordApi, chordFromEvent, useRecordChord

# Packages

`solid-js`

# Depends on

* [src/chart](/code/src/chart.md)
* [src/store](/code/src/store.md)
* [src/ui/studio](/code/src/ui/studio.md)

# Used by

* [src](/code/src.md)
* [src/editor](/code/src/editor.md)
* [src/mcp](/code/src/mcp.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [tests](/code/tests.md)
