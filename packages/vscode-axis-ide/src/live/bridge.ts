// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LiveSessionBridge — mint Worker live tickets and open `/api/ws/live?ticket=`.
 * Wire `onFrame` via `createLiveChartFanout` for chart.delta + seq-gap resume.
 */

import type { FetchLike } from '../run/engine-http';
import { scrubSecrets } from '../run/scrub';
import {
  assertSafeLiveWsUrl,
  checkWorkerUrl,
  mintLiveTicket,
  workerLiveWsUrl,
} from './ticket';
import {
  formatLiveStatus,
  resolveLiveHud,
  type LiveHudState,
  type LiveStatusLabel,
  type LiveWireStatus,
} from './status';

/**
 * Guard a candidate WS URL before connect (never `pn_` / `?key=` / MCP bridge).
 * Exported for unit tests with crafted unsafe URLs.
 */
export function prepareLiveConnectUrl(
  wsUrl: string,
  _apiKey?: string,
): { ok: true; wsUrl: string } | { ok: false; error: string } {
  try {
    assertSafeLiveWsUrl(wsUrl);
    return { ok: true, wsUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: scrubSecrets(message) };
  }
}

/** Minimal WebSocket surface (injectable for unit tests). */
export interface LiveWebSocket {
  readonly url: string;
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export type LiveWebSocketConstructor = new (url: string) => LiveWebSocket;

export interface LiveSecrets {
  /** Never-throw: Worker `pn_…` from SecretStorage. */
  getWorkerKey(): Promise<string | undefined>;
}

export type LiveOutput = {
  appendLine(line: string): void;
};

/**
 * Forward StreamLiveWire-compat frames. Prefer `createLiveChartFanout().onFrame`
 * so full/delta hit the chart bus and seq gaps trigger the resume stub.
 */
export type LiveFrameHandler = (frame: unknown) => void;

export type LiveStatusListener = (state: LiveHudState, label: LiveStatusLabel) => void;

export interface LiveSessionBridgeDeps {
  secrets: LiveSecrets;
  /** `axis.worker.url` (already preferred over empty). */
  workerUrl: string;
  /** `axis.live.enabled` — start() no-ops when false. */
  liveEnabled: boolean;
  /**
   * When true, arbitrary remote worker URLs are allowed (application-scoped
   * `axis.engine.allowRemoteEndpoint`). Loopback and looks-like-Worker hosts
   * always pass; default false blocks workspace exfil to attacker hosts.
   */
  allowRemoteWorker?: boolean;
  fetchImpl?: FetchLike;
  WebSocketImpl?: LiveWebSocketConstructor;
  output?: LiveOutput;
  /** Forward StreamLiveWire-compat frames (full/delta/status/close). */
  onFrame?: LiveFrameHandler;
  onStatus?: LiveStatusListener;
  /** Test seam — defaults to workerLiveWsUrl. */
  buildWsUrl?: (endpoint: string, ticket: string) => string;
}

export type LiveStartResult =
  | { ok: true; ticket: string; wsUrl: string }
  | { ok: false; error: string };

const WS_OPEN = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readWireStatus(frame: unknown): LiveWireStatus | null {
  if (!isPlainObject(frame)) return null;
  if (frame.type === 'status' || frame.kind === 'status') {
    return typeof frame.status === 'string' ? frame.status : null;
  }
  return null;
}

export class LiveSessionBridge {
  private ws: LiveWebSocket | null = null;
  private connecting = false;
  private connected = false;
  private errored = false;
  private wireStatus: LiveWireStatus | null = null;
  private generation = 0;

  constructor(private readonly deps: LiveSessionBridgeDeps) {}

  /** Current HUD state (live / degraded / off). */
  getHudState(): LiveHudState {
    return resolveLiveHud({
      enabled: this.deps.liveEnabled,
      connected: this.connected,
      connecting: this.connecting,
      errored: this.errored,
      wireStatus: this.wireStatus,
    });
  }

  getStatusLabel(): LiveStatusLabel {
    return formatLiveStatus(this.getHudState());
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WS_OPEN;
  }

  /**
   * Mark HUD degraded (seq-gap resume stub / repair). Keeps the socket up.
   * Sets wireStatus to `error` so StatusBar shows degraded while connected.
   */
  markDegraded(reason?: string): void {
    this.errored = true;
    this.wireStatus = 'error';
    if (reason) {
      this.log(`live degraded: ${reason}`);
    }
    this.emitStatus();
  }

  private emitStatus(): void {
    const state = this.getHudState();
    const label = formatLiveStatus(state);
    try {
      this.deps.onStatus?.(state, label);
    } catch {
      // status listeners must not break the bridge
    }
  }

  private log(line: string): void {
    try {
      this.deps.output?.appendLine(scrubSecrets(line));
    } catch {
      // ignore
    }
  }

  /**
   * Mint a ticket and open the live WebSocket.
   * Remints on every start (TTL 60s). Does not put `pn_` on the URL.
   * Generation is captured before any await so stop()/deactivate mid-mint
   * cannot open a socket after cancel.
   */
  async start(): Promise<LiveStartResult> {
    if (!this.deps.liveEnabled) {
      return { ok: false, error: 'AXIS live is disabled (axis.live.enabled).' };
    }

    this.stopSocketOnly();
    const gen = ++this.generation;
    this.connecting = true;
    this.connected = false;
    this.errored = false;
    this.wireStatus = null;
    this.emitStatus();

    const gated = checkWorkerUrl(this.deps.workerUrl, {
      allowRemote: this.deps.allowRemoteWorker === true,
    });
    if (!gated.ok) {
      if (gen === this.generation) {
        this.connecting = false;
        this.errored = true;
        this.emitStatus();
      }
      return { ok: false, error: gated.error };
    }

    let apiKey: string | undefined;
    try {
      apiKey = await this.deps.secrets.getWorkerKey();
    } catch {
      apiKey = undefined;
    }
    if (gen !== this.generation) {
      return { ok: false, error: 'AXIS live start cancelled.' };
    }
    if (!apiKey) {
      this.connecting = false;
      this.errored = true;
      this.emitStatus();
      return {
        ok: false,
        error:
          'AXIS Worker API key missing. Run “AXIS: Set Worker API Key” (SecretStorage pn_…) before live.',
      };
    }

    let ticket: string;
    try {
      ticket = await mintLiveTicket(
        { endpoint: gated.endpoint, apiKey },
        { fetchImpl: this.deps.fetchImpl },
      );
    } catch (err) {
      if (gen !== this.generation) {
        return { ok: false, error: 'AXIS live start cancelled.' };
      }
      this.connecting = false;
      this.errored = true;
      this.emitStatus();
      const message = err instanceof Error ? err.message : String(err);
      this.log(`live mint failed: ${message}`);
      return { ok: false, error: scrubSecrets(message) };
    }

    if (gen !== this.generation) {
      return { ok: false, error: 'AXIS live start cancelled.' };
    }

    const buildUrl = this.deps.buildWsUrl ?? workerLiveWsUrl;
    const prepared = prepareLiveConnectUrl(buildUrl(gated.endpoint, ticket), apiKey);
    if (!prepared.ok) {
      this.connecting = false;
      this.errored = true;
      this.emitStatus();
      return { ok: false, error: prepared.error };
    }
    const wsUrl = prepared.wsUrl;

    const WS = this.deps.WebSocketImpl ?? (globalThis.WebSocket as unknown as LiveWebSocketConstructor);
    if (!WS) {
      this.connecting = false;
      this.errored = true;
      this.emitStatus();
      return { ok: false, error: 'WebSocket implementation unavailable' };
    }

    let socket: LiveWebSocket;
    try {
      socket = new WS(wsUrl);
    } catch (err) {
      if (gen !== this.generation) {
        return { ok: false, error: 'AXIS live start cancelled.' };
      }
      this.connecting = false;
      this.errored = true;
      this.emitStatus();
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: scrubSecrets(message) };
    }

    if (gen !== this.generation) {
      try {
        socket.close();
      } catch {
        // ignore
      }
      return { ok: false, error: 'AXIS live start cancelled.' };
    }

    this.ws = socket;
    socket.onopen = () => {
      if (gen !== this.generation) return;
      this.connecting = false;
      this.connected = true;
      this.errored = false;
      this.log('live WS open');
      this.emitStatus();
    };
    socket.onerror = () => {
      if (gen !== this.generation) return;
      this.errored = true;
      this.connecting = false;
      this.log('live WS error');
      this.emitStatus();
    };
    socket.onclose = () => {
      if (gen !== this.generation) return;
      this.connected = false;
      this.connecting = false;
      this.ws = null;
      this.log('live WS closed');
      this.emitStatus();
    };
    socket.onmessage = (ev) => {
      if (gen !== this.generation) return;
      this.handleMessage(ev?.data);
    };

    return { ok: true, ticket, wsUrl };
  }

  private handleMessage(data: unknown): void {
    let frame: unknown = data;
    if (typeof data === 'string') {
      try {
        frame = JSON.parse(data) as unknown;
      } catch {
        frame = data;
      }
    }
    const wire = readWireStatus(frame);
    if (wire != null) {
      this.wireStatus = wire;
      this.emitStatus();
    }

    try {
      this.deps.onFrame?.(frame);
    } catch {
      // frame handlers must not tear down the socket
    }
  }

  /** Stop live and close the socket. */
  stop(): void {
    this.generation += 1;
    this.stopSocketOnly();
    this.connecting = false;
    this.connected = false;
    this.errored = false;
    this.wireStatus = null;
    this.emitStatus();
    this.log('live stopped');
  }

  private stopSocketOnly(): void {
    const sock = this.ws;
    this.ws = null;
    if (!sock) return;
    try {
      sock.close();
    } catch {
      // ignore
    }
  }
}

/** Factory for wiring agents / extension activate. */
export function createLiveSessionBridge(deps: LiveSessionBridgeDeps): LiveSessionBridge {
  return new LiveSessionBridge(deps);
}
