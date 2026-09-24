/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS in-app MCP host — capabilities, snapshot, Worker bridge.
 *
 * @module mcp
 */

export { APP_CAPABILITIES, findCapability, SETTABLE_PATHS } from './catalog';
export { invokeCapability, setMcpHostHooks, type McpHostHooks } from './dispatch';
export { buildAppSnapshot } from './snapshot';
export {
  startMcpHost,
  loadMcpPrefs,
  saveMcpPrefs,
  requestMcpConnect,
  type McpPrefs,
} from './host';
export {
  connectMcpBridge,
  disconnectMcpBridge,
  rotateMcpBridge,
  mcpBridgeState,
  onMcpBridge,
  type McpBridgeState,
} from './bridge';
export { setPaletteCommands, runPaletteCommand } from './commands';
export { McpInvokeError, sessionIdFromApiKey } from './protocol';
