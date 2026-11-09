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
 * Product names (pyne, pyodide, pyne-worker) live in the click inspector, not chip text.
 * UI: `ConnectionHud.tsx`. No Solid dependency.
 */

import type { ConnState, SubscriptionStatus, TransportClass } from '../store/types';
import { engineFamilyForText } from '../plugins/engine-family';

/** Where calculation lives: on this machine (loopback / in-tab) or a remote host. */
export type EngTopology = 'local' | 'remote';
/** Runtime class implementing Pine evaluation. */
export type RunClass = 'browser' | 'server' | 'worker';
/** Server execution strategy shown on the MODE chip. */
export type ExecMode = 'interpret' | 'compile' | 'auto';
/** Transport hop shown on the PATH chip; `—` for local/unknown transports. */
export type PathClass = 'WS' | 'REST' | '—';

/** Stable ids for the status-bar HUD chips; also the key for the click inspector. */
export type HudChipId =
  'live' | 'tick' | 'eng' | 'run' | 'mode' | 'path' | 'src' | 'str' | 'sto' | 'feed' | 'onc';

/** Everything the HUD renders: chip axes, plugin identity, connection state, and detail copy. */
export interface HudSnapshot {
  eng: EngTopology;
  run: RunClass;
  mode: ExecMode;
  path: PathClass;
  /** True when PATH chip should render (not browser-local). */
  showPath: boolean;
  /** Plugin / product ids for the click inspector */
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

/**
 * Coerce a stored/form value to a known exec mode.
 *
 * @param raw - Untrusted value from config.
 * @param fallback - Mode to use when `raw` is not a known mode.
 * @returns A valid {@link ExecMode}.
 */
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

/**
 * Map a transport class to the PATH chip text.
 *
 * @param t - Transport reported by telemetry/config.
 * @returns `WS` or `REST`, `—` for local/unknown transports.
 */
export function transportToPath(t: TransportClass | undefined | null): PathClass {
  if (t === 'ws') return 'WS';
  if (t === 'rest') return 'REST';
  return '—';
}

/** Inputs to {@link deriveHud}: selected engine, endpoint, mode, and telemetry. */
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

  const engineFamily = engineFamilyForText(enginePluginId);
  if (engineFamily === 'pyodide') {
    run = 'browser';
    eng = 'local';
    product = 'pyodide (in-tab Wasm)';
  } else if (
    engineFamily === 'worker' ||
    (engineFamily === 'server' && isWorkerEndpoint(endpoint))
  ) {
    run = 'worker';
    eng = isLocalEndpoint(endpoint) ? 'local' : 'remote';
    product = enginePluginId.includes('worker') ? enginePluginId : 'pyne-worker / edge evaluate';
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

/** Open-socket silence before the live label says `delayed Ns`. */
const OPEN_STREAM_DELAY_MS = 3000;

/**
 * `delayed Ns` when the caller clock is at least 3s past the last bar/tick.
 * No timestamp or no `now` → null. Does not read the clock.
 */
function openStreamDelayLabel(opts: {
  lastEventAt?: number | null;
  now?: number | null;
}): string | null {
  const at = opts.lastEventAt;
  const now = opts.now;
  if (typeof at !== 'number' || typeof now !== 'number') return null;
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  const ageMs = now - at;
  if (ageMs < OPEN_STREAM_DELAY_MS) return null;
  return `delayed ${Math.floor(ageMs / 1000)}s`;
}

/** Inputs that decide the Live chip — venue socket, engine wire, and feed path. */
export interface LiveArmInput {
  liveActive: boolean;
  streamStatus: string;
  /** `telemetry.stream.state` (`open` / `degraded` / …). */
  streamState?: string | null;
  /** `telemetry.stream.transport`. */
  transport?: string | null;
  /**
   * Engine `/ws/live` snapshot. `false` means the wire is not open.
   * Omitted when the caller has no wire (venue-only path).
   */
  wireOpen?: boolean | null;
  /** True when the engine stream route owns this live session. */
  streamRouteActive?: boolean;
  /** Worst series-feed / script status (`live` / `degraded` / `error` / …). */
  feedStatus?: string | null;
  /** Last bar or tick wall time. Missing → never claim delayed. */
  lastEventAt?: number | null;
  /** Caller clock. Missing → never claim delayed. */
  now?: number | null;
  /** Stream plane detail (reconnect attempt / backoff). */
  detail?: string | null;
}

/**
 * Pick the noisiest engine-feed / script status. Error beats degraded,
 * degraded beats in-flight, in-flight beats live. Empty → null.
 */
export function worstFeedStatus(
  statuses: ReadonlyArray<string | null | undefined>,
): string | null {
  const s = statuses.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (!s.length) return null;
  if (s.some((x) => x === 'error')) return 'error';
  if (s.some((x) => x === 'degraded')) return 'degraded';
  if (s.some((x) => x === 'connecting' || x === 'datafeed-loading' || x === 'calculating')) {
    return 'connecting';
  }
  if (s.some((x) => x === 'live')) return 'live';
  return s[0] ?? null;
}

function armIsConnecting(opts: LiveArmInput): boolean {
  return opts.streamStatus === 'connecting' || opts.streamState === 'connecting';
}

function armIsDegraded(opts: LiveArmInput): boolean {
  if (opts.feedStatus === 'degraded' || opts.streamState === 'degraded') return true;
  if (opts.wireOpen === false && !armIsConnecting(opts)) return true;
  return false;
}

/**
 * HUD Live chip copy.
 * The visible word stays “Live” while the socket reconnects — tone carries
 * the state. “Offline” is the armed-but-down failure label. “Degraded” /
 * “REST” match the script-card stream arm when the wire is not actually
 * open. “OFF” / “LIVE” remain the machine labels for tests and tone mapping.
 * An open socket names `delayed Ns` on this label when the last event is
 * at least 3s behind the caller’s `now`. Reconnecting does not.
 */
export function liveBadgeLabel(opts: LiveArmInput): string {
  const tone = liveBadgeTone(opts);
  if (tone === 'off') return 'OFF';
  if (tone === 'reconnect') return 'Live';
  if (tone === 'degraded') return 'Degraded';
  if (tone === 'rest') return 'REST';
  if (tone === 'offline') return 'Offline';
  const delay = openStreamDelayLabel(opts);
  return delay ? `LIVE · ${delay}` : 'LIVE';
}

/** Visible word on the Live control. Reconnecting keeps the word Live. */
export function liveBadgeWord(
  tone: ReturnType<typeof liveBadgeTone>,
): 'Live' | 'Offline' | 'Degraded' | 'REST' {
  if (tone === 'offline') return 'Offline';
  if (tone === 'degraded') return 'Degraded';
  if (tone === 'rest') return 'REST';
  return 'Live';
}

/**
 * Tooltip for the Live control. Attempt / backoff stay here, not in the label.
 * `detail` is the stream plane string (`attempt 1/8 in 1000ms`).
 * An open socket with no event for ≥3s adds `delayed Ns`. Reconnecting keeps
 * its own text even if the last event is old. `now` is caller-supplied.
 */
export function liveIndicatorTitle(
  opts: LiveArmInput & { startHint?: string },
): string {
  if (!opts.liveActive) return opts.startHint || 'Start live stream';
  const tone = liveBadgeTone(opts);
  if (tone === 'reconnect' || (opts.streamStatus === 'connecting' && tone !== 'degraded')) {
    const d = String(opts.detail || '').trim();
    const extra = d && d.toLowerCase() !== 'reconnecting' ? ` · ${d}` : '';
    return `Reconnecting${extra} — click to stop`;
  }
  if (tone === 'degraded') {
    const d = String(opts.detail || opts.feedStatus || '').trim();
    return d && d !== 'degraded' ? `Degraded · ${d} — click to stop` : 'Degraded — click to stop';
  }
  if (tone === 'rest') return 'REST — click to stop';
  if (tone === 'live') {
    const delay = openStreamDelayLabel(opts);
    return delay ? `Live · ${delay} — click to stop` : 'Live — click to stop';
  }
  return 'Offline — click to stop';
}

/** Short human name for the Compose chip (engine class, not an acronym). */
export function composeCaption(snap: Pick<HudSnapshot, 'run'>): string {
  if (snap.run === 'browser') return 'Pyodide';
  if (snap.run === 'worker') return 'Worker';
  return 'Server';
}

/**
 * Visual state for the HUD Live chip.
 * `live` only when the arm is actually open — not when scripts/feed are
 * degraded, the engine wire is closed, or the path is REST poll.
 */
export function liveBadgeTone(
  opts: LiveArmInput,
): 'off' | 'live' | 'reconnect' | 'offline' | 'degraded' | 'rest' {
  if (!opts.liveActive) return 'off';
  // Reconnect wins over a degraded plane so the word stays Live while retrying.
  if (armIsConnecting(opts) && opts.feedStatus !== 'degraded' && opts.feedStatus !== 'error') {
    return 'reconnect';
  }
  if (opts.feedStatus === 'error') return 'offline';
  if (armIsDegraded(opts)) return 'degraded';
  if (opts.transport === 'rest') return 'rest';
  if (opts.streamStatus === 'connected') {
    if (opts.streamRouteActive && opts.wireOpen === false) return 'degraded';
    return 'live';
  }
  return 'offline';
}

/**
 * Last-tick snapshot scoped to the chart instrument.
 * A tick stamped for another symbol is dropped so the footer cannot keep
 * the previous pair's price after a symbol/interval switch. Legacy ticks
 * with no `symbol` still match (callers clear `lastTick` on loadBars).
 */
export function lastTickForSymbol<T extends { symbol?: string }>(
  tick: T | null | undefined,
  symbol: string,
): T | null {
  if (!tick) return null;
  if (tick.symbol != null && tick.symbol !== symbol) return null;
  return tick;
}

/**
 * Chip tone for an engine-owned feed subscription (F-18). `live` is green,
 * `degraded`/`error` are amber/red, everything in-flight is neutral loading.
 */
export function feedStatusTone(
  status: SubscriptionStatus,
): 'live' | 'load' | 'degraded' | 'err' | 'idle' {
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
 * Inspector rows for the feed chip — the facts that explain the chip:
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

/**
 * Which HUD inspector is open. Hover is not an event — the scanline never
 * opens a container on pointer-enter. Click/keyboard toggles; Esc/outside close.
 */
export type HudInspectorEvent =
  | { type: 'toggle'; id: HudChipId }
  | { type: 'close' };

/**
 * Reduce the open inspector chip.
 *
 * @param current - Chip whose inspector is open, or `null`.
 * @param event - Toggle the same chip closed, switch chips, or close.
 * @returns The next open chip id.
 */
export function reduceHudInspector(
  current: HudChipId | null,
  event: HudInspectorEvent,
): HudChipId | null {
  if (event.type === 'close') return null;
  return current === event.id ? null : event.id;
}

/** Inspector title/body copy for a chip given the current snapshot. */
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
        body: 'Last live price from the **stream** (market data) for the **current** symbol. A previous pair’s tick is dropped on switch. Not the calculation engine.',
      };
    case 'live':
      return {
        title: 'LIVE — stream arm',
        body: 'Whether the live market stream is actually open. Live only while the venue socket (and the engine wire, when that route is on) is open. Degraded / REST / Offline match the script-card stream arm — never Live over a closed wire. The word stays Live while reconnecting; the dot turns amber and the tooltip shows attempt and backoff.',
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
