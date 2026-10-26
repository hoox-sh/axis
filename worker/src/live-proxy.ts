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
 * `WS /api/ws/live` — transparent proxy to the engine's `WS /ws/live`
 * (F-15). Browser WebSockets cannot set `Authorization`, so callers mint a
 * one-time ticket first (`GET /api/ws/live?issue=ticket` with Bearer) and
 * upgrade with `?ticket=`. Header bearers work for non-browser clients.
 * Tickets live in `API_KEYS` KV (60s TTL) with an in-memory fallback for
 * unbound local dev — mirroring the scripts in-memory pattern.
 *
 * The relay is fully transparent: the client's PYNE `auth` frame travels
 * untouched to the engine, and **binary frames pass through as bytes** —
 * AXB1 (HP) rides the same socket, so a relay that decoded them to text
 * would corrupt every frame. A `Blob` (Workers compat dates ≥ 2026-03-17)
 * is read with `arrayBuffer()` and forwarded as those bytes. Worker-level
 * auth (AXIS key) and engine-level auth (PYNE key) stay separate.
 *
 * @module worker/live-proxy
 */

import { requireApiKey } from './auth';
import { API_CORS, errorResponse } from './http';
import type { Env } from './index';

const CORS = API_CORS;

export const LIVE_TICKET_TTL_S = 60;
const TICKET_PREFIX = 'liveticket:';
const memTickets = new Map<string, { userId: string; exp: number }>();

export function _resetLiveTicketsForTests(): void {
  memTickets.clear();
}

function randomNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function mintTicket(env: Env, userId: string): Promise<string> {
  const nonce = randomNonce();
  if (env.API_KEYS) {
    await env.API_KEYS.put(`${TICKET_PREFIX}${nonce}`, JSON.stringify({ userId }), {
      expirationTtl: LIVE_TICKET_TTL_S,
    });
  } else {
    memTickets.set(nonce, { userId, exp: Date.now() + LIVE_TICKET_TTL_S * 1000 });
  }
  return nonce;
}

async function consumeTicket(env: Env, nonce: string): Promise<string | null> {
  if (!/^[a-f0-9]{32}$/.test(nonce)) return null;
  if (env.API_KEYS) {
    const raw = await env.API_KEYS.get(`${TICKET_PREFIX}${nonce}`);
    await env.API_KEYS.delete(`${TICKET_PREFIX}${nonce}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { userId?: unknown };
      return typeof parsed.userId === 'string' ? parsed.userId : null;
    } catch {
      return null;
    }
  }
  const held = memTickets.get(nonce);
  memTickets.delete(nonce);
  if (!held || held.exp < Date.now()) return null;
  return held.userId;
}

/** Map the engine HTTP(S) origin to its `/ws/live` WebSocket URL. */
export function engineLiveWsUrl(externalBackend: string): string | null {
  let u: URL;
  try {
    u = new URL(externalBackend.includes('://') ? externalBackend : `http://${externalBackend}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/live';
  u.search = '';
  u.hash = '';
  return u.toString();
}

async function authedUserId(req: Request, env: Env, url: URL): Promise<string | null> {
  const ticket = (url.searchParams.get('ticket') || '').trim();
  if (ticket) return consumeTicket(env, ticket);
  const header = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(header)) return null;
  const auth = await requireApiKey(req, env);
  return auth.ok ? auth.ctx.userId : null;
}

/**
 * Relay payload for one WS frame: text stays text, binary stays binary.
 *
 * AXB1 (HP PR 1) rides the same socket as raw bytes, so decoding a binary
 * frame with `TextDecoder` would corrupt every non-UTF-8 byte before it
 * reaches the client — the relay must hand the exact payload through.
 * Workers' `ws.send` accepts `string | ArrayBuffer | ArrayBufferView`.
 *
 * Compatibility dates ≥ 2026-03-17 deliver binary frames as `Blob` by
 * default. That branch returns `blob.arrayBuffer()` (async); strings,
 * ArrayBuffers, and views stay synchronous and are not copied. AXIS stays
 * on compat date 2024-11-01 — this is forward-compat only.
 */
export function relayFrame(
  data: unknown,
): string | ArrayBuffer | ArrayBufferView | Promise<ArrayBuffer> {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.arrayBuffer();
  throw new TypeError(`unsupported WS frame type: ${typeof data}`);
}

/** ArrayBuffer binary frames when the socket exposes `binaryType`. */
function preferArrayBuffer(ws: WebSocket): void {
  try {
    if (!('binaryType' in ws)) return;
    ws.binaryType = 'arraybuffer';
  } catch {
    /* a mock socket without the setter must not break the relay */
  }
}

type RelayLane = { pending: number; tail: Promise<void> };

/** In-order send chain per destination. Idle text/bytes stay synchronous. */
const relayLanes = new WeakMap<WebSocket, RelayLane>();

function relayIncoming(dest: WebSocket, data: unknown): void {
  const deliver = (): Promise<void> | null => {
    let frame: ReturnType<typeof relayFrame>;
    try {
      frame = relayFrame(data);
    } catch {
      return null;
    }
    if (!(frame instanceof Promise)) {
      try {
        dest.send(frame);
      } catch {
        /* ignore */
      }
      return null;
    }
    const pending = frame;
    return (async () => {
      try {
        dest.send(await pending);
      } catch {
        /* ignore a failed Blob read or a closed socket */
      }
    })();
  };

  const lane = relayLanes.get(dest);
  if (!lane || lane.pending === 0) {
    const job = deliver();
    if (!job) return;
    const leg: RelayLane = lane ?? { pending: 0, tail: Promise.resolve() };
    leg.pending = 1;
    leg.tail = job.finally(() => {
      leg.pending -= 1;
    });
    relayLanes.set(dest, leg);
    return;
  }

  lane.pending += 1;
  lane.tail = lane.tail
    .catch(() => undefined)
    .then(() => deliver() ?? undefined)
    .finally(() => {
      lane.pending -= 1;
    });
}

/**
 * Handle `/api/ws/live` (ticket issue + WS upgrade proxy).
 * Returns null for any other path so the router can fall through.
 */
export async function handleLiveProxy(
  req: Request,
  env: Env,
  origin: string,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/api/ws/live')) return null;
  const url = new URL(req.url);
  const isUpgrade = (req.headers.get('Upgrade') || '').toLowerCase() === 'websocket';

  if (!isUpgrade && url.searchParams.get('issue') === 'ticket') {
    const header = req.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+/i.test(header)) {
      return errorResponse('NO_KEY', 'Authorization: Bearer <api_key> required to mint a ticket', {
        status: 401,
        origin,
        cors: CORS,
      });
    }
    const auth = await requireApiKey(req, env);
    if (!auth.ok) {
      return errorResponse(auth.code, auth.message, { status: auth.status, origin, cors: CORS });
    }
    const ticket = await mintTicket(env, auth.ctx.userId);
    return Response.json(
      { status: 'success', ticket, expiresIn: LIVE_TICKET_TTL_S },
      { headers: CORS(origin) },
    );
  }

  if (!isUpgrade) {
    return errorResponse(
      'UPGRADE_REQUIRED',
      'GET /api/ws/live upgrades to WebSocket; use ?issue=ticket to mint a ticket',
      {
        status: 426,
        origin,
        cors: CORS,
      },
    );
  }

  const userId = await authedUserId(req, env, url);
  if (!userId) {
    return errorResponse(
      'INVALID_TICKET',
      'live ticket missing, expired, or already used (or Authorization: Bearer required)',
      {
        status: 401,
        origin,
        cors: CORS,
      },
    );
  }
  if (!env.EXTERNAL_BACKEND) {
    return errorResponse('NO_BACKEND', 'EXTERNAL_BACKEND is not configured', {
      status: 503,
      origin,
      cors: CORS,
    });
  }
  const upstreamUrl = engineLiveWsUrl(env.EXTERNAL_BACKEND);
  if (!upstreamUrl) {
    return errorResponse('BAD_BACKEND', 'EXTERNAL_BACKEND is not a valid http(s) origin', {
      status: 500,
      origin,
      cors: CORS,
    });
  }

  const pair = new WebSocketPair();
  const [client, server] = [pair[0], pair[1]];
  const srv = server as WebSocket;
  // Before accept(): compat dates ≥ 2026-03-17 otherwise deliver Blob.
  preferArrayBuffer(srv);
  srv.accept();
  let upstream: WebSocket | null = null;
  try {
    upstream = new WebSocket(upstreamUrl);
    preferArrayBuffer(upstream);
  } catch (err) {
    try {
      (server as WebSocket).close(1011, 'upstream unavailable');
    } catch {
      /* ignore */
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  const up = upstream as WebSocket;
  // The browser `onopen` can fire (and send `auth`) before the upstream
  // engine socket is open. Buffer client→engine frames until then so the
  // first auth is not silently dropped (subscribe would then see UNAUTHORIZED).
  let upstreamOpen = false;
  const pendingToUpstream: unknown[] = [];
  const PENDING_TO_UP_CAP = 32;
  up.addEventListener('open', () => {
    upstreamOpen = true;
    for (const data of pendingToUpstream) {
      relayIncoming(up, data);
    }
    pendingToUpstream.length = 0;
    try {
      srv.send(
        JSON.stringify({ type: 'status', payload: { code: 'live-relay', message: 'connected' } }),
      );
    } catch {
      /* ignore */
    }
  });
  up.addEventListener('message', (ev) => {
    relayIncoming(srv, ev.data);
  });
  const closeUp = (code: number, reason: string) => {
    try {
      up.close(code, reason);
    } catch {
      /* ignore */
    }
  };
  up.addEventListener('close', () => {
    try {
      srv.close(1000, 'upstream closed');
    } catch {
      /* ignore */
    }
  });
  up.addEventListener('error', () => {
    try {
      srv.close(1011, 'upstream error');
    } catch {
      /* ignore */
    }
  });
  srv.addEventListener('message', (ev) => {
    if (!upstreamOpen) {
      if (pendingToUpstream.length < PENDING_TO_UP_CAP) pendingToUpstream.push(ev.data);
      return;
    }
    relayIncoming(up, ev.data);
  });
  srv.addEventListener('close', () => closeUp(1000, 'client closed'));
  srv.addEventListener('error', () => closeUp(1011, 'client error'));
  return new Response(null, { status: 101, webSocket: client });
}
