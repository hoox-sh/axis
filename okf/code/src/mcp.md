---
type: "Code Module"
title: "src/mcp"
description: "AXIS in-app MCP host — capabilities, snapshot, Worker bridge."
resource: "src/mcp"
tags: [code, mcp]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T06:42:13Z
sources:
  - id: tree
    resource: "src/mcp"
    title: "src/mcp"
    author: process:git
okf_lock: generated
---

# Files

* `bridge.ts` — McpBridgeState, McpBridgeStatus, connectMcpBridge, disconnectMcpBridge, isWellFormedWorkerApiKey, mcpBridgeState, onMcpBridge, refreshBridgeTabs, rotateMcpBridge
* `catalog.ts` — APP_CAPABILITIES, SETTABLE_PATHS, findCapability
* `commands.ts` — clearPaletteCommands, listPaletteCommandIds, runPaletteCommand, setPaletteCommand, setPaletteCommands
* `dispatch.ts` — McpHostHooks, invokeCapability, setMcpHostHooks
* `host.ts` — AxisMcpApi, McpPrefs, loadMcpPrefs, requestMcpConnect, saveMcpPrefs, startMcpHost
* `index.ts` — APP_CAPABILITIES, McpInvokeError, SETTABLE_PATHS, buildAppSnapshot, connectMcpBridge, disconnectMcpBridge, findCapability, invokeCapability, loadMcpPrefs, mcpBridgeState, onMcpBridge, requestMcpConnect
* `protocol.ts` — AppInvokeRequest, AppInvokeResponse, CapabilitySpec, McpInvokeError, getByPath, sessionIdFromApiKey
* `snapshot.ts` — buildAppSnapshot, buildSettingsSnapshot

# Packages

`solid-js/store`

# Depends on

* [src/alerts](/code/src/alerts.md)
* [src/chart](/code/src/chart.md)
* [src/chart/drawings](/code/src/chart/drawings.md)
* [src/data](/code/src/data.md)
* [src/engines](/code/src/engines.md)
* [src/indicators](/code/src/indicators.md)
* [src/plugins](/code/src/plugins.md)
* [src/storage](/code/src/storage.md)
* [src/store](/code/src/store.md)
* [src/streams](/code/src/streams.md)
* [src/theme](/code/src/theme.md)
* [src/ui/panels](/code/src/ui/panels.md)
* [src/ui/shortcuts](/code/src/ui/shortcuts.md)
* [src/update](/code/src/update.md)

# Used by

* [src](/code/src.md)
* [src/ui](/code/src/ui.md)
* [src/ui/settings](/code/src/ui/settings.md)
* [tests](/code/tests.md)
