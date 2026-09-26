---
type: "Code Module"
title: "src/ui"
description: "src/ui contains AboutModal.tsx, AlertsPanel.tsx, AppDrawer.tsx, and 75 more files."
resource: "src/ui"
tags: [code, ui]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-26T15:10:49Z
sources:
  - id: tree
    resource: "src/ui"
    title: "src/ui"
    author: process:git
okf_lock: generated
---

# Files

* `AboutModal.tsx` — AboutModal, closeAboutModal, isAboutModalOpen, openAboutModal
* `AlertsPanel.tsx` — AlertsPanel
* `AppDrawer.tsx` — AppDrawer, AppDrawerProps, AppDrawerWidth
* `BarReplayControls.tsx` — BarReplayControls, exitBarReplay, startBarReplay
* `CachedDatasetsModal.tsx` — CachedDatasetsModal, CachedDatasetsModalProps
* `ChartLayoutMenu.tsx` — ChartLayoutMenu
* `CommandPalette.tsx` — CommandPalette, CommandPaletteProps
* `CompareSymbolControl.tsx` — CompareSymbolControl
* `ConnectionHud.tsx` — ConnectionHud
* `ContextMenu.tsx` — ContextMenu
* `DataSourceManagerPanel.tsx` — DataSourceManagerPanel
* `DataViewPanel.tsx` — DataViewPanel
* `EditorGitBar.tsx` — EditorGitBar, EditorGitBarProps
* `EditorProblems.tsx` — EDITOR_PROBLEMS_DEFAULT_HEIGHT, EDITOR_PROBLEMS_HEIGHT_KEY, EDITOR_PROBLEMS_MIN_HEIGHT, EditorProblem, EditorProblems, EditorProblemsProps, clampProblemsHeight, countProblemsBySeverity, diagnosticsToProblems, formatProblemForCopy, formatProblemLine, formatProblemSource
* `EquityChart.tsx` — EquityChart
* `ErrorFallback.tsx` — ErrorFallback, ErrorFallbackProps, errorFallback
* `ErrorShareToast.tsx` — ErrorShareToast
* `HooxLoader.tsx` — HooxLoader, HooxLoaderL, HooxLoaderM, HooxLoaderProps, HooxLoaderXs
* `HooxLogo.tsx` — HooxLogo, HooxLogoPaths, HooxLogoProps, HooxLogoSize, resolveLogoSize
* `HpoPanel.tsx` — HpoPanel
* `LayerPanel.tsx` — LayerPanel
* `McpConnectCta.tsx` — McpConnectCta, mcpNeedsConnect
* `McpHud.tsx` — MCP_ACTIVITY_WINDOW_MS, McpHud
* `OnChainPanel.tsx` — OnChainPanel
* `PluginConfigRow.tsx` — PluginConfigRow, PluginConfigRowProps
* `PluginManager.tsx` — PluginManager
* `ResizeHandle.tsx` — ResizeDirection, ResizeHandle
* `ResultsModal.tsx` — ResultsModal
* `RunSplitButton.tsx` — RunSplitButton
* `ScreenshotMenu.tsx` — ScreenshotMenu
* `ScriptLibraryPanel.tsx` — LibraryPanel, ScriptLibraryPanel, ScriptLibraryPanelProps
* `ScriptRunSelect.tsx` — ScriptRunSelect, ScriptRunSelectProps
* `ScriptSettingsModal.tsx` — ScriptSettingsModal
* `SettingsDialog.tsx` — EditorIntelPanel, EngineExecMode, ExchangeCredentialsPanel, SettingsDialog, SettingsTabId
* `StatusBar.tsx` — StatusBar
* `StorageChangeDialog.tsx` — StorageChangeDialogProps, StorageChangeMode
* `StorageChangePrompt.tsx` — StorageChangePrompt
* `StrategyReport.tsx` — StrategyReport, StrategyReportProps
* `SymbolModal.tsx` — SymbolModal, SymbolModalProps
* `SystemLogs.tsx` — SystemLogs
* `ThemeLibrary.tsx` — BarColorLibrary, SavedThemeLibrary
* `ThemePanel.tsx` — ThemePanel, ThemePanelProps
* `Toasts.tsx` — Toasts
* `Topbar.tsx` — Topbar
* `TopbarField.tsx` — TopbarField, TopbarFieldProps, TopbarFieldVariant
* `UpdateBanner.tsx` — UpdateBanner
* `VolumeProfileOverlay.tsx` — VolumeProfileOverlay
* `Watchlist.tsx` — Watchlist
* `WorkersManager.tsx` — WorkersManager
* `WorkspaceSnapshotMenu.tsx` — WorkspaceSnapshotMenu, createLiveWorkspaceSetters
* `boot-errors.ts` — ReportUiErrorOpts, _resetReportThrottleForTests, formatErrorMessage, installBootErrorHandlers, reportUiError
* `clipboard.ts` — copyToClipboard
* `command-registry.ts` — CommandActions, CommandCategory, CommandDef, CommandId, CommandSpec, DEFAULT_COMMAND_SPECS, RankedCommand, buildDefaultCommands, filterCommands, scoreCommand, scoreMatch
* `context-menu.ts` — ContextMenuEntry, ContextMenuItem, ContextMenuSep, clampMenuPosition
* `document-title.ts` — ChartTitleInput, formatChartTitle
* `editor-problems.ts` — EDITOR_PROBLEMS_DEFAULT_HEIGHT, EDITOR_PROBLEMS_HEIGHT_KEY, EDITOR_PROBLEMS_MIN_HEIGHT, EditorProblem, clampProblemsHeight, countProblemsBySeverity, diagnosticsToProblems, formatProblemForCopy, formatProblemLine, formatProblemSource, formatProblemsListForCopy, severityRank
* `error-share.ts` — AXIS_DIAGNOSTIC_VERSION, BuildDiagnosticOpts, ErrorDiagnosticPayload, ErrorShareOffer, _resetErrorShareThrottleForTests, acceptErrorShareOffer, buildErrorDiagnosticPayload, dismissErrorShareOffer, endpointHostOnly, exportErrorDiagnosticNow, isErrorShareEnabled, isSecretFieldName
* `exchange-credentials-form.ts` — EMPTY_EXCHANGE_CREDENTIAL_FORM, EXCHANGE_CREDENTIAL_VENUES, EXCHANGE_CREDENTIAL_VENUE_LABELS, ExchangeCredentialFormState, ExchangeCredentialVenue, ccxtNeedsPassword, defaultExchangeCredentialVenue, exchangeVenueLabel, isExchangeCredentialVenue, normalizeCcxtExchangeId, venueNeedsPassphrase
* `focus-trap.ts` — installFocusTrap, listFocusable
* `hud-model.ts` — EngTopology, ExecMode, HudChipId, HudInput, HudSnapshot, PathClass, RunClass, deriveHud, hudChipHelp, isLocalEndpoint, isWorkerEndpoint, liveBadgeLabel
* `icon-map.ts` — ICON_MAP, IconName, PANEL_ICON, findDuplicateIconGlyphs
* `icons.tsx` — ICON_MAP, IconLabel, IconProps, Icons, PANEL_ICON, findDuplicateIconGlyphs
* `legacy-topbar.js` — initTopbar, setLiveIndicator
* `legacy-watchlist.js` — destroyWatchlist, initWatchlist
* `manager.js` — applyTheme, closeManager, initManager, openManager
* `plugin-badges-utils.ts` — CAP_META, CapKey, capabilityKeys, engineOptionLabel
* `plugin-badges.tsx` — CapKey, CapabilityBadges, capabilityKeys, engineOptionLabel
* `plugin-config.ts` — ConfigTarget, GatewayMode, _resetGatewayExchangeCache, effectiveConfig, fetchGatewayExchanges, hasConfigFields, resolvePluginFieldValue, writePluginField
* `presentation.ts` — enterBrowserFullscreen, exitBrowserFullscreen, installPresentationControls, isBrowserFullscreen, setChartOnlyMode, setPresentationRoot, toggleBrowserFullscreen, toggleChartOnlyFullscreen, toggleChartOnlyMode
* `responsive.ts` — PHONE_MAX_WIDTH, TABLET_MAX_WIDTH, ViewportMode, isDesktopViewport, isPhoneViewport, isTabletSideDockOverlay, isTabletViewport, isTouchPointer, pointerCoarse, viewport
* `results.js` — initResults, renderResults
* `settings.js` — closeSettings, openSettings
* `sr-announce.ts` — announce, announceError
* `status.js` — initStatus, setStatus
* `symbol-autocomplete.js` — attachSymbolAutocomplete
* `tabbed-editor.js` — TabbedEditor
* `telemetry.ts` — classifyTransport, connDotClass, formatLatency, formatTickAge, idlePlane, pushSample, transportLabel
* `ui-scale.ts` — UI_SCALE_PRESETS, formatUiScalePct

# Packages

`lucide-solid`, `solid-js`, `solid-js/store`, `solid-js/web`

# Depends on

* [src](/code/src.md)
* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/data](/code/src/data.md)
* [src/data/venues](/code/src/data/venues.md)
* [src/editor](/code/src/editor.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/indicators/builtins](/code/src/indicators/builtins.md)
* [src/mcp](/code/src/mcp.md)
* [src/onchain](/code/src/onchain.md)
* [src/optimize](/code/src/optimize.md)
* [src/plugins](/code/src/plugins.md)
* [src/pwa](/code/src/pwa.md)
* [src/results](/code/src/results.md)
* [src/sources](/code/src/sources.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/theme](/code/src/theme.md)
* [src/ui/dsm](/code/src/ui/dsm.md)
* [src/ui/layers](/code/src/ui/layers.md)
* [src/ui/library](/code/src/ui/library.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [src/ui/shortcuts](/code/src/ui/shortcuts.md)
* [src/ui/studio](/code/src/ui/studio.md)
* [src/ui/workers](/code/src/ui/workers.md)
* [src/update](/code/src/update.md)
* [src/workers](/code/src/workers.md)

# Used by

* [src](/code/src.md)
* [src/chart](/code/src/chart.md)
* [src/data](/code/src/data.md)
* [src/desktop](/code/src/desktop.md)
* [src/editor](/code/src/editor.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/ui/dsm](/code/src/ui/dsm.md)
* [src/ui/layers](/code/src/ui/layers.md)
* [src/ui/library](/code/src/ui/library.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [src/ui/studio](/code/src/ui/studio.md)
* [src/ui/wire](/code/src/ui/wire.md)
* [src/ui/workers](/code/src/ui/workers.md)
* [src/update](/code/src/update.md)
* [tests](/code/tests.md)

# Nested

* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/dsm](/code/src/ui/dsm.md)
* [src/ui/layers](/code/src/ui/layers.md)
* [src/ui/library](/code/src/ui/library.md)
* [src/ui/mobile](/code/src/ui/mobile.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [src/ui/shortcuts](/code/src/ui/shortcuts.md)
* [src/ui/studio](/code/src/ui/studio.md)
* [src/ui/wire](/code/src/ui/wire.md)
* [src/ui/workers](/code/src/ui/workers.md)
