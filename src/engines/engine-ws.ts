// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistent WebSocket client for the **pyne Pro API** `/ws/run` endpoint.
 *
 * Used by {@link serverEngine} when `preferWs` is true. Converts an HTTP(S)
 * backend URL to `ws(s)://host/ws/run`, keeps one socket per origin, and
 * correlates run replies by request `id`. On connect/run timeout the client
 * is marked **dead** so callers skip WS and fall through to REST.
 *
 * ## Frame protocol
 *
 * **Outbound** (client → server): JSON with `type: "run"`, `id`, `script`,
 * `data` (bars array), `mode`, optional `symbol`.
 *
 * **Inbound**: result object with `status` / `plots` / `series` / `events`, or
 * an error frame (`type: "error"`, `message`) / `type: "pong"`.
 *
 * Gunicorn workers without WS support often hang or 404 — connect budget is
 * intentionally short so REST fallback still has time.
 *
 * @module engines/engine-ws
 */

/** Payload sent on the `/ws/run` socket for one evaluation. */
export type EngineWsRunRequest = {
  script: string;
  /** OHLCV bars (same shape as REST `data`). */
  data: unknown[];
  mode?: string;
  symbol?: string;
  /** Pine input.* overrides keyed by title */
  inputs?: Record<string, unknown>;
  /** Collect per-line timings for AXIS profiler gutter */
  profiler?: boolean;
  /** Correlation id; auto-generated when omitted. */
  id?: string;
};

/** Normalized result from a WS run (or error frame). */
export type EngineWsResult = {
  status: 'success' | 'error';
  plots?: unknown[];
  series?: Record<string, unknown>;
  events?: unknown[];
  drawings?: unknown[];
  error?: string;
  message?: string;
  code?: string;
  meta?: Record<string, unknown>;
  mode?: string;
  script_id?: string;
  run_id?: string;
  plot_meta?: Record<string, unknown>;
  transport?: 'ws';
  [k: string]: unknown;
};

/**
 * Map an HTTP(S) engine endpoint to the WS run URL.
 * Path on the endpoint is dropped so `http://host:5002/api` still targets
 * origin-root `/ws/run` (Pro API convention).
 */
export function endpointToRunWsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/$/, '');
  let u: URL;
  try {
    u = new URL(base.includes('://') ? base : `http://${base}`);
  } catch {
    u = new URL(`http://${base}`);
  }
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  // Drop path so endpoint "http://x:5002/api" still targets /ws/run on host
  // (Pro API is typically origin-root). Keep origin only.
  const origin = `${u.protocol}//${u.host}`;
  return `${origin}/ws/run`;
}

type Pending = {
  resolve: (v: EngineWsResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** How long a dead client stays dead before a reconnect attempt is allowed. */
const DEAD_COOLDOWN_MS = 45_000;

class EngineWsClient {
  private url: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private connectPromise: Promise<void> | null = null;
  private dead = false;
  /** Epoch ms until which {@link isDead} stays true after a hard failure. */
  private deadUntil = 0;
  private reqSeq = 0;

  constructor(url: string) {
    this.url = url;
  }

  get isOpen(): boolean {
    // WebSocket.OPEN === 1; don't rely on static when tests mock WebSocket
    return !!this.ws && this.ws.readyState === 1;
  }

  /**
   * True after hard failure for {@link DEAD_COOLDOWN_MS}.
   * After the cool-down, returns false and clears the dead flag so one
   * shared client can reconnect without thrashing a new socket every call.
   */
  get isDead(): boolean {
    if (!this.dead) return false;
    if (Date.now() >= this.deadUntil) {
      this.dead = false;
      this.deadUntil = 0;
      return false;
    }
    return true;
  }

  /** Mark this client dead until cool-down elapses. */
  private markDead(): void {
    this.dead = true;
    this.deadUntil = Date.now() + DEAD_COOLDOWN_MS;
  }

  async ensureConnected(timeoutMs = 6_000): Promise<void> {
    if (this.isDead) throw new Error('WebSocket client marked dead');
    if (this.isOpen) return;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.markDead();
        this.connectPromise = null;
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      this.ws = ws;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
        this.connectPromise = null;
        this.markDead();
        reject(new Error('WebSocket connect timeout'));
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.dead = false;
        this.deadUntil = 0;
        this.connectPromise = null;
        resolve();
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = null;
        this.connectPromise = null;
        this.markDead();
        reject(new Error('WebSocket error'));
      };

      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        // Reject all in-flight (premature or mid-run close)
        for (const [id, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('WebSocket closed'));
          this.pending.delete(id);
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.markDead();
          reject(new Error('WebSocket closed before open'));
        }
      };

      ws.onmessage = (ev) => {
        this.handleMessage(ev?.data);
      };
    });

    return this.connectPromise;
  }

  /**
   * Parse one inbound frame. Malformed / non-object payloads are ignored so a
   * single bad message does not tear down the socket; unmatched ids wait for
   * timeout or a later correlated reply.
   *
   * Engine error frames resolve (not reject) so callers never see an uncaught
   * rejection from a protocol-level error payload.
   */
  private handleMessage(data: unknown): void {
    let raw: string;
    try {
      if (typeof data === 'string') {
        raw = data;
      } else if (data == null) {
        return;
      } else {
        // Blob / ArrayBuffer rare for this API; coerce best-effort
        raw = String(data);
      }
      if (!raw || !raw.trim()) return;
      const msg = JSON.parse(raw) as unknown;
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      const rec = msg as Record<string, unknown>;
      if (rec.type === 'pong') return;
      const id = rec.id != null ? String(rec.id) : '';
      const pend = id ? this.pending.get(id) : undefined;
      if (!pend) return;
      clearTimeout(pend.timer);
      this.pending.delete(id);
      try {
        if (
          rec.type === 'error' ||
          rec.status === 'error' ||
          rec.status === 'failed' ||
          rec.ok === false
        ) {
          pend.resolve({
            status: 'error',
            error: String(rec.message || rec.error || 'Engine error'),
            code: rec.code as string | undefined,
            transport: 'ws',
          });
          return;
        }
        // Strip non-serializable / odd top-level junk; keep known run fields
        pend.resolve({
          ...(rec as EngineWsResult),
          status: 'success',
          transport: 'ws',
        });
      } catch (e) {
        // resolve callback itself must not leave the promise hanging
        pend.resolve({
          status: 'error',
          error: e instanceof Error ? e.message : 'Engine response handling failed',
          transport: 'ws',
        });
      }
    } catch {
      /* ignore malformed JSON — pending wait for timeout / good frame */
    }
  }

  run(req: EngineWsRunRequest, timeoutMs: number): Promise<EngineWsResult> {
    if (this.isDead) {
      return Promise.reject(new Error('WebSocket client marked dead'));
    }
    // Fast-fail connect (gunicorn without a WS worker often 404/hangs here).
    const connectMs = Math.min(4_000, Math.max(1_500, Math.floor(timeoutMs / 3)));
    return this.ensureConnected(connectMs).then(
      () =>
        new Promise<EngineWsResult>((resolve, reject) => {
          if (this.isDead) {
            reject(new Error('WebSocket client marked dead'));
            return;
          }
          if (!this.ws || this.ws.readyState !== 1) {
            reject(new Error('WebSocket not open'));
            return;
          }
          const id = req.id || `r${++this.reqSeq}_${Date.now().toString(36)}`;
          const timer = setTimeout(() => {
            this.pending.delete(id);
            // Mark dead so subsequent runs skip WS and go straight to REST.
            this.markDead();
            try {
              this.ws?.close();
            } catch {
              /* ignore */
            }
            reject(new Error('WebSocket run timeout'));
          }, timeoutMs);
          this.pending.set(id, { resolve, reject, timer });
          try {
            const frame: Record<string, unknown> = {
              type: 'run',
              id,
              script: req.script,
              data: req.data,
              mode: req.mode || 'interpret',
            };
            // Only send symbol when it's a real string (null fails API schema)
            if (typeof req.symbol === 'string' && req.symbol.length) {
              frame.symbol = req.symbol;
            }
            if (req.inputs && typeof req.inputs === 'object' && Object.keys(req.inputs).length) {
              frame.inputs = req.inputs;
            }
            if (req.profiler === true) {
              frame.profiler = true;
            }
            this.ws.send(JSON.stringify(frame));
          } catch (e) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }),
    );
  }

  close() {
    // Permanent close (reset / teardown) — not a cool-down soft-dead.
    this.dead = true;
    this.deadUntil = Date.now() + DEAD_COOLDOWN_MS;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('WebSocket client closed'));
    }
    this.pending.clear();
    const sock = this.ws;
    this.ws = null;
    if (sock) {
      try {
        sock.onclose = null;
        sock.onerror = null;
        sock.onmessage = null;
        sock.onopen = null;
        sock.close();
      } catch {
        /* ignore */
      }
    }
  }
}

const clients = new Map<string, EngineWsClient>();

/**
 * Return a shared {@link EngineWsClient} for the given HTTP endpoint.
 *
 * Dead clients are **kept** for a cool-down window so callers see `isDead`
 * and skip WS → REST without opening a new socket every run. After the
 * cool-down, the same instance becomes live again and may reconnect.
 */
export function getEngineWsClient(endpoint: string): EngineWsClient {
  const url = endpointToRunWsUrl(endpoint);
  let c = clients.get(url);
  if (!c) {
    c = new EngineWsClient(url);
    clients.set(url, c);
  }
  return c;
}

/**
 * Best-effort probe: open `/ws/run` briefly to warm the socket / detect WS support.
 * Used after health check when the Pro API advertises `websocket: true`.
 */
export async function probeEngineWs(endpoint: string, timeoutMs = 4_000): Promise<boolean> {
  const client = getEngineWsClient(endpoint);
  if (client.isDead) return false;
  try {
    await client.ensureConnected(timeoutMs);
    return client.isOpen;
  } catch {
    return false;
  }
}

/** @internal */
export function _resetEngineWsClients() {
  for (const c of clients.values()) c.close();
  clients.clear();
}
