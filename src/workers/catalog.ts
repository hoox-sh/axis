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
 * Canonical catalog of AXIS-related workers and runtimes.
 *
 * Used by the Workers Manager modal for overview, install helpers, and probes.
 * Keep production defaults aligned with `onchain/proxy.ts` and plugin loader.
 *
 * @module workers/catalog
 */

import { DEFAULT_ONCHAIN_WORKER_BASE } from '../onchain/proxy';
import { DEFAULT_PYNE_AGENT_PLUGIN_URL } from '../plugins/loader';
import type { WorkerCatalogEntry, WorkerId } from './types';

/** Production AXIS Cloudflare Worker (workers.dev). */
export const DEFAULT_AXIS_WORKER_BASE = DEFAULT_ONCHAIN_WORKER_BASE;

/** Local wrangler default for `worker/` package. */
export const LOCAL_AXIS_WORKER_BASE = 'http://127.0.0.1:8787';

/** Default pyne Pro API (Flask). */
export const DEFAULT_PYNE_PRO_BASE = 'http://127.0.0.1:5002';

/** Production / common pyne Pro host when AXIS is served with same-origin API. */
export const PRODUCT_PYNE_PRO_HINT = 'https://axis.hoox.sh';

/**
 * Hostnames where nginx (or similar) terminates TLS and reverse-proxies Pro API
 * routes (`/health`, `/run`, `/ws/…`) while UFW keeps :5002 loopback-only.
 */
export const PRODUCT_SAME_ORIGIN_API_HOSTS: readonly string[] = [
  'axis.hoox.sh',
  'pynescript.online',
  'www.pynescript.online',
  'server1.pynescript.online',
];

/** True when origin/host is a known product AXIS + Pro API same-origin deployment. */
export function isProductSameOriginApiHost(raw: string | undefined | null): boolean {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return false;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./, '');
    return PRODUCT_SAME_ORIGIN_API_HOSTS.some(
      (h) => host === h || host.endsWith(`.${h}`),
    );
  } catch {
    return PRODUCT_SAME_ORIGIN_API_HOSTS.some((h) => s.includes(h));
  }
}

/** True when base is loopback (browser probes hit the *user's* machine, not the VPS). */
export function isLoopbackBase(raw: string | undefined | null): boolean {
  const s = String(raw || '').toLowerCase();
  return (
    s.includes('127.0.0.1') ||
    s.includes('localhost') ||
    s.includes('[::1]') ||
    s.includes('0.0.0.0')
  );
}

/** PYNE Agent worker origin (plugin host). */
export function pyneAgentWorkerOrigin(): string {
  try {
    return new URL(DEFAULT_PYNE_AGENT_PLUGIN_URL).origin;
  } catch {
    return 'https://pyne-agent-worker.cryptolinx.workers.dev';
  }
}

/**
 * Static catalog — order is display order in the manager.
 * Optional entries (agent, pyne-worker edge) sit after core paths.
 */
export const WORKER_CATALOG: readonly WorkerCatalogEntry[] = [
  {
    id: 'pyne-pro',
    name: 'pyne Pro API',
    summary: 'CPython ± Numba calculation backend (Flask)',
    description:
      'Long-lived process that evaluates Pine Script™ via the pyne Pro API. ' +
      'AXIS server engine prefers WebSocket `/ws/run`, then `POST /run`. ' +
      'Best for compile mode (Numba) and large history. Default local port is 5002.',
    usage:
      'Primary calculation backend for Run / Re-run when engine is Server. ' +
      'Local: Backend URL http://127.0.0.1:5002 (UFW should keep :5002 loopback-only). ' +
      'Production VPS (axis.hoox.sh): same-origin https://axis.hoox.sh — nginx proxies /health and /run; do not open :5002 publicly. ' +
      'Prefer this for compile/Numba and long histories.',
    icon: 'server',
    kind: 'process',
    roles: ['calc'],
    defaultEndpoint: DEFAULT_PYNE_PRO_BASE,
    localEndpoint: DEFAULT_PYNE_PRO_BASE,
    /** Public same-origin Pro API (nginx → loopback :5002). Used by browser probes off-VPS. */
    publicEndpoint: PRODUCT_PYNE_PRO_HINT,
    docsPath: '/axis/docs/plugins/engines',
    homepage: 'https://hoox.sh/pyne',
    canUseAsBackend: true,
    probe: 'http-health',
    healthPaths: ['/health', '/'],
    healthMarkers: ['endpoints', 'status', 'service', 'websocket', 'compile'],
    serviceHint: 'pyne',
    capabilities: ['WS /ws/run', 'POST /run', 'interpret', 'compile', 'Numba'],
    install: [
      {
        title: 'Clone / open pyne',
        detail:
          'Sister repo pynescript (local path often ../pynescript or GitHub hoox-sh/pyne).',
        command: 'cd ../pynescript   # or your pyne checkout',
      },
      {
        title: 'Start Pro API (loopback)',
        detail:
          'Bind gunicorn/Flask to 127.0.0.1:5002 only. UFW should NOT allow 5002/tcp from the internet.',
        command: 'make run   # listen 127.0.0.1:5002',
      },
      {
        title: 'Point AXIS at it (local)',
        detail: 'Workers Manager → Use as backend, or Settings → Backend URL.',
        command: 'http://127.0.0.1:5002',
      },
      {
        title: 'Production VPS (hardened)',
        detail:
          'nginx :443 proxies /health, /run, /ws/ to loopback :5002. Public health = https://axis.hoox.sh/health. UFW: allow 22,443 only.',
        command: 'https://axis.hoox.sh',
      },
      {
        title: 'CORS',
        detail:
          'If AXIS origin differs from the API host, set ALLOWED_ORIGINS on the Pro API to include this page origin. Same-origin nginx avoids CORS.',
      },
    ],
  },
  {
    id: 'axis-worker',
    name: 'AXIS Worker',
    summary: 'Cloudflare edge data plane (run proxy, on-chain, scripts)',
    description:
      'The AXIS Cloudflare Worker (`pynescript-axis`) is the edge data plane: ' +
      'allowlisted on-chain proxy, optional script library (D1), API keys (KV), ' +
      '`POST /api/run` (typically proxies to EXTERNAL_BACKEND), Git OAuth relay, ' +
      'and Durable Object stream sessions. Production default is workers.dev.',
    usage:
      'Always on for On-Chain (DefiLlama / GeckoTerminal proxy) and cloud script library. ' +
      'Optionally set as calculation backend if EXTERNAL_BACKEND is bound on the Worker. ' +
      'You do not need a local install — production workers.dev is the default.',
    icon: 'zap',
    kind: 'edge',
    roles: ['proxy', 'onchain', 'scripts', 'stream', 'oauth', 'calc'],
    defaultEndpoint: DEFAULT_AXIS_WORKER_BASE,
    docsPath: '/axis/docs/worker',
    homepage: 'https://hoox.sh/axis',
    canUseAsBackend: true,
    probe: 'http-health',
    healthPaths: ['/health', '/'],
    healthMarkers: ['status', 'service', 'features'],
    serviceHint: 'pynescript-axis-worker',
    capabilities: [
      'GET /health',
      'POST /api/run',
      'GET /api/onchain/*',
      'WS /api/stream',
      'scripts D1',
      'Git OAuth',
    ],
    install: [
      {
        title: 'Production (default)',
        detail: 'Use the deployed workers.dev host — no local install required.',
        command: DEFAULT_AXIS_WORKER_BASE,
      },
      {
        title: 'On-chain without custom deploy',
        detail:
          'On-chain panel already defaults to this Worker for DefiLlama / GeckoTerminal proxy.',
      },
      {
        title: 'As calculation backend',
        detail:
          'Use as backend sets server engine endpoint. Worker `/api/run` may need EXTERNAL_BACKEND (Flask) on the edge.',
        command: `${DEFAULT_AXIS_WORKER_BASE}/api`,
      },
    ],
  },
  {
    id: 'axis-worker-local',
    name: 'AXIS Worker (local)',
    summary: 'wrangler dev on :8787',
    description:
      'Local Cloudflare Worker via wrangler for developing the data plane. ' +
      'Same routes as production; bindings may be stubs. Use when iterating on ' +
      'on-chain proxy, run proxy, or DO stream without deploying.',
    usage:
      'Local edge loop: `cd worker && bun run dev`, then Use as calculation backend ' +
      'or point On-Chain / Backend URL at http://127.0.0.1:8787. ' +
      'Skip this card if you only use production workers.dev.',
    icon: 'activity',
    kind: 'edge',
    roles: ['proxy', 'onchain', 'scripts', 'stream', 'oauth', 'calc'],
    defaultEndpoint: LOCAL_AXIS_WORKER_BASE,
    localEndpoint: LOCAL_AXIS_WORKER_BASE,
    docsPath: '/axis/docs/devops/local-dev',
    canUseAsBackend: true,
    probe: 'http-health',
    healthPaths: ['/health', '/'],
    healthMarkers: ['status', 'service', 'features'],
    serviceHint: 'pynescript-axis-worker',
    capabilities: ['wrangler', 'GET /health', 'on-chain proxy', 'POST /api/run'],
    install: [
      {
        title: 'Install worker deps',
        detail: 'From the axis repo worker package.',
        command: 'cd worker && bun install',
      },
      {
        title: 'Start wrangler',
        detail: 'Serves http://127.0.0.1:8787 by default.',
        command: 'cd worker && bun run dev',
      },
      {
        title: 'Use in AXIS',
        detail: 'Workers Manager → Use as backend (or set Backend URL).',
        command: LOCAL_AXIS_WORKER_BASE,
      },
    ],
  },
  {
    id: 'pyodide',
    name: 'Pyodide (browser)',
    summary: 'In-tab Wasm calculation — offline after warm-up',
    description:
      'Client-side engine: self-hosted Pyodide + vendored pynescript wheel. ' +
      'No network needed after assets load. First cold load is often 20–30s. ' +
      'No Numba; interpret path is primary. Ideal for offline demos and VPS without Flask.',
    usage:
      'Switch engine to Client-Side (Pyodide) from this card or Settings → Engine. ' +
      'No Backend URL needed. Use for offline demos, restricted networks, or when Flask is unavailable. ' +
      'First Run / Preload may take 20–30s while Wasm + wheel load.',
    icon: 'cpu',
    kind: 'browser',
    roles: ['calc'],
    defaultEndpoint: '',
    docsPath: '/axis/docs/plugins/engines',
    canUseAsBackend: false,
    canUseAsEngine: true,
    probe: 'pyodide',
    capabilities: ['offline', 'Wasm', 'micropip', 'no Numba'],
    install: [
      {
        title: 'Build with assets',
        detail:
          'Vite copies public/pyodide and public/vendor into dist/. Missing wheels cause BadZipFile / SPA HTML errors.',
        command: 'bun run build',
      },
      {
        title: 'Sync pyne wheel (optional)',
        detail: 'After pyne compiler changes, re-vendor the wheel.',
        command: './scripts/sync-pyne-wheel.sh',
      },
      {
        title: 'Select engine',
        detail: 'Workers Manager → Use engine, or topbar Engine → Client-Side (Pyodide).',
      },
      {
        title: 'Warm-up',
        detail: 'Preload from Detail or wait for first Run (~20–30s cold).',
      },
    ],
  },
  {
    id: 'service-worker',
    name: 'Service Worker (PWA)',
    summary: 'Offline shell + asset cache strategy',
    description:
      'Registers `/sw.js` in production builds (skipped in Vite dev and Tauri). ' +
      'Caches app shell and same-origin pyodide/vendor for offline use. ' +
      'API routes stay network-first so a down backend fails cleanly.',
    usage:
      'Automatic in production builds — no action for normal use. ' +
      'Skipped under `bun run dev` (HMR). If chrome looks stale after a deploy, hard-reload or unregister the SW. ' +
      'Does not evaluate Pine; only caches the PWA shell and assets.',
    icon: 'wifi',
    kind: 'pwa',
    roles: ['pwa'],
    defaultEndpoint: '',
    docsPath: '/axis/docs/enduser/getting-started/installation',
    canUseAsBackend: false,
    probe: 'service-worker',
    capabilities: ['cache-first shell', 'network-first /api', 'skipWaiting'],
    install: [
      {
        title: 'Production build',
        detail: 'SW registration is disabled under `bun run dev` (HMR conflict).',
        command: 'bun run build && bun run preview',
      },
      {
        title: 'Verify',
        detail: 'DevTools → Application → Service Workers → /sw.js controlled.',
      },
      {
        title: 'Stale UI',
        detail: 'Unregister SW or hard-reload if chrome looks stuck after deploys.',
      },
    ],
  },
  {
    id: 'pyne-agent',
    name: 'PYNE Agent Worker',
    summary: 'Natural-language → Pine scripts (Workers AI + RAG)',
    description:
      'Optional sister Worker that powers the PYNE Agent plugin. ' +
      'Serves `GET /plugin/axis-pine-agent.js` and chat/search APIs. ' +
      'Not required for charting or script evaluation — AXIS still runs scripts via your engine.',
    usage:
      'Optional AI assist only. Install the plugin from this card (or Plugin Manager URL), then open the agent UI. ' +
      'Generated scripts still run through your chosen engine (pyne Pro / Worker / Pyodide). ' +
      'Safe to hide via “Show optional” if you only need charting.',
    icon: 'download',
    kind: 'optional',
    roles: ['agent'],
    defaultEndpoint: pyneAgentWorkerOrigin(),
    docsPath: '/axis/docs/enduser/guides/pyne-agent',
    homepage: 'https://hoox.sh/pyne',
    canUseAsBackend: false,
    optional: true,
    pluginUrl: DEFAULT_PYNE_AGENT_PLUGIN_URL,
    probe: 'http-health',
    healthPaths: ['/health', '/'],
    healthMarkers: ['service', 'status', 'endpoints', 'version'],
    serviceHint: 'pyne-agent',
    capabilities: ['Workers AI', 'RAG', 'plugin JS', 'POST /v1/chat'],
    install: [
      {
        title: 'Install plugin in AXIS',
        detail: 'Plugin Manager → Install, or one-click below when online.',
        command: DEFAULT_PYNE_AGENT_PLUGIN_URL,
      },
      {
        title: 'Self-host (optional)',
        detail: 'Deploy pyne-agent-worker and set plugin URL to your origin.',
        command: 'https://<your-agent-worker>/plugin/axis-pine-agent.js',
      },
    ],
  },
  {
    id: 'pyne-worker',
    name: 'pyne-worker (edge eval)',
    summary: 'HOOX edge Pine evaluator — built-in engine + /run host',
    description:
      'Sister Cloudflare® Python Worker for edge evaluation (POST /run, alerts, cron, libraries). ' +
      'AXIS ships a dedicated **pyne-worker** engine plugin with this production origin. ' +
      'Distinct from the AXIS data-plane Worker (pynescript-axis / on-chain proxy).',
    usage:
      'Select engine **pyne-worker (edge)** in the topbar or Settings, or Use as calculation backend here. ' +
      'Set API key in Settings when the Worker secret API_KEY is required. ' +
      'Generated scripts still need bars from your source/stream; this is evaluate-only.',
    icon: 'settings',
    kind: 'optional',
    roles: ['calc'],
    defaultEndpoint: 'https://pyne-worker.cryptolinx.workers.dev',
    docsPath: '/axis/docs/plugins/engines',
    homepage: 'https://hoox.sh/pyne',
    canUseAsBackend: true,
    canUseAsEngine: true,
    optional: true,
    probe: 'http-health',
    healthPaths: ['/health'],
    healthMarkers: ['status', 'worker', 'features', 'engine'],
    serviceHint: 'pyne-worker',
    capabilities: [
      'POST /run',
      'GET /health',
      'interpret',
      'compile',
      'alerts',
      'libraries',
      'cron',
    ],
    install: [
      {
        title: 'Use built-in engine',
        detail: 'Topbar Engine → pyne-worker (edge), or Workers Manager → Use as calculation backend.',
        command: 'https://pyne-worker.cryptolinx.workers.dev',
      },
      {
        title: 'API key (production)',
        detail:
          'When API_KEY is set on the Worker, add it under Settings → engine config (X-API-Key).',
      },
      {
        title: 'Self-host',
        detail: 'Deploy hoox-sh/pyne-worker and paste your origin into Backend URL.',
        command: 'https://<your-pyne-worker>',
      },
    ],
  },
] as const;

const BY_ID = new Map<WorkerId, WorkerCatalogEntry>(
  WORKER_CATALOG.map((w) => [w.id, w]),
);

/** Look up a catalog entry by id. */
export function getWorkerCatalogEntry(id: WorkerId): WorkerCatalogEntry | undefined {
  return BY_ID.get(id);
}

/** All catalog entries (copy-safe readonly). */
export function listWorkerCatalog(): readonly WorkerCatalogEntry[] {
  return WORKER_CATALOG;
}

/**
 * Normalize a base URL for comparison (strip trailing slash and /api/run).
 */
export function normalizeWorkerBase(raw: string | undefined | null): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  let base = s.replace(/\/+$/, '');
  base = base.replace(/\/api\/run\/?$/i, '');
  base = base.replace(/\/api\/?$/i, '');
  return base;
}

/**
 * True when `endpoint` refers to the same origin/base as `candidate`.
 */
export function endpointsMatch(
  endpoint: string | undefined | null,
  candidate: string | undefined | null,
): boolean {
  const a = normalizeWorkerBase(endpoint).toLowerCase();
  const b = normalizeWorkerBase(candidate).toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const ua = new URL(a.includes('://') ? a : `http://${a}`);
    const ub = new URL(b.includes('://') ? b : `http://${b}`);
    return ua.origin === ub.origin;
  } catch {
    return a.includes(b) || b.includes(a);
  }
}

/**
 * Classify store.endpoint against known catalog entries (best match).
 */
export function matchCatalogForEndpoint(endpoint: string): WorkerId | null {
  const e = normalizeWorkerBase(endpoint);
  if (!e) return null;
  const lower = e.toLowerCase();

  // Most specific host heuristics first (before generic *.workers.dev).
  if (lower.includes('pyne-agent')) return 'pyne-agent';
  if (lower.includes('pyne-worker') || lower.includes('pine-worker')) return 'pyne-worker';
  if (/127\.0\.0\.1:8787|localhost:8787/.test(lower)) return 'axis-worker-local';
  if (/127\.0\.0\.1:5002|localhost:5002/.test(lower)) return 'pyne-pro';
  // Product VPS same-origin (nginx → Pro API). Not the CF Worker.
  if (isProductSameOriginApiHost(e)) return 'pyne-pro';
  if (lower.includes('pynescript-axis') || lower.includes('workers.dev')) {
    return 'axis-worker';
  }

  for (const w of WORKER_CATALOG) {
    if (w.publicEndpoint && endpointsMatch(e, w.publicEndpoint)) return w.id;
    if (w.defaultEndpoint && endpointsMatch(e, w.defaultEndpoint)) return w.id;
    if (w.localEndpoint && endpointsMatch(e, w.localEndpoint)) return w.id;
  }
  return null;
}

/**
 * Resolve which base URL a browser probe should hit for a catalog entry.
 *
 * Order:
 * 1. Explicit override
 * 2. Active backend URL when it maps to this worker
 * 3. Page origin when it is a product same-origin API host (pyne-pro)
 * 4. `publicEndpoint` when defaults are loopback (hardened VPS — UFW denies :5002)
 * 5. default / local catalog endpoints
 *
 * @param activeEndpoint - typically `store.endpoint` (optional for pure tests)
 * @param pageOrigin - `window.location.origin` when in the browser
 */
export function resolveProbeEndpoint(
  entry: WorkerCatalogEntry,
  opts?: {
    endpoint?: string;
    activeEndpoint?: string;
    pageOrigin?: string;
  },
): string {
  if (opts?.endpoint) return normalizeWorkerBase(opts.endpoint);

  const active = normalizeWorkerBase(opts?.activeEndpoint);
  if (active && matchCatalogForEndpoint(active) === entry.id) {
    return active;
  }

  const page = normalizeWorkerBase(opts?.pageOrigin);
  // Browser on product host (axis.hoox.sh) → probe same origin for Pro API
  if (entry.id === 'pyne-pro' && page && isProductSameOriginApiHost(page)) {
    return page;
  }

  // Catalog default is loopback — off-box probes would hit the *client* machine.
  // Use public reverse-proxy origin when available (hardened VPS pattern).
  const def = normalizeWorkerBase(entry.defaultEndpoint || entry.localEndpoint || '');
  if (entry.publicEndpoint && isLoopbackBase(def)) {
    const onLocalPage = !page || isLoopbackBase(page);
    if (onLocalPage) {
      // Local Vite/dev: probe loopback (expects Flask on this machine)
      return def;
    }
    // Remote page (product HTTPS): never probe client loopback for pyne-pro
    if (entry.id === 'pyne-pro') {
      if (page && isProductSameOriginApiHost(page)) return page;
      return normalizeWorkerBase(entry.publicEndpoint);
    }
  }

  return def;
}
