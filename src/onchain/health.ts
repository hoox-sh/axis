// Copyright (C) 2024-2026 jango_blockchained
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
 * Lightweight health probe for the AXIS Worker on-chain proxy.
 *
 * Pings `GET {endpoint}/api/onchain/health` and optionally mirrors the result
 * onto the Connection HUD `telemetry.onchain` plane.
 *
 * @module onchain/health
 */

import { store, setTelemetryPlane, setTelemetryState } from '../store';
import { normalizeEndpointBase } from './proxy';

/** Worker path for on-chain proxy feature flags / provider list. */
export const ONCHAIN_HEALTH_PATH = '/api/onchain/health';

/** Min wall time between full health probes (ms). */
const PROBE_MIN_INTERVAL_MS = 12_000;

export interface OnchainProxyHealthResult {
  ok: boolean;
  /** Provider ids advertised by the worker (e.g. `defillama`, `geckoterminal`). */
  providers: string[];
  /** Short human status for HUD `detail` / errors. */
  detail: string;
}

export interface CheckOnchainProxyHealthOpts {
  /** Override store.endpoint. */
  endpoint?: string | null;
  /** Optional abort. */
  signal?: AbortSignal;
  /** Fetch timeout ms (default 5000). */
  timeoutMs?: number;
}

/**
 * Probe Worker on-chain health. Does **not** update telemetry by itself —
 * use {@link refreshOnchainTelemetry} for HUD wiring.
 */
export async function checkOnchainProxyHealth(
  opts?: CheckOnchainProxyHealthOpts,
): Promise<OnchainProxyHealthResult> {
  let endpoint = '';
  try {
    endpoint = normalizeEndpointBase(opts?.endpoint ?? store.endpoint);
  } catch {
    endpoint = '';
  }

  if (!endpoint) {
    return {
      ok: false,
      providers: [],
      detail: 'No engine endpoint — set Worker base for /api/onchain proxy',
    };
  }

  const url = `${endpoint}${ONCHAIN_HEALTH_PATH}`;
  const timeoutMs =
    opts?.timeoutMs != null && Number.isFinite(opts.timeoutMs)
      ? Math.max(500, Math.floor(opts.timeoutMs))
      : 5000;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) {
      return { ok: false, providers: [], detail: 'Aborted' };
    }
    opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        ok: false,
        providers: [],
        detail: `On-chain health HTTP ${res.status}`,
      };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, providers: [], detail: 'On-chain health: invalid JSON' };
    }

    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const status = String(rec.status || '').toLowerCase();
    const providers = parseProviderIds(rec.providers);
    const healthy = status === 'healthy' || status === 'ok' || res.status === 200;

    if (!healthy) {
      return {
        ok: false,
        providers,
        detail: status
          ? `On-chain proxy status: ${status}`
          : 'On-chain proxy unhealthy',
      };
    }

    const label =
      providers.length > 0
        ? `proxy · ${providers.join('+')}`
        : 'proxy · healthy';

    return { ok: true, providers, detail: label };
  } catch (err) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? `On-chain health timeout (${timeoutMs}ms)`
        : err instanceof Error && err.message
          ? err.message
          : 'On-chain health failed';
    return { ok: false, providers: [], detail: msg };
  } finally {
    clearTimeout(timer);
    if (opts?.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

function parseProviderIds(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (typeof x === 'string') return x.trim();
        if (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string') {
          return String((x as { id: string }).id).trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  return Object.keys(raw as Record<string, unknown>).filter(Boolean).sort();
}

let probeInFlight: Promise<OnchainProxyHealthResult> | null = null;
let lastProbeAt = 0;
let lastProbeKey = '';

/**
 * Non-blocking health probe that updates `telemetry.onchain`.
 * Coalesces concurrent calls and rate-limits successful open probes.
 */
export function kickOnchainHealthProbe(): void {
  void refreshOnchainTelemetry({ force: false });
}

/**
 * Run health check and set Connection HUD onchain plane (open / error).
 */
export async function refreshOnchainTelemetry(opts?: {
  force?: boolean;
  endpoint?: string | null;
  signal?: AbortSignal;
}): Promise<OnchainProxyHealthResult> {
  let endpoint = '';
  try {
    endpoint = normalizeEndpointBase(opts?.endpoint ?? store.endpoint);
  } catch {
    endpoint = '';
  }
  const key = endpoint || '(none)';
  const now = Date.now();
  const force = opts?.force === true;

  if (probeInFlight && !force) {
    return probeInFlight;
  }

  const plane = store.telemetry?.onchain;
  if (
    !force &&
    plane?.state === 'open' &&
    key === lastProbeKey &&
    now - lastProbeAt < PROBE_MIN_INTERVAL_MS
  ) {
    return {
      ok: true,
      providers: [],
      detail: plane.detail || 'proxy · healthy',
    };
  }

  setTelemetryPlane('onchain', {
    id: 'onchain-proxy',
    name: 'On-chain',
    transport: 'rest',
    state: 'connecting',
    detail: endpoint ? 'health…' : 'no endpoint',
    error: null,
  });

  const run = (async (): Promise<OnchainProxyHealthResult> => {
    const t0 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    const result = await checkOnchainProxyHealth({
      endpoint: opts?.endpoint,
      signal: opts?.signal,
    });
    const t1 =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    const latencyMs = Math.max(0, Math.round(t1 - t0));

    if (result.ok) {
      setTelemetryState('onchain', 'open', {
        id: 'onchain-proxy',
        name: 'On-chain',
        transport: 'rest',
        detail: result.detail,
        latencyMs,
        error: null,
      });
    } else {
      setTelemetryState('onchain', 'error', {
        id: 'onchain-proxy',
        name: 'On-chain',
        transport: 'rest',
        detail: result.detail,
        latencyMs,
        error: result.detail,
      });
    }

    lastProbeAt = Date.now();
    lastProbeKey = key;
    return result;
  })();

  probeInFlight = run;
  try {
    return await run;
  } finally {
    if (probeInFlight === run) probeInFlight = null;
  }
}

/** @internal test helper */
export function _resetOnchainHealthProbeState(): void {
  probeInFlight = null;
  lastProbeAt = 0;
  lastProbeKey = '';
}
