---
type: "Code Module"
title: "src/ui/panels"
description: "src/ui/panels contains DockColumn.tsx, FloatableShell.tsx, dock-layout.ts, and 5 more files."
resource: "src/ui/panels"
tags: [code, panels, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:05:44Z
sources:
  - id: tree
    resource: "src/ui/panels"
    title: "src/ui/panels"
    author: process:git
okf_lock: generated
---

# Files

* `DockColumn.tsx` — ChartOverlayHost, DockColumn, FloatRoot
* `FloatableShell.tsx` — FloatableShell, FloatableShellProps, PanelDragOverlay, getDragPreview, installPanelWindowBridge
* `dock-layout.ts` — DOCK_HOST_IDS, DOCK_SIDE_MAX_VIEWPORT_FRAC, DOCK_STACK_ORDER, OVERLAY_HOST_IDS, dockColumnWidth, dockHostElement, dockStackCount, dockStackCssOrder, indexInDockStack, isLastInDockStack, overlayDockHostElement, overlayPanelsOnDock
* `drop-zones.ts` — dropZoneToDock, hitDropZone, skeletonSize
* `hover-slide.ts` — HOVER_SLIDE_LEAVE_MS, HOVER_SLIDE_PEEK_BOTTOM, HOVER_SLIDE_PEEK_SIDE, clearPanelHoverSlideExpanded, getHoverSlideExpandedMap, hoverSlideLayoutSize, hoverSlidePeekForDock, isPanelHoverSlideExpanded, setPanelHoverSlideExpanded
* `mobile-sheet.ts` — activeMobileSheet, closeAllMobileSheets, closeMobileSheet, openMobileSheet
* `panel-manager.ts` — CHART_OVERLAY_BOTTOM_PAD, CHART_OVERLAY_TOP_PAD, ChartOverlayGeometry, DEFAULT_OVERLAY_OPACITY, FIXED_APP_SHELL_PANELS, OVERLAY_OPACITY_MAX, OVERLAY_OPACITY_MIN, PANEL_IDS, chartOverlayGeometry, clampOverlayOpacity, defaultPanelPosition, effectivePortalDock
* `types.ts` — DropZone, PANEL_META, PanelChrome, PanelChromeMap, PanelDock, PanelId, defaultPanelChrome, defaultPanelChromeMap, isHoverSlideEligible

# Packages

`solid-js`, `solid-js/store`, `solid-js/web`

# Depends on

* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/editor](/code/src/editor.md)
* [src/indicators](/code/src/indicators.md)
* [src/mcp](/code/src/mcp.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [tests](/code/tests.md)
