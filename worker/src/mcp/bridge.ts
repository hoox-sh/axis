/**
 * Copyright (C) 2024-2026 jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Durable Object: MCP ↔ PWA control plane.
 *
 * PWA tabs connect with `GET /api/mcp/bridge?session=<userId>` (WebSocket).
 * MCP tools POST `/invoke` on the same DO; the DO forwards to connected
 * clients and waits for `{ type: "result", id }` / `{ type: "error", id }`.
 *
 * @module worker/mcp/bridge
 */

import {
  APP_INVOKE_TIMEOUT_MS,
  type AppInvokeRequest,
  type AppInvokeResponse,
} from './protocol';

interface Pending {
  resolve: (value: AppInvokeResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Per-user MCP bridge. Bind as `MCP_BRIDGE` / class `McpBridgeDO`.
 */
export class McpBridgeDO {
  private readonly state: DurableObjectState;
  private readonly pending = new Map<string, Pending>();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') {
        return json({ status: 'error', code: 'EXPECTED_WEBSOCKET' }, 426);
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
      if (!pending) return;
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

  async webSocketClose(): Promise<void> {
    /* hibernation: sockets list is refreshed via getWebSockets() */
  }

  async webSocketError(): Promise<void> {
    /* ignore */
  }

  private dispatch(
    sockets: WebSocket[],
    invoke: AppInvokeRequest,
    timeoutMs: number,
  ): Promise<AppInvokeResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(invoke.id);
        resolve({
          id: invoke.id,
          ok: false,
          error: { code: 'TIMEOUT', message: `app did not respond within ${timeoutMs}ms` },
        });
      }, timeoutMs);
      this.pending.set(invoke.id, { resolve, timer });
      const frame = JSON.stringify({ type: 'invoke', ...invoke });
      for (const ws of sockets) {
        try {
          ws.send(frame);
        } catch {
          /* drop dead socket */
        }
      }
    });
  }
}
