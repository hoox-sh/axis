/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * AXIS MCP app-plane envelope (PWA copy).
 *
 * @module mcp/protocol
 */

/**
 * Envelope the Worker sends down the MCP bridge to ask one PWA tab to run a capability.
 * Crosses the Worker → app boundary, so `payload` is untrusted until dispatch validates it.
 */
export interface AppInvokeRequest {
  id: string;
  capability: string;
  payload?: unknown;
}

/**
 * App-plane reply for a single {@link AppInvokeRequest}; `ok: false` carries a machine
 * `code` plus a human `message` that the Worker maps onto a JSON-RPC error.
 */
export interface AppInvokeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * One entry of the advertised capability catalog: the id MCP clients call, its domain
 * grouping, a description used for tool docs, and whether the call mutates app state.
 */
export interface CapabilitySpec {
  id: string;
  domain: string;
  description: string;
  mutates: boolean;
}

/**
 * Derives the bridge partition id from an API key so the Worker and the PWA agree on a
 * session without ever transmitting the raw key in the session id.
 *
 * @param key `pn_…` API key from Settings → Storage.
 * @returns First 32 hex chars of the SHA-256 digest of the key's UTF-8 bytes.
 */
export async function sessionIdFromApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * Resolves a dotted snapshot path such as `live.active` or `symbol` against a sanitized
 * snapshot; missing or non-object intermediates yield `undefined` instead of throwing.
 *
 * @param obj Snapshot or state slice to read from.
 * @param path Dotted path; an empty path returns `obj` itself.
 * @returns The value at `path`, or `undefined` when any segment is absent.
 */
export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Capability failure carrying a stable JSON-RPC-ish `code`, so dispatch can distinguish
 * "unknown capability" or "invalid payload" from an unexpected runtime throw.
 */
export class McpInvokeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'McpInvokeError';
  }
}
