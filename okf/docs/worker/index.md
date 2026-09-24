# docs/worker

# Concepts

* [Worker auth](auth.md) - API keys (pn…), fail-closed D1 without KV, admin token, Bearer, ALLOWOPENKEYS, and /api/run gating.
* [Worker bindings](bindings.md) - wrangler.toml vars, KV, D1, R2, Durable Objects — provision once, paste IDs. Worker script worker-axis.
* [Worker data plane](data-plane.md) - Script library API: /api/scripts, D1 schema, drafts, revisions, and in-memory fallback.
* [Durable Objects](durable-objects.md) - SessionDO WebSocket relay: one Binance upstream per session, fan-out to browser clients.
* [Worker](index.md) - Cloudflare Worker for AXIS: /api/run proxy, keys, scripts, usage, and Durable Object stream relay.
* [MCP server](mcp.md) - Remote MCP for AXIS — Streamable HTTP /mcp, Bearer keys, Worker tools, live-app capabilities, McpBridgeDO.
* [Worker runtime](runtime.md) - POST /api/run — auth gate, rate limits, size caps, EXTERNALBACKEND proxy, feature-gated in-worker Pyodide.
