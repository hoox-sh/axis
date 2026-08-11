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
 * Health probes for AXIS Workers Manager.
 *
 * Pure-ish helpers (fetch / navigator) — no Solid. Safe for unit tests with mocks.
 *
 * @module workers/probe
 */

import { store } from '../store';
import { getEngine, LOCAL_PYODIDE_INDEX, resolvePyodideIndexUrl } from '../engines/catalog';
import {
  endpointsMatch,
  getWorkerCatalogEntry,
  listWorkerCatalog,
  normalizeWorkerBase,
  resolveProbeEndpoint,
} from './catalog';
import type {
  WorkerCatalogEntry,
  WorkerHealthStatus,
  WorkerId,
  WorkerProbeResult,
  WorkersOverviewSnapshot,
} from './types';

export interface ProbeWorkerOpts {
  /** Override base URL (else catalog default / local). */
  endpoint?: string;
  /** Fetch timeout ms (default 6000). */
  timeoutMs?: number;
  /** AbortSignal (e.g. modal close). Always combined with a hard timeout. */
  signal?: AbortSignal;
}

function activeEngineId(): string {
  return (store.engine || store.activePlugins?.engine || 'server').trim() || 'server';
}

/**
 * Hard timeout for every probe request, optionally merged with a parent abort
 * (modal close / refresh). Prevents endless “Probing…” when a shared signal
 * has no timeout and a host never responds.
 */
export function probeAbortSignal(
  timeoutMs: number,
  parent?: AbortSignal,
): AbortSignal {
  const raw = Number(timeoutMs);
  const ms =
    Number.isFinite(raw) && raw > 0
      ? Math.max(50, Math.floor(raw))
      : 6000;
  // Prefer a manual controller + timer — reliable in browser and Bun tests.
  // (AbortSignal.timeout is fine in browsers but some runtimes are flaky.)
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  }, ms);
  const onParentAbort = () => {
    clearTimeout(timer);
    try {
      ctrl.abort();
    } catch {
      /* ignore */
    }
  };
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  // Clear timer when we abort ourselves so we do not keep handles open
  ctrl.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return ctrl.signal;
}

function resolveTimeoutMs(opts?: ProbeWorkerOpts): number {
  return opts?.timeoutMs != null && Number.isFinite(opts.timeoutMs)
    ? Math.max(100, Math.floor(opts.timeoutMs))
    : 6000;
}

function baseResult(
  entry: WorkerCatalogEntry,
  partial: Partial<WorkerProbeResult> & Pick<WorkerProbeResult, 'status' | 'detail'>,
): WorkerProbeResult {
  const endpoint = partial.endpoint ?? entry.defaultEndpoint ?? '';
  const eng = activeEngineId();
  const isPyodide = eng === 'pyodide' || eng.includes('pyodide');
  let isActiveEngine = false;
  if (entry.id === 'pyodide') {
    isActiveEngine = isPyodide;
  } else if (entry.canUseAsBackend && !isPyodide) {
    isActiveEngine =
      eng === 'server' &&
      !!endpoint &&
      endpointsMatch(store.endpoint, endpoint);
  }
  return {
    id: entry.id,
    status: partial.status,
    latencyMs: partial.latencyMs ?? null,
    detail: partial.detail,
    endpoint,
    features: partial.features ?? {},
    service: partial.service ?? null,
    checkedAt: partial.checkedAt ?? Date.now(),
    error: partial.error ?? null,
    isActiveBackend:
      partial.isActiveBackend ??
      (!!endpoint && endpointsMatch(store.endpoint, endpoint)),
    isActiveEngine: partial.isActiveEngine ?? isActiveEngine,
  };
}

/**
 * Probe one catalog entry.
 * Hard wall-clock cap so a hung `fetch` (or ignore-abort mocks) cannot block forever.
 */
export async function probeWorker(
  id: WorkerId,
  opts?: ProbeWorkerOpts,
): Promise<WorkerProbeResult> {
  const timeoutMs = resolveTimeoutMs(opts);
  const entry = getWorkerCatalogEntry(id);

  const run = async (): Promise<WorkerProbeResult> => {
    if (!entry) {
      return {
        id,
        status: 'unknown',
        latencyMs: null,
        detail: 'Unknown worker id',
        endpoint: '',
        features: {},
        service: null,
        checkedAt: Date.now(),
        error: 'not in catalog',
        isActiveBackend: false,
        isActiveEngine: false,
      };
    }

    if (entry.probe === 'none') {
      return baseResult(entry, {
        status: 'skipped',
        detail: 'No automatic probe — configure endpoint manually if you deploy this worker.',
        endpoint: opts?.endpoint || entry.defaultEndpoint || '',
      });
    }

    if (entry.probe === 'pyodide') {
      return probePyodide(entry, opts);
    }

    if (entry.probe === 'service-worker') {
      return probeServiceWorker(entry);
    }

    // http-health — resolve loopback vs public reverse-proxy (hardened VPS)
    let pageOrigin = '';
    try {
      if (typeof window !== 'undefined' && window.location?.origin) {
        pageOrigin = window.location.origin;
      }
    } catch {
      /* non-DOM */
    }
    const endpoint = resolveProbeEndpoint(entry, {
      endpoint: opts?.endpoint,
      activeEndpoint: store.endpoint,
      pageOrigin,
    });
    if (!endpoint) {
      return baseResult(entry, {
        status: 'unknown',
        detail: 'No endpoint configured',
        endpoint: '',
      });
    }

    return probeHttpHealth(entry, endpoint, opts);
  };

  // Belt-and-suspenders: some environments ignore AbortSignal on fetch.
  const timedOut: Promise<WorkerProbeResult> = new Promise((resolve) => {
    const t = setTimeout(() => {
      resolve(
        entry
          ? baseResult(entry, {
              status: 'down',
              detail: 'Timeout',
              endpoint:
                opts?.endpoint ||
                entry.defaultEndpoint ||
                entry.localEndpoint ||
                '',
              error: 'Timeout',
            })
          : {
              id,
              status: 'down',
              latencyMs: null,
              detail: 'Timeout',
              endpoint: '',
              features: {},
              service: null,
              checkedAt: Date.now(),
              error: 'Timeout',
              isActiveBackend: false,
              isActiveEngine: false,
            },
      );
    }, timeoutMs + 250);
    opts?.signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve(
          entry
            ? baseResult(entry, {
                status: 'down',
                detail: 'Aborted',
                endpoint:
                  opts?.endpoint ||
                  entry.defaultEndpoint ||
                  entry.localEndpoint ||
                  '',
                error: 'Aborted',
              })
            : {
                id,
                status: 'down',
                latencyMs: null,
                detail: 'Aborted',
                endpoint: '',
                features: {},
                service: null,
                checkedAt: Date.now(),
                error: 'Aborted',
                isActiveBackend: false,
                isActiveEngine: false,
              },
        );
      },
      { once: true },
    );
  });

  return Promise.race([run(), timedOut]);
}

async function probeHttpHealth(
  entry: WorkerCatalogEntry,
  endpoint: string,
  opts?: ProbeWorkerOpts,
): Promise<WorkerProbeResult> {
  const timeoutMs = resolveTimeoutMs(opts);
  // One budget for all paths so a dead host does not take N × timeoutMs
  const signal = probeAbortSignal(timeoutMs, opts?.signal);
  const paths = entry.healthPaths?.length ? entry.healthPaths : ['/health', '/'];
  const markers = entry.healthMarkers || ['status', 'service', 'endpoints'];
  const t0 = performance.now();

  let lastStatus = 0;
  let lastErr: string | null = null;

  for (const path of paths) {
    if (signal.aborted) {
      lastErr = lastErr || 'Timeout';
      break;
    }
    const url = `${endpoint}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        signal,
        headers: { Accept: 'application/json' },
      });
      lastStatus = res.status;
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      let body: Record<string, unknown> | null = null;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        lastErr = 'Non-JSON response (SPA shell?)';
        continue;
      }
      const hasMarker = markers.some((m) => body != null && body[m] != null);
      if (!hasMarker) {
        lastErr = 'JSON without health markers';
        continue;
      }

      const ms = Math.round(performance.now() - t0);
      const service =
        typeof body.service === 'string'
          ? body.service
          : typeof body.name === 'string'
            ? body.name
            : null;

      const features: Record<string, boolean | string | number | null> = {};
      if (body.features && typeof body.features === 'object') {
        for (const [k, v] of Object.entries(body.features as Record<string, unknown>)) {
          if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') {
            features[k] = v;
          } else if (v == null) {
            features[k] = null;
          } else {
            features[k] = String(v);
          }
        }
      }
      if (typeof body.websocket === 'boolean') features.websocket = body.websocket;
      if (typeof body.status === 'string') features.status = body.status;
      if (typeof body.version === 'string') features.version = body.version;

      let status: WorkerHealthStatus = 'healthy';
      const statusStr = String(body.status || '').toLowerCase();
      if (statusStr && statusStr !== 'healthy' && statusStr !== 'ok') {
        status = statusStr === 'degraded' ? 'degraded' : 'degraded';
      }
      // Soft-check service hint
      if (
        entry.serviceHint &&
        service &&
        !service.toLowerCase().includes(entry.serviceHint.toLowerCase())
      ) {
        // Still OK if markers matched — note in detail
      }

      const featureBits = Object.keys(features).length
        ? ` · ${Object.entries(features)
            .slice(0, 6)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}`
        : '';

      return baseResult(entry, {
        status,
        latencyMs: ms,
        detail: `${service || 'reachable'}${featureBits}`,
        endpoint,
        features,
        service,
        error: null,
      });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      lastErr = /abort/i.test(raw) ? 'Timeout' : raw;
    }
  }

  const ms = Math.round(performance.now() - t0);
  return baseResult(entry, {
    status: 'down',
    latencyMs: ms,
    detail: lastErr || (lastStatus ? `HTTP ${lastStatus}` : 'Unreachable'),
    endpoint,
    error: lastErr || `HTTP ${lastStatus || '?'}`,
  });
}

async function probePyodide(
  entry: WorkerCatalogEntry,
  opts?: ProbeWorkerOpts,
): Promise<WorkerProbeResult> {
  const t0 = performance.now();
  const timeoutMs = resolveTimeoutMs(opts);
  const signal = probeAbortSignal(timeoutMs, opts?.signal);
  const eng = getEngine('pyodide');
  const indexUrl = resolvePyodideIndexUrl(LOCAL_PYODIDE_INDEX);
  const features: Record<string, boolean | string | number | null> = {
    indexUrl,
  };
  const assetUrl = `${indexUrl}pyodide.js`;

  // Quick asset check — HEAD first (no full download). Full GET of pyodide.js
  // was hanging Workers Manager probes for tens of seconds.
  try {
    let res = await fetch(assetUrl, {
      method: 'HEAD',
      signal,
      credentials: 'same-origin',
    });
    // Some static hosts reject HEAD — fall back to a short GET that we abort
    // after headers via the same timeout budget (do not await full body).
    if (!res.ok && (res.status === 405 || res.status === 501 || res.status === 403)) {
      res = await fetch(assetUrl, {
        method: 'GET',
        signal,
        credentials: 'same-origin',
      });
      // Drop body immediately so we never wait on multi‑MB download
      try {
        res.body?.cancel?.();
      } catch {
        /* ignore */
      }
    }
    features.assetOk = res.ok;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      return baseResult(entry, {
        status: 'down',
        latencyMs: Math.round(performance.now() - t0),
        detail: 'pyodide.js returned HTML (SPA fallback) — deploy public/pyodide into dist/',
        endpoint: indexUrl,
        features,
        error: 'SPA fallback',
      });
    }
    if (!res.ok) {
      return baseResult(entry, {
        status: 'down',
        latencyMs: Math.round(performance.now() - t0),
        detail: `pyodide.js HTTP ${res.status}`,
        endpoint: indexUrl,
        features,
        error: `HTTP ${res.status}`,
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return baseResult(entry, {
      status: 'down',
      latencyMs: Math.round(performance.now() - t0),
      detail: `Assets unreachable: ${/abort/i.test(msg) ? 'Timeout' : msg}`,
      endpoint: indexUrl,
      features,
      error: /abort/i.test(msg) ? 'Timeout' : msg,
    });
  }

  // Runtime ready? Cap isReady so a stuck engine never freezes the manager.
  let ready = false;
  try {
    if (eng && typeof eng.isReady === 'function') {
      ready = await Promise.race([
        Promise.resolve(eng.isReady()).then(Boolean),
        new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), Math.min(1500, timeoutMs));
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              resolve(false);
            },
            { once: true },
          );
        }),
      ]);
    }
  } catch {
    ready = false;
  }
  // Internal warm flag if present
  const py = eng as { _pyodide?: unknown } | undefined;
  const loaded = !!(py && py._pyodide);
  features.runtimeReady = ready || loaded;
  features.loaded = loaded;

  const ms = Math.round(performance.now() - t0);
  if (ready || loaded) {
    return baseResult(entry, {
      status: 'healthy',
      latencyMs: ms,
      detail: 'Pyodide runtime ready',
      endpoint: indexUrl,
      features,
    });
  }
  return baseResult(entry, {
    status: 'idle',
    latencyMs: ms,
    detail: 'Assets OK · runtime not loaded yet (preload or first Run)',
    endpoint: indexUrl,
    features,
  });
}

async function probeServiceWorker(entry: WorkerCatalogEntry): Promise<WorkerProbeResult> {
  const t0 = performance.now();
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return baseResult(entry, {
      status: 'skipped',
      detail: 'Service workers not supported in this environment',
      features: { supported: false },
    });
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const ms = Math.round(performance.now() - t0);
    const controlled = !!navigator.serviceWorker.controller;
    const features: Record<string, boolean | string | number | null> = {
      registered: !!reg,
      controlled,
      active: !!reg?.active,
      waiting: !!reg?.waiting,
      installing: !!reg?.installing,
      scope: reg?.scope || null,
    };

    if (!reg) {
      // Dev / Tauri intentionally skip registration
      const isDev =
        typeof import.meta !== 'undefined' &&
        Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
      return baseResult(entry, {
        status: isDev ? 'skipped' : 'idle',
        latencyMs: ms,
        detail: isDev
          ? 'Not registered in Vite dev (expected)'
          : 'No registration — open a production build or hard-reload',
        features,
      });
    }

    if (controlled || reg.active) {
      return baseResult(entry, {
        status: 'healthy',
        latencyMs: ms,
        detail: controlled
          ? `Active · scope ${reg.scope || '/'}`
          : `Registered (waiting for control) · ${reg.scope || '/'}`,
        features,
      });
    }

    return baseResult(entry, {
      status: 'degraded',
      detail: 'Registration present but no active worker',
      latencyMs: ms,
      features,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return baseResult(entry, {
      status: 'down',
      detail: msg,
      error: msg,
      latencyMs: Math.round(performance.now() - t0),
    });
  }
}

/**
 * Probe all catalog workers in parallel.
 * Uses {@link Promise.allSettled} so one throw cannot leave the UI probing forever.
 * Each worker gets its own hard timeout (merged with the parent signal).
 */
export async function probeAllWorkers(opts?: {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Optional endpoint overrides by id. */
  endpoints?: Partial<Record<WorkerId, string>>;
}): Promise<WorkersOverviewSnapshot> {
  const entries = listWorkerCatalog();
  const checkedAt = Date.now();
  const timeoutMs = opts?.timeoutMs ?? 6000;

  const settled = await Promise.allSettled(
    entries.map((e) =>
      probeWorker(e.id, {
        timeoutMs,
        signal: opts?.signal,
        endpoint: opts?.endpoints?.[e.id],
      }),
    ),
  );

  const results: WorkerProbeResult[] = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const entry = entries[i]!;
    const msg =
      s.reason instanceof Error ? s.reason.message : String(s.reason ?? 'probe failed');
    return {
      id: entry.id,
      status: 'down' as const,
      latencyMs: null,
      detail: msg,
      endpoint: entry.defaultEndpoint || entry.localEndpoint || '',
      features: {},
      service: null,
      checkedAt: Date.now(),
      error: msg,
      isActiveBackend: false,
      isActiveEngine: false,
    };
  });

  const healthy = results.filter((r) => r.status === 'healthy').length;
  const degraded = results.filter((r) => r.status === 'degraded').length;
  const down = results.filter((r) => r.status === 'down').length;
  const unknown = results.filter(
    (r) => r.status === 'unknown' || r.status === 'idle' || r.status === 'skipped',
  ).length;

  return { results, healthy, degraded, down, unknown, checkedAt };
}

/** Human label for health status. */
export function workerHealthLabel(s: WorkerHealthStatus): string {
  switch (s) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'down':
      return 'Down';
    case 'idle':
      return 'Idle';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Unknown';
  }
}
