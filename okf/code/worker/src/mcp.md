---
type: "Code Module"
title: "worker/src/mcp"
description: "AXIS MCP server — Streamable HTTP at /mcp plus PWA bridge DO."
resource: "worker/src/mcp"
tags: [code, mcp, worker]
status: stable
generated:
  by: process:axis-okf/1
  at: 2026-09-24T03:05:44Z
sources:
  - id: tree
    resource: "worker/src/mcp"
    title: "worker/src/mcp"
    author: process:git
okf_lock: generated
---

# Files

* `allowlist.ts` — AllowlistDecision, allowWorkerRequest, describeAllowlist
* `bridge.ts` — BRIDGE_TICKET_TTL_MS, McpBridgeDO, formatBridgeTicket, parseBridgeTicket
* `catalog.ts` — MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS, findPrompt, findResource, findTool
* `handler.ts` — AuthContext, MCP_MAX_BODY_BYTES, _resetMcpRateForTests, handleMcp
* `index.ts` — BRIDGE_TICKET_TTL_MS, MCP_PROMPTS, MCP_PROTOCOL_VERSION, MCP_RESOURCES, MCP_SERVER_NAME, MCP_TOOLS, McpBridgeDO, allowWorkerRequest, describeAllowlist, formatBridgeTicket, handleMcp, parseBridgeTicket
* `jsonrpc.ts` — MCP_MAX_BATCH, ParsedBody, isNotification, parseJsonRpc, parseJsonText, rpcError, rpcResult
* `protocol.ts` — APP_INVOKE_TIMEOUT_MS, AppInvokeRequest, AppInvokeResponse, JSONRPC_INTERNAL, JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, JSONRPC_PARSE, JsonRpcError, JsonRpcId, JsonRpcRequest, JsonRpcResponse
* `proxy.ts` — ProxyCall, ProxyResult, proxyWorkerRequest
* `tools.ts` — ToolContext, callTool, getPrompt, listPrompts, listResources, listTools, readResource

# Depends on

* [worker/src](/code/worker/src.md)

# Used by

* [worker/src](/code/worker/src.md)
* [worker/tests](/code/worker/tests.md)
