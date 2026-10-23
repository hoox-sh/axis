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
 * Main-thread ingest host. Spawns the ingest worker when HP is on;
 * otherwise returns {@link Redesign2WsClient} unchanged.
 *
 * @module hp/workers/host
 */

import type { Redesign2Frame, SeriesMeta } from '../../engine/frames';
import {
  endpointToRedesign2WsUrl,
  Redesign2WsClient,
  type Redesign2WsClientOptions,
} from '../../engine/ws-client';
import type { WireClient, WireFrame } from '../../engine/live-wire';
import { PendingRequests, ReconnectHandlers, wireStats } from '../../engine/wire-bookkeeping';
import type { Bar } from '../../store/types';
import { isolationProbe } from '../capabilities';
import { hpSabMode, isHpEnabled } from '../feature-flag';
import { allocateHotBuffer, type HotBuffer } from '../memory/hot-buffer';
import type { HostToIngest, IngestToHost } from './protocol';

export type IngestWorkerTransport = {
  postMessage: (msg: HostToIngest) => void;
  terminate: () => void;
  onmessage: ((ev: MessageEvent<IngestToHost>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
};

export type IngestWorkerFactory = () => IngestWorkerTransport;

let workerFactory: IngestWorkerFactory | null = null;

/** Tests inject a loopback transport so we never spawn a real Worker. */
export function setIngestWorkerFactory(factory: IngestWorkerFactory | null): void {
  workerFactory = factory;
}

export function ingestWorkerAvailable(): boolean {
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
  private connectWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private readonly pending = new PendingRequests<WireFrame>();
  private readonly reconnects = new ReconnectHandlers();
  readonly url: string;
  private readonly authToken?: string;
  /** HP-2 hot ring reader (main side); `null` until the SAB is allocated. */
  private hot: HotBuffer | null = null;
  private hotActive = false;

  onFrame: ((frame: WireFrame) => void) | undefined;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
  onMalformed?: (reason: string) => void;

  constructor(options: Redesign2WsClientOptions) {
    this.url = endpointToRedesign2WsUrl(options.endpoint, options.authToken);
    this.authToken = options.authToken;
    // HP-2/3: allocate up-front so `hotBuffer` is readable the moment the
    // client exists. `buildWire` starts the rAF copy-out sampler and
    // exposes the ring to the GPU overlay synchronously — before the first
    // `connect()` — so a lazily allocated ring would never be seen.
    this.ensureHot();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Hot-ring reader the rAF copy-out samples (`null` when not isolated / off). */
  get hotBuffer(): HotBuffer | null {
    return this.hot;
  }

  /** True once the ingest worker confirmed the ring is live. */
  get hotRingActive(): boolean {
    return this.hotActive;
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
    w.onerror = () => this.onStatus?.('error');
    this.worker = w;
    return w;
  }

  private post(msg: HostToIngest): void {
    this.ensureWorker().postMessage(msg);
  }

  /**
   * HP-2: allocate the hot SAB once per client, when the tab is isolated
   * and the `sab` flag allows it. `allocateHotBuffer` clamps the session to
   * rung 1 on OOM, so a refused allocation degrades to the frame path.
   */
  private ensureHot(): void {
    if (this.hot) return;
    if (hpSabMode() === 'off') return;
    if (!isolationProbe().sab) return;
    this.hot = allocateHotBuffer();
  }

  private dispatchFrames(frames: Redesign2Frame[]): void {
    for (const frame of frames) {
      if (frame.id) this.pending.resolveFrame(frame.id, frame);
      this.onFrame?.(frame);
    }
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
      const first = msg.first;
      if (!first) this.reconnects.fire();
      this.openedOnce = true;
      return;
    }
    if (msg.type === 'frames') {
      this.dispatchFrames(msg.frames);
      return;
    }
    if (msg.type === 'hot') {
      this.hotActive = msg.active;
      if (!msg.active) this.hot = null;
      return;
    }
    if (msg.type === 'pong') return;
    if (msg.type === 'malformed') this.onMalformed?.(msg.reason);
  }

  async connect(): Promise<void> {
    this.stopped = false;
    if (this.open) return;
    return new Promise((resolve, reject) => {
      this.connectWaiters.push({ resolve, reject });
      this.post({
        type: 'connect',
        url: this.url,
        authToken: this.authToken,
        ...(this.hot ? { hotSab: this.hot.sab } : {}),
      });
    });
  }

  disconnect(): void {
    this.stopped = true;
    this.open = false;
    this.hot = null;
    this.hotActive = false;
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
    },
  ): void {
    this.send({
      type: 'subscribe',
      id,
      ts: Date.now(),
      payload: { kind, meta, encoding: 'axb1', ...opts },
    });
  }

  resumeSubscription(
    id: string,
    count: number,
    lastTime: number,
    extra?: { closed_upto?: number; seq?: number },
  ): void {
    this.send({
      type: 'resume',
      id,
      ts: Date.now(),
      payload: { count, last_time: lastTime, ...extra },
    });
  }

  requestRepair(id: string, fromTime: number): void {
    this.send({ type: 'repair', id, ts: Date.now(), payload: { from_time: fromTime } });
  }

  unsubscribe(id: string): void {
    this.send({ type: 'unsubscribe', id, ts: Date.now() });
  }

  /**
   * Cold page → ingest worker (HP PR 5 wiring, §9.2).
   *
   * Best-effort by design: the caller is a per-frame overlay pump, so this
   * never throws and never spawns a worker just for paging — no worker, no
   * page, and the overlay clears for a frame. Empty `bars` retires the page.
   */
  publishColdPage(fromAbs: number, bars: Bar[]): void {
    try {
      if (!this.worker) return;
      this.worker.postMessage({
        type: 'page',
        fromAbs: Math.trunc(fromAbs),
        bars,
      });
    } catch {
      /* paging is best-effort — the overlay clears for a frame */
    }
  }

  awaitFrame(id: string, timeoutMs = 10_000): Promise<WireFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Redesign2 frame wait timed out for id: ${id}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
  }

  addReconnectHandler(fn: () => void): () => void {
    this.reconnectHandlers.add(fn);
    return () => {
      this.reconnectHandlers.delete(fn);
    };
  }

  private dropPending(err: Error): void {
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id);
      clearTimeout(waiter.timer);
      waiter.reject(err);
    }
  }
}

/**
 * Live `/ws/live` client. HP off (or no Worker) keeps {@link Redesign2WsClient}
 * byte-for-byte, including main-thread `JSON.parse`.
 */
export function createLiveWsClient(
  options: Redesign2WsClientOptions,
): Redesign2WsClient | IngestHostClient {
  if (isHpEnabled() && ingestWorkerAvailable()) return new IngestHostClient(options);
  return new Redesign2WsClient(options);
}
