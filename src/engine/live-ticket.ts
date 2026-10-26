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
 * AXIS Worker live-proxy tickets (concept §4.6).
 *
 * Browser sockets cannot set `Authorization`, so the PWA mints a one-time
 * ticket over HTTP (`GET /api/ws/live?issue=ticket` with Bearer) and upgrades
 * `wss://…/api/ws/live?ticket=`. The long-lived Worker key never appears on
 * the WebSocket URL. The engine `auth` frame still carries the PYNE key.
 *
 * Tickets are single-use (60s). Every connect and reconnect remints.
 *
 * @module engine/live-ticket
 */

import { looksLikeOnchainWorkerEndpoint, normalizeEndpointBase } from '../data/worker-origin';
import { fetchWithTimeout } from '../utils/fetch-timeout';

export const LIVE_TICKET_TTL_S = 60;
const MINT_TIMEOUT_MS = 10_000;
const TICKET_RE = /^[a-f0-9]{32}$/;
/** Same shape as MCP bridge / Worker `pn_` keys. */
const WORKER_API_KEY_RE = /^pn_[a-f0-9]{48}$/;

/** Cloud Worker origin + AXIS API key used only to mint a live ticket. */
export type LiveProxy = {
  endpoint: string;
  apiKey: string;
};

export class LiveTicketError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'LiveTicketError';
    this.retryable = retryable;
  }
}

export function isLiveTicketError(err: unknown): err is LiveTicketError {
  return err instanceof LiveTicketError;
}

/** True when a mint failure must not reconnect (bad/missing Worker key). */
export function liveTicketRetryable(err: unknown): boolean {
  return !(err instanceof LiveTicketError) || err.retryable;
}

function loopbackHost(endpoint: string): boolean {
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

/**
 * Use the Worker live proxy when a cloud key is set and both the engine and
 * the Worker are remote. Loopback engine stays on direct `/ws/live` so a
 * local PYNE is not replaced by the Worker's `EXTERNAL_BACKEND`. Loopback
 * Worker (wrangler `:8787`) stays direct so a local Vite tab without wrangler
 * does not mint-fail in a reconnect loop.
 */
export function shouldUseLiveProxy(opts: {
  engineEndpoint: string;
  workerEndpoint?: string;
  workerApiKey?: string;
}): boolean {
  const key = String(opts.workerApiKey || '').trim();
  if (!WORKER_API_KEY_RE.test(key)) return false;
  if (loopbackHost(opts.engineEndpoint)) return false;
  const worker = String(opts.workerEndpoint || '').trim();
  if (loopbackHost(worker)) return false;
  if (!looksLikeOnchainWorkerEndpoint(worker)) return false;
  return true;
}

export function liveProxyForEngine(opts: {
  engineEndpoint: string;
  workerEndpoint?: string;
  workerApiKey?: string;
}): LiveProxy | undefined {
  if (!shouldUseLiveProxy(opts)) return undefined;
  return {
    endpoint: String(opts.workerEndpoint || '').trim(),
    apiKey: String(opts.workerApiKey || '').trim(),
  };
}

function workerHttpBase(workerEndpoint: string): string {
  const n = normalizeEndpointBase(workerEndpoint);
  if (n) return n;
  return String(workerEndpoint || '')
    .trim()
    .replace(/\/+$/, '');
}

/** `https://worker…/api/ws/live` — ticket issue and the upgrade path. */
export function workerLiveHttpUrl(workerEndpoint: string): string {
  return `${workerHttpBase(workerEndpoint)}/api/ws/live`;
}

/**
 * Worker live WebSocket URL. `ticket` is omitted until mint returns so
 * `urlValue` never carries the long-lived key.
 */
export function workerLiveWsUrl(workerEndpoint: string, ticket?: string): string {
  const http = workerLiveHttpUrl(workerEndpoint);
  let u: URL;
  try {
    u = new URL(http);
  } catch {
    u = new URL(`http://${http}`);
  }
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/api/ws/live';
  u.search = '';
  u.hash = '';
  const t = String(ticket || '').trim();
  if (t) u.searchParams.set('ticket', t);
  return u.toString();
}

export async function mintLiveTicket(proxy: LiveProxy): Promise<string> {
  const key = String(proxy.apiKey || '').trim();
  if (!key) throw new LiveTicketError('live ticket: Worker API key missing', false);
  const url = `${workerLiveHttpUrl(proxy.endpoint)}?issue=ticket`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      },
      { timeoutMs: MINT_TIMEOUT_MS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new LiveTicketError(`live ticket mint failed — ${message}`, true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new LiveTicketError(`live ticket HTTP ${res.status}`, false);
  }
  if (!res.ok) {
    const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
    throw new LiveTicketError(`live ticket HTTP ${res.status}`, retryable);
  }
  let body: { ticket?: unknown };
  try {
    body = (await res.json()) as { ticket?: unknown };
  } catch {
    throw new LiveTicketError('live ticket body is not JSON', true);
  }
  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (!TICKET_RE.test(ticket)) throw new LiveTicketError('live ticket missing', false);
  return ticket;
}
