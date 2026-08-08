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
 * Connection HUD pure model — map engine plugin + endpoint → chip axes.
 *
 * Chip axes (no redundancy):
 * - ENG  local | remote     — topology (where calc lives)
 * - RUN  browser | server | worker — runtime class (what implements calc)
 * - MODE interpret | compile | auto
 * - PATH WS | REST | —       — hop for remote/server/worker runs only
 *
 * Product names (pyne, pyodide, pyne-worker) live in sticky-info detail, not chip text.
 * UI: `ConnectionHud.tsx`. No Solid dependency.
 */

import type { ConnState, TransportClass } from '../store/types';

export type EngTopology = 'local' | 'remote';
export type RunClass = 'browser' | 'server' | 'worker';
export type ExecMode = 'interpret' | 'compile' | 'auto';
export type PathClass = 'WS' | 'REST' | '—';

export type HudChipId =
  | 'live'
  | 'tick'
  | 'eng'
  | 'run'
  | 'mode'
  | 'path'
  | 'src'
  | 'str'
  | 'sto'
  | 'onc';

export interface HudSnapshot {
  eng: EngTopology;
  run: RunClass;
  mode: ExecMode;
  path: PathClass;
  /** True when PATH chip should render (not browser-local). */
  showPath: boolean;
  /** Plugin / product ids for sticky panel */
  enginePluginId: string;
  product: string;
  endpoint: string;
  preferWs: boolean;
  engineState: ConnState;
  latencyMs: number | null;
  detail: string;
  error: string | null;
  loading: boolean;
}

export function normalizeExecMode(raw: unknown, fallback: ExecMode = 'interpret'): ExecMode {
  const s = String(raw || fallback);
  if (s === 'compile' || s === 'auto' || s === 'interpret') return s;
  return fallback;
}

/** Loopback host → local topology. */
export function isLocalEndpoint(endpoint: string): boolean {
  const e = (endpoint || '').trim().toLowerCase();
  if (!e) return true;
  try {
    const u = new URL(e.includes('://') ? e : `http://${e}`);
    const h = u.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
  } catch {
    return /localhost|127\.0\.0\.1/.test(e);
  }
}

/** Heuristic: CF / pyne-worker style hosts → RUN=worker. */
export function isWorkerEndpoint(endpoint: string): boolean {
  const e = (endpoint || '').toLowerCase();
  return (
    e.includes('workers.dev') ||
    e.includes('pyne-worker') ||
    e.includes('pine-worker') ||
    /\/api\/run\b/.test(e)
  );
}

export function transportToPath(t: TransportClass | undefined | null): PathClass {
  if (t === 'ws') return 'WS';
  if (t === 'rest') return 'REST';
  return '—';
}

export interface HudInput {
  engineId: string;
  endpoint: string;
  modeRaw?: unknown;
  preferWs?: boolean;
  engineTransport?: TransportClass | null;
  engineState?: ConnState | null;
  latencyMs?: number | null;
  detail?: string | null;
  error?: string | null;
}

/**
 * Map store plugin selection → HUD axes.
 * engineId: legacy plugin id `server` | `pyodide` | custom.
 */
export function deriveHud(input: HudInput): HudSnapshot {
  const enginePluginId = (input.engineId || 'server').trim() || 'server';
  const endpoint = (input.endpoint || '').trim();
  const mode = normalizeExecMode(input.modeRaw);
  const preferWs = input.preferWs !== false;
  const engineState = (input.engineState || 'idle') as ConnState;
  const latencyMs =
    input.latencyMs != null && Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : null;
  const detail = String(input.detail || '');
  const error = input.error ? String(input.error) : null;

  // ── RUN + ENG from plugin id ──────────────────────────────────────
  let run: RunClass;
  let eng: EngTopology;
  let product: string;

  if (enginePluginId === 'pyodide' || enginePluginId.includes('pyodide')) {
    run = 'browser';
    eng = 'local';
    product = 'pyodide (in-tab Wasm)';
  } else if (
    enginePluginId.includes('worker') ||
    enginePluginId === 'pyne-worker' ||
    (enginePluginId === 'server' && isWorkerEndpoint(endpoint))
  ) {
    run = 'worker';
    eng = isLocalEndpoint(endpoint) ? 'local' : 'remote';
    product = enginePluginId.includes('worker')
      ? enginePluginId
      : 'pyne-worker / edge evaluate';
  } else {
    // server engine plugin (Pro API) or unknown → treat as process server
    run = 'server';
    eng = isLocalEndpoint(endpoint) ? 'local' : 'remote';
    product = 'pyne Pro API (CPython)';
  }

  // ── PATH ──────────────────────────────────────────────────────────
  let path: PathClass = '—';
  let showPath = false;
  if (run === 'browser') {
    showPath = false;
    path = '—';
  } else {
    showPath = true;
    // Prefer last-run transport; else preferred hop
    if (input.engineTransport === 'ws' || input.engineTransport === 'rest') {
      path = transportToPath(input.engineTransport);
    } else {
      path = preferWs ? 'WS' : 'REST';
    }
  }

  const loading =
    run === 'browser' &&
    (engineState === 'connecting' ||
      detail.toLowerCase().includes('load') ||
      detail.toLowerCase().includes('cold'));

  return {
    eng,
    run,
    mode,
    path,
    showPath,
    enginePluginId,
    product,
    endpoint: endpoint || '(default)',
    preferWs,
    engineState,
    latencyMs,
    detail,
    error,
    loading,
  };
}

/** Sticky-panel title/body copy for a chip given the current snapshot. */
export function hudChipHelp(id: HudChipId, snap: HudSnapshot): { title: string; body: string } {
  switch (id) {
    case 'eng':
      return {
        title: 'ENG — topology',
        body:
          `Where calculation lives: **${snap.eng}**.\n` +
          `• local — same machine as the browser (loopback API or in-tab)\n` +
          `• remote — process elsewhere (VPS, cloud, edge)\n` +
          `Selected plugin: \`${snap.enginePluginId}\` · ${snap.product}`,
      };
    case 'run':
      return {
        title: 'RUN — runtime class',
        body:
          `What implements Pine: **${snap.run}**.\n` +
          `• browser — Pyodide in the tab (no Numba)\n` +
          `• server — long-lived pyne Pro API (CPython ± Numba)\n` +
          `• worker — edge pyne-worker / CF isolate\n` +
          `Product: ${snap.product}\n` +
          `Endpoint: ${snap.endpoint}`,
      };
    case 'mode':
      return {
        title: 'MODE — execution path',
        body:
          `How the runtime executes: **${snap.mode}**.\n` +
          `• interpret — full AST evaluator\n` +
          `• compile — Numba/object compile path (Numba needs server CPython)\n` +
          `• auto — try compile, fall back to interpret\n` +
          (snap.loading
            ? `\nPyodide is still loading (~20–30s first open).`
            : snap.latencyMs != null
              ? `\nLast run: ${Math.round(snap.latencyMs)}ms`
              : ''),
      };
    case 'path':
      return {
        title: 'PATH — network hop',
        body:
          `How the last/preferred run talks to the API: **${snap.path}**.\n` +
          `• WS — WebSocket /ws/run (preferred when enabled)\n` +
          `• REST — POST /run (fallback)\n` +
          `Prefer WebSocket: ${snap.preferWs ? 'on' : 'off'}\n` +
          `Not shown for browser (in-tab) runs.`,
      };
    case 'tick':
      return {
        title: 'tick — market pulse',
        body: 'Last live price from the **stream** (market data). Not the calculation engine.',
      };
    case 'live':
      return {
        title: 'LIVE — stream arm',
        body: 'Whether the live market stream is armed. Independent of ENG/RUN/MODE.',
      };
    case 'src':
      return {
        title: 'SRC — history source',
        body: 'Plugin that loads historical OHLCV (REST/mock/csv).',
      };
    case 'str':
      return {
        title: 'STR — live stream',
        body: 'Plugin for live bar updates (WebSocket/poll).',
      };
    case 'sto':
      return {
        title: 'STO — library storage',
        body:
          'Where Pine scripts / library docs are stored (local · cloud · git).\n' +
          'Future: split into DATA (bars/cache) vs LIB (scripts).',
      };
    case 'onc':
      return {
        title: 'ONC — on-chain proxy',
        body:
          'Worker on-chain data plane proxy (`GET /api/onchain/health`).\n' +
          '• DefiLlama TVL via `/api/onchain/llama`\n' +
          '• GeckoTerminal DEX OHLCV via `/api/onchain/gecko`\n' +
          'Ephemeral — probed when the On-Chain panel opens or on first attach/search.\n' +
          'Uses the same engine endpoint base as pyne/Worker.',
      };
    default:
      return { title: id, body: '' };
  }
}
