/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Global `fetch` mock helpers for catalog/engine/storage tests.
 *
 * {@link mockFetch} installs a handler and returns a restore function —
 * always call restore in `afterEach` to avoid cross-test leakage.
 * {@link jsonResponse} builds a JSON `Response` with application/json.
 */

export type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> | Response;

const originalFetch = globalThis.fetch;

/**
 * Replace `globalThis.fetch` with `handler`.
 * @returns restore function that reinstalls the previous fetch
 */
export function mockFetch(handler: FetchHandler): () => void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    return handler(input, init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/** Convenience JSON response (default status 200). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
