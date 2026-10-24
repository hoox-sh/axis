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
 * Ingest worker: owns `/ws/live`, decodes JSON or AXB1, posts frames.
 *
 * Auth token arrives once on `connect` and is never posted back.
 *
 * @module hp/workers/ingest.worker
 */

import { HOT_CAP } from '../axb1/constants';
import { priceToTicks } from '../axb1/ticks';
import { HotBuffer, barToTicks, BAR_FLAG_CLOSED, type HotBarTicks } from '../memory/hot-buffer';
import { computeHotLayout } from '../memory/layout';
import { publishBarPage, mergePageBars } from '../memory/page-buffer';
import { ColdStore, hydrateColdFromCache } from '../memory/cold-store';
import { sanitizeStreamBar } from '../../data/parse-bars';
import { decodeInbound, IngestCursorTable, TipCoalescer } from './ingest-core';
import type { Redesign2Frame } from '../../engine/frames';
import { HotRingWriter, routeThroughRing } from './hot-ring-writer';
import {
  INGEST_CONNECT_TIMEOUT_MS,
  INGEST_HEARTBEAT_MS,
  INGEST_PONG_TIMEOUT_MS,
  INGEST_TIP_COALESCE_MS,
  type ColdKey,
  type HostToIngest,
  type IngestToHost,
} from './protocol';

interface IngestWorkerScope {
  postMessage: (msg: IngestToHost) => void;
  onmessage: ((ev: MessageEvent<HostToIngest>) => void) | null;
}

const scope = self as unknown as IngestWorkerScope;
const table = new IngestCursorTable();

let ws: WebSocket | null = null;
let stopped = true;
let openedOnce = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let liveUrl = '';
let authToken: string | undefined;
/** Hot SAB ring (HP-2): bound by the first series snapshot that arrives. */
let ring: HotRingWriter | null = null;
/**
 * Worker-side cold history (hp2 B1): IDB-hydrated once per series, then
 * extended by every snapshot / close / page the wire carries. Feeds the
 * page-slot merge when the main slice is shorter than the wanted range.
 */
let cold: ColdStore | null = null;
/** Series subscription the cold store belongs to; a switch re-seeds it. */
let coldSeries: string | null = null;
/** Bars-cache identity for the IDB hydrate; absent = live feed only. */
let coldKey: ColdKey | undefined;

const coalescer = new TipCoalescer((frames) => {
  // Stage mark for the §14.2 split: the worker clock shares its time origin
  // with the main thread for dedicated workers, so main can subtract this.
  scope.postMessage({ type: 'frames', frames, publishedAt: performance.now() });
}, INGEST_TIP_COALESCE_MS);

function post(msg: IngestToHost): void {
  scope.postMessage(msg);
}

function clearHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (pongTimer) {
    clearTimeout(pongTimer);
    pongTimer = null;
  }
}

function startHeartbeat(): void {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    } catch {
      return;
    }
    if (pongTimer) clearTimeout(pongTimer);
    pongTimer = setTimeout(() => {
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    }, INGEST_PONG_TIMEOUT_MS);
  }, INGEST_HEARTBEAT_MS);
}

function closeQuietly(socket: WebSocket): void {
  try {
    socket.onopen = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
  } catch {
    /* ignore */
  }
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (stopped) return;
  if (reconnectTimer) return;
  const delay = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempts, 10));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (stopped) return;
    openSocket();
  }, delay);
}

function handleRaw(raw: unknown): void {
  const decoded = decodeInbound(raw, table);
  if (!decoded.ok) {
    post({ type: 'malformed', reason: decoded.reason });
    return;
  }
  if (decoded.kind === 'pong') {
    if (pongTimer) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
    post({ type: 'pong' });
    return;
  }
  feedCold(decoded.frames);
  // HP-2: series bars are written into the hot SAB ring; the posted frames
  // keep every wire field except the cloned bar payload.
  coalescer.push(ring ? routeThroughRing(decoded.frames, ring) : decoded.frames);
}

/**
 * Cold write-back (hp2 B1): every full snapshot and every verified bar
 * close lands in the worker's cold history, so a later page request can
 * be served even where the main chart window has no bars. Forming
 * deltas never touch cold — only closes (and snapshot history) do.
 */
function feedCold(frames: Redesign2Frame[]): void {
  if (!cold) return;
  const scale = cold.priceScale;
  try {
    for (const frame of frames) {
      if (frame.type === 'full') {
        const rawBars = frame.payload?.bars;
        if (!Array.isArray(rawBars)) continue;
        const ticks: HotBarTicks[] = [];
        for (const raw of rawBars) {
          const bar = sanitizeStreamBar(raw);
          if (!bar) continue;
          ticks.push(barToTicks(bar, scale));
        }
        if (ticks.length) cold.upsertByTime(ticks);
      } else if (frame.type === 'close') {
        const payload = frame.payload;
        const ohlcv = payload?.ohlcv;
        if (!payload || !ohlcv || !Number.isFinite(payload.time)) continue;
        const { open, high, low, close, volume } = ohlcv;
        if (
          ![open, high, low, close, volume].every(
            (v) => typeof v === 'number' && Number.isFinite(v),
          )
        ) {
          continue;
        }
        cold.appendTick({
          time: Math.trunc(payload.time),
          openTicks: priceToTicks(open, scale),
          highTicks: priceToTicks(high, scale),
          lowTicks: priceToTicks(low, scale),
          closeTicks: priceToTicks(close, scale),
          volume,
          flags: BAR_FLAG_CLOSED,
        });
      }
    }
  } catch {
    /* cold is best-effort — a bad bar must not break the frame path */
  }
}

/**
 * IDB hydrate for a freshly bound cold store (hp2 B1, crash recovery).
 *
 * Adopts the cached history when cold is still empty; merges it by time
 * when live bars already landed (a hydrate racing the socket must not
 * wipe them). A miss (or no key) leaves the live feed as the only source.
 */
async function hydrateCold(target: ColdStore, key: ColdKey | undefined): Promise<void> {
  if (!key?.sourceId || !key.symbol || !key.interval) return;
  try {
    const seed = new ColdStore({ priceScale: target.priceScale, max: target.max });
    const loaded = await hydrateColdFromCache(seed, key.sourceId, key.symbol, key.interval);
    if (loaded === 0 || cold !== target) return;
    if (target.length === 0) target.setTicks(seed.toTicks());
    else target.upsertByTime(seed.toTicks());
  } catch {
    /* best-effort — the live feed still builds cold */
  }
}

/** (Re)bind cold to a series subscription; a switch re-seeds from IDB. */
function bindCold(seriesId: string | null): void {
  if (seriesId === coldSeries) return;
  coldSeries = seriesId;
  cold = null;
  if (seriesId && ring) {
    const next = new ColdStore({ priceScale: ring.buffer.priceScale });
    cold = next;
    void hydrateCold(next, coldKey);
  }
}

function openSocket(): void {
  if (!liveUrl) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(liveUrl);
  } catch {
    post({ type: 'status', status: 'error' });
    scheduleReconnect();
    return;
  }
  socket.binaryType = 'arraybuffer';
  ws = socket;
  post({ type: 'status', status: 'connecting' });
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (ws !== socket) return;
    closeQuietly(socket);
    ws = null;
    post({ type: 'status', status: 'error' });
    scheduleReconnect();
  }, INGEST_CONNECT_TIMEOUT_MS);

  socket.onopen = () => {
    if (ws !== socket) {
      closeQuietly(socket);
      return;
    }
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    reconnectAttempts = 0;
    const first = !openedOnce;
    openedOnce = true;
    post({ type: 'status', status: 'open' });
    post({ type: 'open', first });
    startHeartbeat();
    if (authToken) {
      socket.send(JSON.stringify({ type: 'auth', ts: Date.now(), payload: { token: authToken } }));
    }
  };

  socket.onerror = () => {
    if (ws !== socket) return;
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    post({ type: 'status', status: 'error' });
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    clearHeartbeat();
    coalescer.flush();
    ws = null;
    post({ type: 'status', status: 'closed' });
    scheduleReconnect();
  };

  socket.onmessage = (ev) => {
    if (ws !== socket) return;
    const data = ev.data;
    if (data instanceof Blob) {
      void data.arrayBuffer().then((buf) => {
        if (ws === socket) handleRaw(buf);
      });
      return;
    }
    handleRaw(data);
  };
}

function disconnect(): void {
  stopped = true;
  ring = null;
  cold = null;
  coldSeries = null;
  clearReconnect();
  clearHeartbeat();
  coalescer.flush();
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
  if (ws) {
    closeQuietly(ws);
    ws = null;
  }
  post({ type: 'status', status: 'closed' });
}

scope.onmessage = (ev: MessageEvent<HostToIngest>) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'connect') {
    stopped = false;
    liveUrl = msg.url;
    authToken = msg.authToken;
    coldKey = msg.coldKey;
    // HP-2: wrap the host-provided SAB. A failure degrades to the frame
    // path (no ring) instead of failing the connection.
    if (msg.hotSab) {
      try {
        ring = new HotRingWriter(new HotBuffer(msg.hotSab, computeHotLayout(HOT_CAP)));
        // A fresh bind (symbol switch, reconnect) invalidates any cold page
        // the previous series published — retire it, the pager re-requests.
        ring.buffer.clearPage();
        post({ type: 'hot', active: true });
      } catch {
        ring = null;
        post({ type: 'hot', active: false });
      }
    } else {
      ring = null;
    }
    // Cold (re)binds with the ring: a new SAB means a new series window.
    // Without a ring there is no page slot, so cold stays unowned.
    cold = null;
    coldSeries = null;
    if (ring) {
      const next = new ColdStore({ priceScale: ring.buffer.priceScale });
      cold = next;
      void hydrateCold(next, coldKey);
    }
    if (ws) closeQuietly(ws);
    ws = null;
    clearReconnect();
    openSocket();
    return;
  }
  if (msg.type === 'disconnect') {
    disconnect();
    return;
  }
  if (msg.type === 'send') {
    table.rememberOutbound(msg.frame);
    // A new series subscription re-seeds cold (symbol switch); anything
    // else keeps the history the wire has been building.
    const id = (msg.frame as { id?: unknown }).id;
    if (
      (msg.frame as { type?: unknown }).type === 'subscribe' &&
      typeof id === 'string' &&
      id.startsWith('series:')
    ) {
      bindCold(id);
    }
    if (ws?.readyState !== 1) return;
    ws.send(JSON.stringify(msg.frame));
    return;
  }
  if (msg.type === 'page') {
    // Cold page replace from the main thread's chart window (HP PR 5
    // wiring, §9.2) merged with the worker's cold store (hp2 B1): slots
    // the main slice does not cover are filled from IDB/live-built
    // history, so a range older than the chart window still paints. The
    // worker stays the SAB's single writer, so a page replace can never
    // tear a concurrent hot-window publish.
    if (!ring || !Number.isFinite(msg.fromAbs) || !Array.isArray(msg.bars)) return;
    const fromAbs = Math.trunc(msg.fromAbs);
    try {
      if (cold) {
        // The main slice is the REST slice: accumulate it into cold so
        // the next gap can be served without another round-trip.
        const scale = cold.priceScale;
        const ticks: HotBarTicks[] = [];
        for (const bar of msg.bars) ticks.push(barToTicks(bar, scale));
        if (ticks.length) cold.upsertByTime(ticks);
        const merged = mergePageBars(cold, fromAbs, msg.count ?? msg.bars.length, msg.bars);
        publishBarPage(ring.buffer, merged.bars, merged.fromAbs);
      } else {
        publishBarPage(ring.buffer, msg.bars, fromAbs);
      }
    } catch {
      /* paging is best-effort — the overlay clears for a frame */
    }
  }
};
