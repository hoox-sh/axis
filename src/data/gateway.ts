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
 */
export function gatewayBase(mode: GatewayMode, endpoint?: string): string | null {
  if (mode === 'direct') return null;
  if (mode === 'pyne') return `${endpoint ?? 'http://127.0.0.1:5002'}/datafeed`;
  if (mode === 'sidecar') return `http://127.0.0.1:${DATAFEED_DEFAULT_PORT}`;
  // auto: prefer sidecar, fall back to pyne
  if (_sidecarOk) return `http://127.0.0.1:${DATAFEED_DEFAULT_PORT}`;
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
): Promise<Response> {
  const base = gatewayBase(mode, endpoint);
  if (!base) throw new Error('Gateway mode is direct — use venue-native fetch instead');
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
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
): WebSocket {
  const base = gatewayBase(mode, endpoint);
  if (!base) throw new Error('Gateway mode is direct — use venue-native WS');
  const httpBase = base.replace(/^http/, 'ws');
  return new WebSocket(`${httpBase}${path}`);
}
