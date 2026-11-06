/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
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

import { partitionIdFromKey } from '../hash';

/** MCP protocol versions this server accepts. */
export const MCP_PROTOCOL_VERSIONS = ['2025-03-26', '2025-06-18', '2024-11-05'] as const;

/** Version we advertise when the client omits / sends an unknown one. */
export const MCP_PROTOCOL_VERSION = '2025-03-26';

/** Server name reported by `initialize`, the discovery doc, and `axis://capabilities`. */
export const MCP_SERVER_NAME = 'axis';

/** Request id: string, number, or `null` for the parse-error reply. */
export type JsonRpcId = string | number | null;

/** Inbound JSON-RPC request or notification (a notification omits `id`). */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

/** JSON-RPC error object; `code` is one of the `JSONRPC_*` constants. */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Outbound JSON-RPC reply — exactly one of `result` / `error` is set. */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

/** JSON-RPC 2.0: body was not valid JSON. */
export const JSONRPC_PARSE = -32700;
/** JSON-RPC 2.0: body parsed but is not a request object. */
export const JSONRPC_INVALID_REQUEST = -32600;
/** JSON-RPC 2.0: no handler for the method. */
export const JSONRPC_METHOD_NOT_FOUND = -32601;
/** JSON-RPC 2.0: method exists, arguments are wrong. */
export const JSONRPC_INVALID_PARAMS = -32602;
/** JSON-RPC 2.0: handler threw. */
export const JSONRPC_INTERNAL = -32603;

/** JSON Schema fragment used in tools/list. */
export type JsonSchema = Record<string, unknown>;

/**
 * A tool as advertised by `tools/list`.
 *
 * `plane` decides where the call runs: `worker` handles it in the Worker, `app`
 * requires a connected PWA session through `McpBridgeDO` (and fails when none is
 * attached).
 */
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Worker-only vs requires a connected PWA session. */
  plane: 'worker' | 'app';
}

/** A `resources/list` entry; `uri` is what `resources/read` accepts. */
export interface McpResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** A `prompts/list` entry and its declared arguments. */
export interface McpPromptDef {
  name: string;
  description: string;
  arguments?: Array<{ name: string; description: string; required?: boolean }>;
}

/** Plain-text tool content block. */
export interface McpTextContent {
  type: 'text';
  text: string;
}

/** Base64 image content block (screenshots from the app plane). */
export interface McpImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** Any content block a tool result may carry. */
export type McpContent = McpTextContent | McpImageContent;

/**
 * Result of `tools/call`.
 *
 * `isError` is the MCP-level failure signal (the JSON-RPC call itself still
 * succeeds), and `structuredContent` mirrors `content[0].text` as an object.
 */
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

/**
 * Reply from the PWA to an {@link AppInvokeRequest}.
 *
 * `id` must echo the request id so the bridge can settle the right waiter; `ok:
 * false` carries a code/message instead of a result.
 */
export interface AppInvokeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * How long an app-plane call waits for the PWA before answering with a timeout
 * error, in ms.
 */
export const APP_INVOKE_TIMEOUT_MS = 20_000;

/** First 32 hex chars of SHA-256(key) — same partition as Worker `userId`. */
export async function sessionIdFromApiKey(key: string): Promise<string> {
  return partitionIdFromKey(key);
}

/**
 * Chooses the protocol version to answer with.
 *
 * @param requested - Whatever the client sent in `initialize` params; any type is
 *   accepted because it comes from unparsed JSON.
 * @returns The requested version when supported, otherwise
 *   {@link MCP_PROTOCOL_VERSION}.
 */
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

/**
 * Wraps any tool payload as a successful {@link McpToolResult}.
 *
 * Non-object payloads (arrays, primitives) are enveloped by
 * {@link ensureRecordContent} so `structuredContent` is always a record, and the text
 * block is the same JSON so clients reading either stay in sync.
 *
 * @param data - Capability output; any JSON-serializable value.
 * @param pretty - Indent the text block by two spaces (human-facing output).
 */
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

/**
 * Builds a failed {@link McpToolResult} — `isError: true`, never a JSON-RPC error.
 *
 * @param message - Human-readable failure text, first line of the content block.
 * @param extra - Optional diagnostic value appended as JSON on a second line; omit
 *   rather than passing `null` to avoid a literal `null` suffix.
 */
export function toolError(message: string, extra?: unknown): McpToolResult {
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
