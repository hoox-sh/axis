/**
 * Copyright (C) 2024-2026 jango_blockchained
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

export function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  const err: JsonRpcError = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: '2.0', id, error: err };
}

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

export type ParsedBody =
  | { ok: true; batch: false; request: JsonRpcRequest }
  | { ok: true; batch: true; requests: JsonRpcRequest[] }
  | { ok: false; response: JsonRpcResponse };

/**
 * Parse a JSON-RPC body (single or batch). Empty / invalid JSON → parse error.
 */
export function parseJsonRpc(raw: unknown): ParsedBody {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return { ok: false, response: rpcError(null, JSONRPC_INVALID_REQUEST, 'empty batch') };
    }
    const requests: JsonRpcRequest[] = [];
    for (const item of raw) {
      const req = asRequest(item);
      if (!req) {
        return { ok: false, response: rpcError(null, JSONRPC_INVALID_REQUEST, 'invalid batch item') };
      }
      requests.push(req);
    }
    return { ok: true, batch: true, requests };
  }
  const req = asRequest(raw);
  if (!req) {
    return { ok: false, response: rpcError(null, JSONRPC_INVALID_REQUEST, 'invalid JSON-RPC request') };
  }
  return { ok: true, batch: false, request: req };
}

export function parseJsonText(text: string): ParsedBody {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, response: rpcError(null, JSONRPC_PARSE, 'parse error') };
  }
  return parseJsonRpc(raw);
}

export function isNotification(req: JsonRpcRequest): boolean {
  return req.id === undefined;
}
