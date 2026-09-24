---
type: "Code Module"
title: "src/engines"
description: "Legacy calculation engine plugins (pre-Solid path)."
resource: "src/engines"
tags: [code, engines]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:07:37Z
sources:
  - id: tree
    resource: "src/engines"
    title: "src/engines"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — BUILTIN_ENGINES, DEFAULT_PYNE_WORKER_ENDPOINT, LOCAL_PYODIDE_INDEX, LOCAL_PYODIDE_VERSION, _resetEngineRegistrationFlag, callPyodideRunScript, ensureEnginesRegistered, formatPyodideBridgeError, getEngine, listDynamicEngineIds, listEngines, looksLikePyneWorkerEndpoint
* `engine-ws.ts` — EngineWsResult, EngineWsRunRequest, _resetEngineWsClients, endpointToRunWsUrl, getEngineWsClient, probeEngineWs
* `index.js` — pyodideEngine, serverEngine

# Packages

`micropip`

# Depends on

* [src](/code/src.md)
* [src/alerts](/code/src/alerts.md)
* [src/data](/code/src/data.md)
* [src/plugins](/code/src/plugins.md)
* [src/store](/code/src/store.md)
* [src/ui](/code/src/ui.md)

# Used by

* [src](/code/src.md)
* [src/mcp](/code/src/mcp.md)
* [src/plugins](/code/src/plugins.md)
* [src/ui](/code/src/ui.md)
* [src/ui/architecture](/code/src/ui/architecture.md)
* [src/ui/plugins](/code/src/ui/plugins.md)
* [src/ui/runtime](/code/src/ui/runtime.md)
* [src/ui/workers](/code/src/ui/workers.md)
* [src/workers](/code/src/workers.md)
* [tests](/code/tests.md)
* [tests/integration](/code/tests/integration.md)
* [tests/security](/code/tests/security.md)
