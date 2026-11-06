/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * JSON-RPC 2.0 parse + response helpers for Streamable HTTP MCP.
 *
 * @module worker/mcp/jsonrpc
 */

import {
  JSONRPC_INVALID_REQUEST,
  JSONRPC_PARSE,
  type JsonRpcError,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './protocol';

/**
 * Builds a JSON-RPC error reply.
 *
 * @param id - Echo of the request id, or `null` when the id could not be parsed.
 * @param code - JSON-RPC code (`JSONRPC_PARSE`, `JSONRPC_INVALID_REQUEST`, …).
 * @param message - Short, client-safe description.
 * @param data - Optional structured detail; omitted from the payload when undefined.
 */
export function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  const err: JsonRpcError = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id, error: err };
}

/**
 * Builds a JSON-RPC success reply.
 *
 * @param id - Echo of the request id.
 * @param result - Method result; serialized as-is, so it must be JSON-safe.
 */
export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function asRequest(raw: unknown): JsonRpcRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.jsonrpc !== '2.0') return null;
  if (typeof o.method !== 'string' || !o.method) return null;
  const req: JsonRpcRequest = { jsonrpc: '2.0', method: o.method };
  if ('id' in o) {
    const id = o.id;
    if (id !== null && typeof id !== 'string' && typeof id !== 'number') return null;
    req.id = id;
  }
  if ('params' in o) req.params = o.params;
  return req;
}

/**
 * Result of parsing a request body.
 *
 * On failure the ready-made error `response` is returned instead of throwing, so the
 * handler can answer a malformed body without a try/catch.
 */
export type ParsedBody =
  | { ok: true; batch: false; request: JsonRpcRequest }
  | { ok: true; batch: true; requests: JsonRpcRequest[] }
  | { ok: false; response: JsonRpcResponse };

/** Max JSON-RPC requests in one HTTP POST. */
export const MCP_MAX_BATCH = 10;

/**
 * Parse a JSON-RPC body (single or batch). Empty / invalid JSON → parse error.
 */
export function parseJsonRpc(raw: unknown): ParsedBody {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return { ok: false, response: rpcError(null, JSONRPC_INVALID_REQUEST, 'empty batch') };
    }
    if (raw.length > MCP_MAX_BATCH) {
      return {
        ok: false,
        response: rpcError(null, JSONRPC_INVALID_REQUEST, `batch exceeds ${MCP_MAX_BATCH} items`),
      };
    }
    const requests: JsonRpcRequest[] = [];
    for (const item of raw) {
      const req = asRequest(item);
      if (!req) {
        return {
          ok: false,
          response: rpcError(null, JSONRPC_INVALID_REQUEST, 'invalid batch item'),
        };
      }
      requests.push(req);
    }
    return { ok: true, batch: true, requests };
  }
  const req = asRequest(raw);
  if (!req) {
    return {
      ok: false,
      response: rpcError(null, JSONRPC_INVALID_REQUEST, 'invalid JSON-RPC request'),
    };
  }
  return { ok: true, batch: false, request: req };
}

/**
 * Parses raw request text, mapping a JSON syntax error to `-32700`.
 *
 * Kept separate from {@link parseJsonRpc} so the MCP plane can distinguish "not
 * JSON" from "JSON but not a request" when choosing the error code.
 *
 * @param text - Raw body, already size-capped by the caller.
 * @returns The parsed request(s), or a ready error response.
 */
export function parseJsonText(text: string): ParsedBody {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, response: rpcError(null, JSONRPC_PARSE, 'parse error') };
  }
  return parseJsonRpc(raw);
}

/**
 * True when the request is a notification (no `id`) and so must not be answered.
 *
 * @param req - Parsed JSON-RPC request.
 */
export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined;
}
