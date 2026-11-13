---
type: "Code Module"
title: "src/ui/debug"
description: "Studio Debug page — the runtime switch for chart/engine debug logging, log-ring controls, and a formatted live view of the rotating axis.debug.log. ring."
resource: "src/ui/debug"
tags: [code, debug, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-13T10:27:21Z
sources:
  - id: tree
    resource: "src/ui/debug"
    title: "src/ui/debug"
    author: process:git
okf_lock: generated
---

# Role

Studio Debug page — the runtime switch for chart/engine debug logging, log-ring controls, and a formatted live view of the rotating axis.debug.log. ring. Same flag as the "Enable debug logs" toggle on this page (localStorage.axis.debug). A VITEAXISDEBUG build forces it on; the toggle then shows that state instead of pretending it can turn logging off. @module ui/debug/DebugPage

# Files

* `DebugPage.tsx` — DebugPage

# Packages

`solid-js`

# Depends on

* [src](/code/src.md)
* [src/ui](/code/src/ui.md)
* [src/ui/studio](/code/src/ui/studio.md)

# Used by

* [src/ui/studio](/code/src/ui/studio.md)
