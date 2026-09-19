/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS MCP server — Streamable HTTP at `/mcp` plus PWA bridge DO.
 *
 * @module worker/mcp
 */

export { handleMcp } from './handler';
export {
  McpBridgeDO,
  parseBridgeTicket,
  formatBridgeTicket,
  BRIDGE_TICKET_TTL_MS,
} from './bridge';
export { MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from './catalog';
export { allowWorkerRequest, describeAllowlist } from './allowlist';
export { MCP_SERVER_NAME, MCP_PROTOCOL_VERSION } from './protocol';
