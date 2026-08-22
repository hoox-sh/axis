// Copyright (c) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Datafeed gateway transport — resolves gateway URL and provides
 * `gatewayFetch` / `gatewayWs` helpers for plugins that route
 * through the PYNE Flask blueprint or local sidecar.
 *
 * Modes:
 * - `direct` — no gateway; use venue-native fetch (current behavior)
 * - `pyne` — route through PYNE Pro API `/datafeed/*`
 * - `sidecar` — route through local datafeed sidecar (port 5003)
 * - `auto` — prefer sidecar if reachable, else fall back to pyne
 *
 * @module data/gateway
 */

import type { ProviderGateway } from './provider';

export type GatewayMode = ProviderGateway | 'auto';

export const DATAFEED_DEFAULT_PORT = 5003;

/**
 * Product hosts where nginx terminates TLS and reverse-proxies Pro API routes
 * (including `/datafeed/`) to loopback :5002. Canonical list lives in
 * `workers/catalog` (`PRODUCT_SAME_ORIGIN_API_HOSTS`) — kept inline here so
 * this transport module stays dependency-free (importing workers/catalog
 * would pull plugins/loader into every catalog chunk).
 */
const PRODUCT_SAME_ORIGIN_HOSTS: readonly string[] = [
  'axis.hoox.sh',
  'pynescript.online',
  'www.pynescript.online',
  'server1.pynescript.online',
];

/** Product API origin used cross-origin by remote non-product pages (Pages previews). */
const PRODUCT_DATAFEED_ORIGIN = 'https://axis.hoox.sh';

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

/**
 * True when the given page origin is a non-loopback host (VPS demo, Pages…).
 * On such pages loopback gateway URLs point at the *visitor's* machine.
 */
export function isRemotePageOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  try {
    return !isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function currentPageOrigin(): string | undefined {
  try {
    return typeof location !== 'undefined' ? location.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Same-origin datafeed base for remote pages. Known product hosts proxy
 * `/datafeed/` themselves; other remote pages (Cloudflare Pages previews)
 * use the product API origin cross-origin (pyne allows those Origins).
 */
function remoteDatafeedBase(pageOrigin: string): string {
  try {
    const u = new URL(pageOrigin);
    const host = u.hostname.replace(/^www\./, '');
    const known = PRODUCT_SAME_ORIGIN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    return `${known ? u.origin : PRODUCT_DATAFEED_ORIGIN}/datafeed`;
  } catch {
    return `${PRODUCT_DATAFEED_ORIGIN}/datafeed`;
  }
}

// ---------------------------------------------------------------------------
// Auto-probe cache
// ---------------------------------------------------------------------------

let _sidecarOk: boolean | null = null;
let _sidecarProbeTs = 0;
const PROBE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Base URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the gateway base URL for the given mode.
 * Returns `null` for `direct` mode (caller should use venue-native fetch).
 *
 * Remote-page awareness (hardened VPS pattern): when the page origin is a
 * non-loopback host, loopback defaults would hit the *visitor's* machine —
 * `pyne`/`auto` resolve to the same-origin `/datafeed` (product hosts) or the
 * product API origin (Pages previews). Explicit `endpoint` always wins.
 *
 * @param pageOrigin - injectable for tests; defaults to `location.origin`
 */
export function gatewayBase(mode: GatewayMode, endpoint?: string, pageOrigin?: string): string | null {
  if (mode === 'direct') return null;
  const origin = pageOrigin ?? currentPageOrigin();
  const remote = isRemotePageOrigin(origin);
  if (mode === 'pyne') {
    if (endpoint) return `${endpoint}/datafeed`;
    if (remote && origin) return remoteDatafeedBase(origin);
    return 'http://127.0.0.1:5002/datafeed';
  }
  if (mode === 'sidecar') return `http://127.0.0.1:${DATAFEED_DEFAULT_PORT}`;
  // auto: prefer sidecar (local pages only), fall back to pyne
  if (!remote && _sidecarOk) return `http://127.0.0.1:${DATAFEED_DEFAULT_PORT}`;
  if (remote && origin) {
    return endpoint ? `${endpoint}/datafeed` : remoteDatafeedBase(origin);
  }
  return `${endpoint ?? 'http://127.0.0.1:5002'}/datafeed`;
}

// ---------------------------------------------------------------------------
// Sidecar probe
// ---------------------------------------------------------------------------

/** Probe the local sidecar `/health` endpoint. Cached for 30s. */
export async function probeSidecar(port = DATAFEED_DEFAULT_PORT): Promise<boolean> {
  if (Date.now() - _sidecarProbeTs < PROBE_TTL_MS && _sidecarOk !== null) return _sidecarOk;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    _sidecarOk = res.ok;
  } catch {
    _sidecarOk = false;
  }
  _sidecarProbeTs = Date.now();
  return _sidecarOk;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/**
 * Fetch from the datafeed gateway.
 * @throws if mode is `direct` (use venue-native fetch instead)
 */
export async function gatewayFetch(
  mode: GatewayMode,
  path: string,
  params?: Record<string, string>,
  endpoint?: string,
  pageOrigin?: string,
): Promise<Response> {
  const base = gatewayBase(mode, endpoint, pageOrigin);
  if (!base) throw new Error('Gateway mode is direct — use venue-native fetch instead');
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
}

/** RAM session body for `POST /session` — secrets in JSON, never query string. */
export type GatewaySessionBody = {
  exchange: string;
  credentialId: string;
  apiKey: string;
  secret: string;
  password?: string;
  uid?: string;
};

/**
 * Bind CCXT keys on the gateway. Do not log `body`.
 * Sidecar stores by `credentialId`; PYNE stores by `exchange`.
 */
export async function gatewayPutSession(
  mode: GatewayMode,
  body: GatewaySessionBody,
  endpoint?: string,
  pageOrigin?: string,
): Promise<void> {
  const base = gatewayBase(mode, endpoint, pageOrigin);
  if (!base) throw new Error('Gateway mode is direct — use venue-native fetch instead');
  const res = await fetch(`${base}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`gateway session ${res.status}`);
  }
}

export async function gatewayDeleteSession(
  mode: GatewayMode,
  credId: string,
  endpoint?: string,
  pageOrigin?: string,
): Promise<void> {
  const base = gatewayBase(mode, endpoint, pageOrigin);
  if (!base) return;
  const url = new URL(`${base}/session`);
  url.searchParams.set('cred', credId);
  url.searchParams.set('exchange', credId.startsWith('ccxt:') ? credId.slice(5) : credId);
  try {
    await fetch(url.toString(), { method: 'DELETE', signal: AbortSignal.timeout(10_000) });
  } catch {
    /* gateway down — local vault already dropped the key */
  }
}

// ---------------------------------------------------------------------------
// WebSocket helper
// ---------------------------------------------------------------------------

/**
 * Open a WebSocket to the datafeed gateway.
 * @throws if mode is `direct`
 */
export function gatewayWs(
  mode: GatewayMode,
  path: string,
  endpoint?: string,
  pageOrigin?: string,
): WebSocket {
  const base = gatewayBase(mode, endpoint, pageOrigin);
  if (!base) throw new Error('Gateway mode is direct — use venue-native WS');
  const httpBase = base.replace(/^http/, 'ws');
  return new WebSocket(`${httpBase}${path}`);
}
