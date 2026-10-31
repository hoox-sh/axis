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
 * Main-thread ingest host. Spawns the ingest worker for the default
 * worker transport. `axis.engine.transport=json` returns
 * {@link Redesign2WsClient} unchanged.
 *
 * @module hp/workers/host
 */

import type { Redesign2Frame, SeriesMeta } from '../../engine/frames';
import {
  endpointToRedesign2WsUrl,
  Redesign2WsClient,
  type Redesign2WsClientOptions,
} from '../../engine/ws-client';
import { workerLiveWsUrl, type LiveProxy } from '../../engine/live-ticket';
import type { WireClient, WireFrame } from '../../engine/live-wire';
import { PendingRequests, ReconnectHandlers, wireStats } from '../../engine/wire-bookkeeping';
import { noteIngestPublish } from '../../chart/paint-latency';
import { v1Count } from '../../engine/v1/metrics';
import { noteWorkerTransportFallback, wantsWorkerTransport } from '../../engine/v1/transport';
import type { HostToIngest, IngestToHost } from './protocol';

export type IngestWorkerTransport = {
  postMessage: (msg: HostToIngest) => void;
  terminate: () => void;
  onmessage: ((ev: MessageEvent<IngestToHost>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
};

export type IngestWorkerFactory = () => IngestWorkerTransport;

/** Respawns after a dead worker. Then the host stays down until `connect()`. */
const INGEST_WORKER_CRASH_CAP = 5;

let workerFactory: IngestWorkerFactory | null = null;
/** Tests force the Worker probe. `null` uses the runtime check. */
let workerAvailableOverride: boolean | null = null;

/** Tests inject a loopback transport so we never spawn a real Worker. */
export function setIngestWorkerFactory(factory: IngestWorkerFactory | null): void {
  workerFactory = factory;
}

/** Tests: `false` is the no-Worker fallback. `null` restores the runtime probe. */
export function setIngestWorkerAvailableForTests(available: boolean | null): void {
  workerAvailableOverride = available;
}

export function ingestWorkerAvailable(): boolean {
  if (workerAvailableOverride !== null) return workerAvailableOverride;
  if (workerFactory) return true;
  try {
    return typeof Worker === 'function' && typeof document !== 'undefined';
  } catch {
    return false;
  }
}

function defaultFactory(): IngestWorkerTransport {
  return new Worker(new URL('./ingest.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as IngestWorkerTransport;
}

/**
 * WireClient that owns an ingest worker. Inbound JSON/AXB1 is decoded off-thread.
 */
export class IngestHostClient implements WireClient {
  private worker: IngestWorkerTransport | null = null;
  private open = false;
  private openedOnce = false;
  private stopped = true;
  private reconnectAttempts = 0;
  private crashes = 0;
  private crashQueued = false;
  private connectWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private readonly pending = new PendingRequests<WireFrame>();
  private readonly reconnects = new ReconnectHandlers();
  readonly url: string;
  private readonly authToken?: string;
  private readonly liveProxy?: LiveProxy;

  onFrame: ((frame: WireFrame) => void) | undefined;
  onFrames?: ((frames: WireFrame[]) => void) | undefined;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
  onMalformed?: (reason: string) => void;
  /** Unknown AXB1 opcode for one subscription. The socket is still open. */
  onUnknownOpcode?: (info: { id: string; opcode: number; seq: number }) => void;
  /** Outbound buffer crossed or left the 1 MB cap. The socket stays open. */
  onBackpressure?: (held: boolean) => void;

  constructor(options: Redesign2WsClientOptions) {
    this.liveProxy = options.liveProxy;
    this.url = options.liveProxy
      ? workerLiveWsUrl(options.liveProxy.endpoint)
      : endpointToRedesign2WsUrl(options.endpoint, options.authToken);
    this.authToken = options.authToken;
  }

  get isOpen(): boolean {
    return this.open;
  }

  get urlValue(): string {
    return this.url;
  }

  stats(): { open: boolean; openedOnce: boolean; reconnectAttempts: number; stopped: boolean } {
    return wireStats({
      open: this.open,
      openedOnce: this.openedOnce,
      reconnectAttempts: this.reconnectAttempts,
      stopped: this.stopped,
    });
  }

  private ensureWorker(): IngestWorkerTransport {
    if (this.worker) return this.worker;
    const w = (workerFactory ?? defaultFactory)();
    w.onmessage = (ev) => this.onWorkerMessage(ev.data);
    w.onerror = () => this.onWorkerCrash();
    this.worker = w;
    return w;
  }

  /**
   * The worker thread died. Spawn another one and connect again so the
   * live wire can resubscribe. Do not switch the socket back to
   * main-thread `JSON.parse`.
   */
  private onWorkerCrash(): void {
    if (this.stopped || this.crashQueued) return;
    this.crashQueued = true;
    this.open = false;
    this.crashes += 1;
    const dead = this.worker;
    this.worker = null;
    if (dead) {
      dead.onerror = null;
      dead.onmessage = null;
      try {
        dead.terminate();
      } catch {
        /* already dead */
      }
    }
    this.onStatus?.('error');
    const err = new Error('ingest worker crashed');
    this.dropPending(err);
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const w of waiters) w.reject(err);
    queueMicrotask(() => {
      this.crashQueued = false;
      if (this.stopped || !this.openedOnce) return;
      if (this.crashes > INGEST_WORKER_CRASH_CAP) return;
      try {
        this.ensureWorker();
        this.postConnect();
      } catch {
        /* stay down; a silent JSON fallback would hide the crash */
      }
    });
  }

  private postConnect(): void {
    this.post({
      type: 'connect',
      url: this.url,
      authToken: this.authToken,
      liveProxy: this.liveProxy,
    });
  }

  private post(msg: HostToIngest): void {
    this.ensureWorker().postMessage(msg);
  }

  private dispatchFrames(frames: Redesign2Frame[]): void {
    for (const frame of frames) {
      if (frame.id) this.pending.resolveFrame(frame.id, frame);
    }
    if (this.onFrames) {
      this.onFrames(frames);
      return;
    }
    for (const frame of frames) this.onFrame?.(frame);
  }

  private onWorkerMessage(msg: IngestToHost | undefined): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'status') {
      if (msg.status === 'open') this.open = true;
      if (msg.status === 'closed' || msg.status === 'error') this.open = false;
      if (msg.status === 'error') this.reconnectAttempts += 1;
      this.onStatus?.(msg.status);
      if (msg.status === 'open') {
        const waiters = this.connectWaiters;
        this.connectWaiters = [];
        for (const w of waiters) w.resolve();
      }
      if (msg.status === 'error' || msg.status === 'closed') {
        const waiters = this.connectWaiters;
        this.connectWaiters = [];
        const err = new Error(`ingest ${msg.status}`);
        for (const w of waiters) w.reject(err);
        this.dropPending(err);
      }
      return;
    }
    if (msg.type === 'open') {
      // A replacement worker reports `first: true` for its own socket.
      // The host has already been live, so callers still resubscribe.
      const hostFirst = !this.openedOnce;
      this.openedOnce = true;
      if (!hostFirst) this.reconnects.fire();
      return;
    }
    if (msg.type === 'frames') {
      noteIngestPublish(msg.publishedAt);
      this.dispatchFrames(msg.frames);
      return;
    }
    if (msg.type === 'pong') return;
    if (msg.type === 'malformed') this.onMalformed?.(msg.reason);
    if (msg.type === 'unknown-opcode') {
      v1Count('unknownOpcode');
      this.onUnknownOpcode?.({ id: msg.id, opcode: msg.opcode, seq: msg.seq });
      return;
    }
    if (msg.type === 'backpressure') this.onBackpressure?.(msg.held);
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.crashes = 0;
    if (this.open) return;
    return new Promise((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject });
      this.postConnect();
    });
  }

  disconnect(): void {
    this.stopped = true;
    this.open = false;
    this.dropPending(new Error('IngestHostClient stopped'));
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const w of waiters) w.reject(new Error('IngestHostClient stopped'));
    try {
      this.worker?.postMessage({ type: 'disconnect' });
    } catch {
      /* ignore */
    }
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    this.onStatus?.('closed');
  }

  send(frame: WireFrame): void {
    if (!this.open) throw new Error('WebSocket not open');
    this.post({ type: 'send', frame });
  }

  subscribe(
    id: string,
    kind: 'series' | 'script',
    meta: SeriesMeta | Record<string, unknown>,
    opts?: {
      script?: string;
      inputs?: Record<string, unknown>;
      libraries?: unknown;
      mode?: string;
      /** Include only when the caller negotiates AXB1. Omit for JSON. */
      encoding?: 'axb1';
    },
  ): void {
    // Same rule as Redesign2WsClient: absent encoding keeps JSON. A hardcoded
    // `encoding: 'axb1'` here made live-wire's JSON fallback (snapshot timeout /
    // jsonSubs) still negotiate AXB1, so those subs never left the binary path.
    const { encoding, ...rest } = opts ?? {};
    this.send({
      type: 'subscribe',
      id,
      ts: Date.now(),
      payload: {
        kind,
        meta,
        ...rest,
        ...(encoding !== undefined ? { encoding } : {}),
      },
    });
  }

  resumeSubscription(
    id: string,
    count: number,
    lastTime: number,
    extra?: { closed_upto?: number; seq?: number; encoding?: 'axb1' },
  ): void {
    const { encoding, ...rest } = extra ?? {};
    this.send({
      type: 'resume',
      id,
      ts: Date.now(),
      payload: {
        count,
        last_time: lastTime,
        ...rest,
        ...(encoding !== undefined ? { encoding } : {}),
      },
    });
  }

  requestRepair(id: string, fromTime: number): void {
    this.send({ type: 'repair', id, ts: Date.now(), payload: { from_time: fromTime } });
  }

  unsubscribe(id: string): void {
    this.send({ type: 'unsubscribe', id, ts: Date.now() });
  }

  awaitFrame(id: string, timeoutMs = 10_000): Promise<WireFrame> {
    return this.pending.awaitFrame(id, timeoutMs);
  }

  addReconnectHandler(fn: () => void): () => void {
    return this.reconnects.add(fn);
  }

  private dropPending(err: Error): void {
    this.pending.dropAll(err);
  }
}

export type IngestHostOptions = Redesign2WsClientOptions;

/**
 * Live `/ws/live` client.
 *
 * The ingest worker owns the socket by default.
 * `axis.engine.transport=json` keeps the main-thread
 * {@link Redesign2WsClient}, including `JSON.parse`.
 * A worker that cannot start counts one JSON fallback.
 */
export function createLiveWsClient(
  options: IngestHostOptions,
): Redesign2WsClient | IngestHostClient {
  const worker = ingestWorkerAvailable();
  if (worker && wantsWorkerTransport()) return new IngestHostClient(options);
  if (!worker && wantsWorkerTransport()) noteWorkerTransportFallback();
  return new Redesign2WsClient(options);
}
