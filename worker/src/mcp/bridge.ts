/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Durable Object: MCP ↔ PWA control plane.
 *
 * PWA tabs mint a short-lived ticket over HTTP, then connect with
 * `GET /api/mcp/bridge?ticket=<userId.nonce>` (WebSocket). MCP tools POST
 * `/invoke` on the same DO; the DO forwards to **one** connected client
 * (newest attachment) and waits for `{ type: "result", id }` / `{ type: "error", id }`.
 *
 * @module worker/mcp/bridge
 */

import {
  APP_INVOKE_TIMEOUT_MS,
  type AppInvokeRequest,
  type AppInvokeResponse,
} from './protocol';

/** One-time WS tickets expire quickly so logs/HAR never hold the long-lived key. */
export const BRIDGE_TICKET_TTL_MS = 30_000;
const TICKET_KEY_PREFIX = 'tkt:';

export function parseBridgeTicket(ticket: string): { userId: string; nonce: string } | null {
  const m = /^([a-f0-9]{32})\.([a-f0-9]{32})$/.exec(ticket.trim());
  const userId = m?.[1];
  const nonce = m?.[2];
  if (!userId || !nonce) return null;
  return { userId, nonce };
}

export function formatBridgeTicket(userId: string, nonce: string): string {
  return `${userId}.${nonce}`;
}

function randomNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

interface Pending {
  resolve: (value: AppInvokeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Only this socket's reply is accepted; other tabs' late frames are dropped. */
  ws: WebSocket;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function attachmentTime(ws: WebSocket): number {
  try {
    const raw = (
      ws as WebSocket & { deserializeAttachment?: () => unknown }
    ).deserializeAttachment?.();
    if (raw && typeof raw === 'object' && typeof (raw as { t?: unknown }).t === 'number') {
      return (raw as { t: number }).t;
    }
  } catch {
    /* hibernated / missing attachment */
  }
  return 0;
}

/** Newest `t` attachment wins; equal timestamps keep the later list entry. */
function pickInvokeSocket(sockets: WebSocket[]): WebSocket | null {
  let best: WebSocket | null = null;
  let bestT = -1;
  for (const ws of sockets) {
    const t = attachmentTime(ws);
    if (!best || t >= bestT) {
      best = ws;
      bestT = t;
    }
  }
  return best;
}

/**
 * Per-user MCP bridge. Bind as `MCP_BRIDGE` / class `McpBridgeDO`.
 */
export class McpBridgeDO {
  private readonly state: DurableObjectState;
  private readonly pending = new Map<string, Pending>();
  private readonly tickets = new Map<string, number>();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ticket' && (req.method === 'POST' || req.method === 'GET')) {
      return json(await this.issueTicket());
    }

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return json({ status: 'error', code: 'EXPECTED_WEBSOCKET' }, 426);
      }
      const nonce = (url.searchParams.get('ticket') || '').trim();
      if (nonce && !(await this.consumeTicket(nonce))) {
        return json(
          {
            status: 'error',
            code: 'INVALID_TICKET',
            message: 'bridge ticket missing, expired, or already used',
          },
          401,
        );
      }
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ role: 'app', t: Date.now() });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      return json({
        status: 'ok',
        connected: this.state.getWebSockets().length,
      });
    }

    if (url.pathname === '/invoke' && req.method === 'POST') {
      const sockets = this.state.getWebSockets();
      if (!sockets.length) {
        return json(
          {
            ok: false,
            error: {
              code: 'SESSION_OFFLINE',
              message:
                'No AXIS tab is connected to this MCP session. Open the PWA, set the Worker API key, and enable MCP in Settings.',
            },
          },
          503,
        );
      }
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: { code: 'BAD_JSON', message: 'invalid JSON' } }, 400);
      }
      const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const capability = String(rec.capability || '').trim();
      if (!capability) {
        return json({ ok: false, error: { code: 'NO_CAPABILITY', message: 'capability required' } }, 400);
      }
      const id = typeof rec.id === 'string' && rec.id ? rec.id : crypto.randomUUID();
      const invoke: AppInvokeRequest = {
        id,
        capability,
        payload: rec.payload,
      };
      const timeoutMs =
        typeof rec.timeoutMs === 'number' && rec.timeoutMs > 0
          ? Math.min(rec.timeoutMs, 60_000)
          : APP_INVOKE_TIMEOUT_MS;

      const result = await this.dispatch(sockets, invoke, timeoutMs);
      return json(result, result.ok ? 200 : 502);
    }

    return json({ status: 'error', code: 'NOT_FOUND' }, 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    const type = String(msg.type || '');
    if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      return;
    }
    if (type === 'hello') {
      ws.send(JSON.stringify({ type: 'hello-ok', t: Date.now() }));
      return;
    }
    if (type === 'result' || type === 'error') {
      const id = String(msg.id || '');
      const pending = this.pending.get(id);
      if (!pending || pending.ws !== ws) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (type === 'result') {
        pending.resolve({ id, ok: true, result: msg.result });
      } else {
        const err = msg.error;
        const rec = err && typeof err === 'object' ? (err as Record<string, unknown>) : {};
        pending.resolve({
          id,
          ok: false,
          error: {
            code: String(rec.code || 'APP_ERROR'),
            message: String(rec.message || 'app capability failed'),
          },
        });
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    for (const [id, pending] of this.pending) {
      if (pending.ws !== ws) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.resolve({
        id,
        ok: false,
        error: {
          code: 'SESSION_OFFLINE',
          message: 'AXIS tab disconnected while handling invoke.',
        },
      });
    }
  }

  async webSocketError(): Promise<void> {
    /* ignore */
  }

  private ticketKey(nonce: string): string {
    return `${TICKET_KEY_PREFIX}${nonce}`;
  }

  private async issueTicket(): Promise<{ nonce: string; expiresIn: number }> {
    const now = Date.now();
    await this.sweepTickets(now);
    const nonce = randomNonce();
    const exp = now + BRIDGE_TICKET_TTL_MS;
    this.tickets.set(nonce, exp);
    await this.state.storage.put(this.ticketKey(nonce), exp);
    return { nonce, expiresIn: Math.floor(BRIDGE_TICKET_TTL_MS / 1000) };
  }

  private async consumeTicket(nonce: string): Promise<boolean> {
    let exp = this.tickets.get(nonce);
    if (exp === undefined) {
      exp = await this.state.storage.get<number>(this.ticketKey(nonce));
    }
    this.tickets.delete(nonce);
    await this.state.storage.delete(this.ticketKey(nonce));
    return typeof exp === 'number' && exp >= Date.now();
  }

  private async sweepTickets(now: number): Promise<void> {
    for (const [k, exp] of this.tickets) {
      if (exp < now) this.tickets.delete(k);
    }
    const stored = await this.state.storage.list<number>({ prefix: TICKET_KEY_PREFIX });
    for (const [key, exp] of stored) {
      if (typeof exp === 'number' && exp >= now) continue;
      await this.state.storage.delete(key);
      this.tickets.delete(key.slice(TICKET_KEY_PREFIX.length));
    }
  }

  private dispatch(
    sockets: WebSocket[],
    invoke: AppInvokeRequest,
    timeoutMs: number,
  ): Promise<AppInvokeResponse> {
    return new Promise((resolve) => {
      const target = pickInvokeSocket(sockets);
      if (!target) {
        resolve({
          id: invoke.id,
          ok: false,
          error: {
            code: 'SESSION_OFFLINE',
            message: 'No AXIS tab is connected to this MCP session.',
          },
        });
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(invoke.id);
        resolve({
          id: invoke.id,
          ok: false,
          error: { code: 'TIMEOUT', message: `app did not respond within ${timeoutMs}ms` },
        });
      }, timeoutMs);
      this.pending.set(invoke.id, { resolve, timer, ws: target });
      const frame = JSON.stringify({ type: 'invoke', ...invoke });
      try {
        target.send(frame);
      } catch {
        this.pending.delete(invoke.id);
        clearTimeout(timer);
        resolve({
          id: invoke.id,
          ok: false,
          error: {
            code: 'SESSION_OFFLINE',
            message: 'AXIS tab socket failed while dispatching invoke.',
          },
        });
      }
    });
  }
}
