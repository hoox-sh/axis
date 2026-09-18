/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * MCP JSON-RPC types + AXIS invoke envelope (Worker copy).
 *
 * Protocol: JSON-RPC 2.0 over Streamable HTTP (`POST /mcp`).
 * App-plane tools use {@link AppInvokeRequest} through {@link McpBridgeDO}.
 *
 * @module worker/mcp/protocol
 */

/** MCP protocol versions this server accepts. */
export const MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18', '2024-11-05'] as const;

/** Version we advertise when the client omits / sends an unknown one. */
export const MCP_PROTOCOL_VERSION = '2025-03-26';

export const MCP_SERVER_NAME = 'axis';

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

export const JSONRPC_PARSE = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL = -32603;

/** JSON Schema fragment used in tools/list. */
export type JsonSchema = Record<string, unknown>;

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Worker-only vs requires a connected PWA session. */
  plane: 'worker' | 'app';
}

export interface McpResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptDef {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type McpContent = McpTextContent | McpImageContent;

export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

/** App-plane RPC from Worker MCP → connected PWA. */
export interface AppInvokeRequest {
  id: string;
  capability: string;
  payload?: unknown;
}

export interface AppInvokeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

export const APP_INVOKE_TIMEOUT_MS = 20_000;

/** First 32 hex chars of SHA-256(key) — same partition as Worker `userId`. */
export async function sessionIdFromApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export function pickProtocolVersion(requested: unknown): string {
  const v = typeof requested === 'string' ? requested.trim() : '';
  if ((MCP_PROTOCOL_VERSIONS as readonly string[]).includes(v)) return v;
  return MCP_PROTOCOL_VERSION;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * MCP `structuredContent` must be a JSON object for strict clients
 * (some validate `expected record`). App-plane capabilities legitimately
 * return arrays (`indicators.list`, `logs.get`, …) and primitives
 * (`app.get` with a dot path, `settings.get` with a key). Envelop those
 * as `{ result }` so `content.text` and `structuredContent` stay in sync
 * without breaking object payloads.
 */
export function ensureRecordContent(data: unknown): Record<string, unknown> {
  if (isPlainRecord(data)) return data;
  return { result: data ?? null };
}

export function jsonText(data: unknown, pretty = false): McpToolResult {
  const payload = ensureRecordContent(data);
  return {
    content: [
      {
        type: 'text',
        text: pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
  };
}

export function jsonError(message: string, extra?: unknown): McpToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: extra === undefined ? message : `${message}\n${JSON.stringify(extra)}`,
      },
    ],
  };
}
