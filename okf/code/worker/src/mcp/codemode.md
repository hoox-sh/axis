---
type: "Code Module"
title: "worker/src/mcp/codemode"
description: "worker/src/mcp/codemode contains catalog.ts, handlers.ts, protocol.ts, and 2 more files."
resource: "worker/src/mcp/codemode"
tags: [code, codemode, mcp, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-11-13T10:52:54Z
sources:
  - id: tree
    resource: "worker/src/mcp/codemode"
    title: "worker/src/mcp/codemode"
    author: process:git
okf_lock: generated
---

# Files

* `catalog.ts` — CodeModeCatalogRow, compactCatalog, shortToolName
* `handlers.ts` — ToolInvoker, createCodeModeHandlers
* `protocol.ts` — CodeModeHandler, CodeModeHandlers, CodeModeLimits, DEFAULT_LIMITS, SandboxMode, SandboxRequest, SandboxResponse, SandboxResult
* `sandbox.ts` — AxisCodeExecutor, MakeDispatcher, SANDBOX_COMPATIBILITY_DATE, SANDBOX_MAIN_MODULE, SandboxDeps, SandboxStats, buildSandboxModule, buildWorkerCode, dispatchCall, normalizeCode, runInSandbox
* `tools.ts` — CODE_MODE_TOOL_DEFS, CODE_MODE_TOOL_NAMES, allToolDefs, codeModeEnabled, runCodeModeTool

# Packages

`cloudflare:workers`

# Depends on

* [worker/src](/code/worker/src.md)
* [worker/src/mcp](/code/worker/src/mcp.md)

# Used by

* [worker/src/mcp](/code/worker/src/mcp.md)
* [worker/tests](/code/worker/tests.md)
