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

import {
  decodeInbound,
  decodeInboundAsync,
  IngestCursorTable,
  shouldAuthBlock,
  TipCoalescer,
  type IngestDecode,
} from './ingest-core';
import { isFormingTipFrame, sendBufferHeld } from '../../engine/v1/backpressure';
import { reconnectDelayMs } from '../../engine/frames';
import {
  liveTicketRetryable,
  mintLiveTicket,
  workerLiveWsUrl,
  type LiveProxy,
} from '../../engine/live-ticket';
import {
  INGEST_AUTH_WAIT_MS,
  INGEST_CONNECT_TIMEOUT_MS,
  INGEST_HEARTBEAT_MS,
  INGEST_PONG_TIMEOUT_MS,
  INGEST_TIP_COALESCE_MS,
  type HostToIngest,
  type IngestToHost,
} from './protocol';
import { isAuthOkFrame, isStatusFrame } from '../../engine/frames';

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
let authBlocked = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let authWaitTimer: ReturnType<typeof setTimeout> | null = null;
let liveUrl = '';
let authToken: string | undefined;
let liveProxy: LiveProxy | undefined;
/** Abandoned mint/open generations must not create a socket. */
let openGen = 0;
/** Outbound buffer is over the cap. Forming tips are not forwarded. */
let sendHeld = false;
/** Socket is up; `open` is deferred until `auth.ok` (never open unauthenticated). */
let pendingOpen: { first: boolean; socket: WebSocket; authAttempts: number } | null = null;

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

function clearAuthWait(): void {
  if (authWaitTimer) {
    clearTimeout(authWaitTimer);
    authWaitTimer = null;
  }
  pendingOpen = null;
}

/** Host `connect()` resolves on `open` — only fire it after auth.ok. */
function finishOpen(first: boolean): void {
  clearAuthWait();
  post({ type: 'status', status: 'open' });
  post({ type: 'open', first });
}

function sendAuth(socket: WebSocket): void {
  if (!authToken || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify({ type: 'auth', ts: Date.now(), payload: { token: authToken } }));
  } catch {
    /* closing socket */
  }
}

function isLiveRelayStatus(frame: unknown): boolean {
  return isStatusFrame(frame) && String(frame.payload.code || '') === 'live-relay';
}

/** Arm / re-arm the auth wait. Never finishOpen without auth.ok when a token is set. */
function armAuthWait(socket: WebSocket, first: boolean): void {
  if (authWaitTimer) {
    clearTimeout(authWaitTimer);
    authWaitTimer = null;
  }
  authWaitTimer = setTimeout(() => {
    if (ws !== socket || !pendingOpen || pendingOpen.socket !== socket) return;
    // Resend auth a few times (Worker may have dropped the first before upstream open).
    if (pendingOpen.authAttempts < 3) {
      pendingOpen.authAttempts += 1;
      sendAuth(socket);
      armAuthWait(socket, first);
      return;
    }
    // Give up: close and reconnect rather than subscribe while unauthenticated.
    clearAuthWait();
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }, INGEST_AUTH_WAIT_MS);
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
    noteSendBuffer();
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
  if (stopped || authBlocked) return;
  if (reconnectTimer) return;
  const delay = reconnectDelayMs(reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (stopped) return;
    openSocket();
  }, delay);
}

function noteSendBuffer(): void {
  const held = sendBufferHeld(ws?.bufferedAmount);
  if (held === sendHeld) return;
  sendHeld = held;
  post({ type: 'backpressure', held });
}

function handleDecoded(decoded: IngestDecode): void {
  if (!decoded.ok) {
    post({ type: 'malformed', reason: decoded.reason });
    return;
  }
  if (decoded.kind === 'unknown-opcode') {
    post({ type: 'unknown-opcode', opcode: decoded.opcode, id: decoded.id, seq: decoded.seq });
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
  for (const frame of decoded.frames) {
    if (pendingOpen && ws === pendingOpen.socket) {
      // Worker live-proxy signals upstream ready; (re)send auth then.
      if (isLiveRelayStatus(frame)) {
        pendingOpen.authAttempts += 1;
        sendAuth(pendingOpen.socket);
      }
      if (isAuthOkFrame(frame)) {
        finishOpen(pendingOpen.first);
      }
    }
    if (frame.type !== 'error' || frame.id) continue;
    const payload = frame.payload as { retryable?: unknown } | undefined;
    if (payload?.retryable !== false) continue;
    // PYNE UNAUTHORIZED = "authenticate first", not a bad key.
    if (!shouldAuthBlock(frame)) {
      if (pendingOpen && ws === pendingOpen.socket) {
        pendingOpen.authAttempts += 1;
        sendAuth(pendingOpen.socket);
      } else {
        clearAuthWait();
        try {
          ws?.close();
        } catch {
          /* ignore — onclose schedules reconnect */
        }
      }
      continue;
    }
    authBlocked = true;
    clearReconnect();
    clearAuthWait();
  }
  const frames = sendHeld
    ? decoded.frames.filter((frame) => !isFormingTipFrame(frame))
    : decoded.frames;
  if (frames.length) coalescer.push(frames);
}

function handleRaw(raw: unknown): void {
  noteSendBuffer();
  const decoded = decodeInbound(raw, table);
  handleDecoded(decoded);
}

async function openSocket(): Promise<void> {
  const gen = ++openGen;
  let url = liveUrl;
  if (liveProxy) {
    post({ type: 'status', status: 'connecting' });
    try {
      const ticket = await mintLiveTicket(liveProxy);
      if (stopped || gen !== openGen) return;
      url = workerLiveWsUrl(liveProxy.endpoint, ticket);
    } catch (err) {
      if (stopped || gen !== openGen) return;
      post({ type: 'status', status: 'error' });
      if (!liveTicketRetryable(err)) {
        authBlocked = true;
        return;
      }
      scheduleReconnect();
      return;
    }
  }
  if (!url || stopped || gen !== openGen) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
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
    sendHeld = false;
    startHeartbeat();
    if (authToken) {
      // Defer host `open` until auth.ok. Early auth can race the Worker
      // upstream open (frame dropped → UNAUTHORIZED on subscribe). Send now,
      // resend on live-relay / timer; never open unauthenticated.
      clearAuthWait();
      pendingOpen = { first, socket, authAttempts: 1 };
      sendAuth(socket);
      armAuthWait(socket, first);
      return;
    }
    finishOpen(first);
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
    clearAuthWait();
    clearHeartbeat();
    coalescer.flush();
    ws = null;
    post({ type: 'status', status: 'closed' });
    scheduleReconnect();
  };

  socket.onmessage = (ev) => {
    if (ws !== socket) return;
    const data = ev.data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      noteSendBuffer();
      void decodeInboundAsync(data, table).then((decoded) => {
        if (ws === socket) handleDecoded(decoded);
      });
      return;
    }
    handleRaw(data);
  };
}

function disconnect(): void {
  stopped = true;
  openGen += 1;
  clearReconnect();
  clearAuthWait();
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
    authBlocked = false;
    liveUrl = msg.url;
    authToken = msg.authToken;
    liveProxy = msg.liveProxy;
    if (ws) closeQuietly(ws);
    ws = null;
    clearReconnect();
    void openSocket();
    return;
  }
  if (msg.type === 'disconnect') {
    disconnect();
    return;
  }
  if (msg.type === 'send') {
    table.rememberOutbound(msg.frame);
    if (ws?.readyState !== 1) return;
    ws.send(JSON.stringify(msg.frame));
    noteSendBuffer();
    return;
  }
};
