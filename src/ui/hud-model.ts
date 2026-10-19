// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
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

import type { ConnState, SubscriptionStatus, TransportClass } from '../store/types';

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
  | 'feed'
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

/**
 * HUD Live chip copy.
 * The visible word stays “Live” while the socket reconnects — tone carries
 * the state. “Offline” is only the armed-but-down failure label.
 * “OFF” / “LIVE” remain the machine labels for tests and tone mapping.
 */
export function liveBadgeLabel(opts: {
  liveActive: boolean;
  streamStatus: string;
}): string {
  if (!opts.liveActive) return 'OFF';
  if (opts.streamStatus === 'connected') return 'LIVE';
  if (opts.streamStatus === 'connecting') return 'Live';
  return 'Offline';
}

/** Visible word on the Live control. Reconnecting keeps the word Live. */
export function liveBadgeWord(tone: ReturnType<typeof liveBadgeTone>): 'Live' | 'Offline' {
  return tone === 'offline' ? 'Offline' : 'Live';
}

/**
 * Tooltip for the Live control. Attempt / backoff stay here, not in the label.
 * `detail` is the stream plane string (`attempt 1/8 in 1000ms`).
 */
export function liveIndicatorTitle(opts: {
  liveActive: boolean;
  streamStatus: string;
  detail?: string | null;
  startHint?: string;
}): string {
  if (!opts.liveActive) return opts.startHint || 'Start live stream';
  if (opts.streamStatus === 'connected') return 'Live — click to stop';
  if (opts.streamStatus === 'connecting') {
    const d = String(opts.detail || '').trim();
    const extra = d && d.toLowerCase() !== 'reconnecting' ? ` · ${d}` : '';
    return `Reconnecting${extra} — click to stop`;
  }
  return 'Offline — click to stop';
}

/** Short human name for the Compose chip (engine class, not an acronym). */
export function composeCaption(snap: Pick<HudSnapshot, 'run'>): string {
  if (snap.run === 'browser') return 'Pyodide';
  if (snap.run === 'worker') return 'Worker';
  return 'Server';
}

/** Visual state for the HUD Live chip (success only when receiving). */
export function liveBadgeTone(opts: {
  liveActive: boolean;
  streamStatus: string;
}): 'off' | 'live' | 'reconnect' | 'offline' {
  if (!opts.liveActive) return 'off';
  if (opts.streamStatus === 'connected') return 'live';
  if (opts.streamStatus === 'connecting') return 'reconnect';
  return 'offline';
}

/**
 * Chip tone for an engine-owned feed subscription (F-18). `live` is green,
 * `degraded`/`error` are amber/red, everything in-flight is neutral loading.
 */
export function feedStatusTone(status: SubscriptionStatus): 'live' | 'load' | 'degraded' | 'err' | 'idle' {
  if (status === 'live') return 'live';
  if (status === 'degraded') return 'degraded';
  if (status === 'error') return 'err';
  if (status === 'idle') return 'idle';
  return 'load';
}

/**
 * Short label for a feed subscription. Degraded names the cause when known
 * (`degraded · unverified close`), else its staleness (`degraded · 45s
 * stale`); loading states show progress when known (`loading 2k/10k`).
 * Long labels ellipsize in the chip — callers put the full text in `title`.
 */
export function feedStatusLabel(
  status: SubscriptionStatus,
  opts?: { have?: number; need?: number; message?: string; updatedAt?: number; now?: number },
): string {
  if (status === 'live') return 'live';
  if (status === 'error') return `error${opts?.message ? ` · ${opts.message}` : ''}`;
  if (status === 'degraded') {
    if (opts?.message) return `degraded · ${opts.message}`;
    const at = opts?.updatedAt ?? 0;
    const now = opts?.now ?? Date.now();
    const ageS = Math.max(0, Math.round((now - at) / 1000));
    return `degraded · ${ageS}s stale`;
  }
  if (status === 'datafeed-loading') {
    if (opts?.have !== undefined && opts?.need !== undefined) {
      return `loading ${opts.have}/${opts.need}`;
    }
    return 'loading';
  }
  if (status === 'datafeed-ready') return 'ready';
  if (status === 'calculating') return 'calculating';
  if (status === 'connecting') return 'connecting';
  return 'idle';
}

/** Close-verification tier → what it means for the bar that closed. */
export function verifiedTierLabel(verified?: string | null): string {
  switch (verified) {
    case 'venue':
      return 'venue · independent';
    case 'proxy':
      return 'worker proxy';
    case 'engine':
      return 'engine copy · weak';
    case 'none':
      return 'none';
    default:
      return '—';
  }
}

/** True when the tier confirms the close on its own (venue / worker proxy). */
export function verifiedIsStrong(verified?: string | null): boolean {
  return verified === 'venue' || verified === 'proxy';
}

/** Feed chip view — value, tone and the full tooltip text. */
export interface FeedChipView {
  value: string;
  tone: 'live' | 'load' | 'degraded' | 'err' | 'idle';
  title: string;
}

/**
 * Feed chip content: **what the data path is** and **how fresh it is**.
 *
 * A live feed says `live` — the weak close-verification tier no longer
 * relabels it `degraded` (the data *is* flowing); it is flagged
 * `live·unverified` instead, so the chip agrees with the engine plane.
 * A feed that never came up keeps its state word plus the time it has been
 * stuck (`connecting · 45s`) — the age is the useful part, the bare state
 * word is the stale part.
 */
export function feedChipView(opts: {
  status: SubscriptionStatus;
  verified?: 'venue' | 'proxy' | 'engine' | 'none' | null;
  have?: number;
  need?: number;
  message?: string;
  updatedAt?: number;
  now?: number;
}): FeedChipView {
  const { status } = opts;
  const now = opts.now ?? Date.now();
  const ageS = Math.max(0, Math.round((now - (opts.updatedAt ?? now)) / 1000));
  const label = feedStatusLabel(status, {
    have: opts.have,
    need: opts.need,
    message: opts.message,
    updatedAt: opts.updatedAt,
    now,
  });
  if (status === 'live') {
    const strong = verifiedIsStrong(opts.verified);
    return {
      value: strong ? 'live' : 'live·unverified',
      tone: strong ? 'live' : 'degraded',
      title: strong
        ? 'Engine feed live — closes confirmed by an independent tier'
        : `Engine feed live — closes only confirmed by the ${verifiedTierLabel(opts.verified)}`,
    };
  }
  if (status === 'degraded' || status === 'error') {
    return {
      value: label,
      tone: status === 'error' ? 'err' : 'degraded',
      title: `Engine feed ${status}${opts.message ? ` — ${opts.message}` : ''} (${ageS}s ago)`,
    };
  }
  if (status === 'connecting' || status === 'calculating' || status === 'datafeed-loading') {
    const stuck = ageS >= 5 ? ` · ${ageS}s` : '';
    return {
      value: `${label}${stuck}`,
      tone: 'load',
      title: `Engine feed ${label}${stuck ? ` — stuck for ${ageS}s` : ''} (chart falls back to venue + REST)`,
    };
  }
  return { value: label, tone: 'idle', title: `Engine feed ${label}` };
}

/**
 * Info-panel rows for the feed chip — the facts that explain the chip:
 * state, freshness, verification tier, progress, the engine hop and the
 * series identity.
 */
export function feedChipMeta(opts: {
  status: SubscriptionStatus;
  verified?: 'venue' | 'proxy' | 'engine' | 'none' | null;
  have?: number;
  need?: number;
  message?: string;
  updatedAt?: number;
  now?: number;
  engineTransport?: string | null;
  engineState?: string | null;
  engineLatencyMs?: number | null;
  engineDetail?: string | null;
  seriesKey?: string | null;
}): string[] {
  const now = opts.now ?? Date.now();
  const ageS = Math.max(0, Math.round((now - (opts.updatedAt ?? now)) / 1000));
  const rows: string[] = [`state ${opts.status}`];
  if (opts.status !== 'live') rows.push(`updated ${ageS}s ago`);
  rows.push(`verified ${verifiedTierLabel(opts.verified)}`);
  if (opts.have !== undefined || opts.need !== undefined) {
    rows.push(`progress ${opts.have ?? '?'} / ${opts.need ?? '?'}`);
  }
  if (opts.message) rows.push(`note ${opts.message}`);
  if (opts.engineTransport || opts.engineState) {
    const lat = opts.engineLatencyMs != null ? ` · ${Math.round(opts.engineLatencyMs)}ms` : '';
    rows.push(`engine ${opts.engineTransport ?? '—'} · ${opts.engineState ?? '—'}${lat}`);
  }
  if (opts.engineDetail) rows.push(`engine ${opts.engineDetail}`);
  if (opts.seriesKey) rows.push(`series ${opts.seriesKey}`);
  return rows;
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
        body: 'Whether the live market stream is armed. The label stays Live; the dot turns amber while reconnecting and the tooltip shows attempt and backoff. Offline only after the socket gives up. Independent of engine, runtime, and path.',
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
    case 'feed':
      return {
        title: 'FEED — engine-owned subscription',
        body:
          'Status of the engine-owned datafeed subscription for this chart series\n' +
          '(`subscribe → status → full → delta → close`). Shown only while the\n' +
          'stream engine path is active.',
      };
    default:
      return { title: id, body: '' };
  }
}
