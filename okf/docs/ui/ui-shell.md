---
type: "Document"
title: "UI shell"
description: "AXIS chrome: topbar, watchlist, status bar, settings, plugin manager, logs, and layout chrome around the chart."
resource: "docs/ui/ui-shell.mdx"
tags: [doc, docs, ui, ui-shell]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:02:55Z
sources:
  - id: tree
    resource: "docs/ui/ui-shell.mdx"
    title: "docs/ui/ui-shell.mdx"
    author: process:git
okf_lock: generated
---

# Source

Repo path `docs/ui/ui-shell.mdx`.

# Outline

* Abstract
* Conceptual model
* Topbar responsibilities
  * Chart themes
  * Command palette
  * Keyboard shortcuts
  * Alerts panel
  * Workspace snapshots
  * Panel docks (side-by-side)
* Mobile shell (phones / tablets)
* Watchlist
* Status bar
  * Live settings (Settings dialog)
* Logs
  * System Logs strip
  * Scriptlogs & Profiler
* Theming
* Accessibility / test hooks
* Invariants
* Failure modes
* See also

# Mentions

* [src](/code/src.md)
* [src/editor](/code/src/editor.md)
* [src/theme](/code/src/theme.md)
* [src/ui](/code/src/ui.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
