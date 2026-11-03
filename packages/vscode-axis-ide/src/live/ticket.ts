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
 * Worker live-proxy tickets for AXIS IDE (design §8).
 * Patterns copied from `src/engine/live-ticket.ts` — do not import the PWA store.
 *
 * Mint: `GET {worker}/api/ws/live?issue=ticket` + `Authorization: Bearer pn_…`
 * Upgrade: `wss://…/api/ws/live?ticket=` (never `?key=`, never `/api/mcp/bridge`).
 */

import { WORKER_API_KEY_RE } from '../secrets/slots';
import { checkHttpBaseUrl, type EndpointCheck } from '../run/endpoint';
import type { FetchLike } from '../run/engine-http';

export const LIVE_TICKET_TTL_S = 60;
export const DEFAULT_WORKER_URL = 'https://worker.axis.hoox.sh';
export const LIVE_WS_PATH = '/api/ws/live';
/** MCP bridge control plane — LiveSessionBridge must never use this route. */
export const MCP_BRIDGE_PATH = '/api/mcp/bridge';

const MINT_TIMEOUT_MS = 10_000;
const TICKET_RE = /^[a-f0-9]{32}$/;

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

function normalizeWorkerBase(workerEndpoint: string): string {
  const s = String(workerEndpoint || '')
    .trim()
    .replace(/\/+$/, '');
  if (!s) return '';
  let base = s.replace(/\/api\/run\/?$/i, '').replace(/\/api\/?$/i, '');
  return base.replace(/\/+$/, '');
}

function isAxisWorkerHostname(host: string): boolean {
  if (host.endsWith('.workers.dev')) return true;
  if (host === 'worker.axis.hoox.sh' || host.endsWith('.worker.axis.hoox.sh')) {
    return true;
  }
  if (host.includes('worker-axis') || host.includes('pynescript-axis')) {
    return true;
  }
  return false;
}

/** True when endpoint looks like an AXIS Cloudflare Worker (not the VPS SPA). */
export function looksLikeWorkerEndpoint(endpoint: string | undefined | null): boolean {
  const raw = String(endpoint || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.includes('/api/onchain')) return true;
  try {
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (isAxisWorkerHostname(host)) return true;
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if ((host === 'localhost' || host === '127.0.0.1') && port === '8787') {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Use the Worker live proxy when a cloud key is set and both the engine and
 * the Worker are remote. Loopback engine/Worker stay off the proxy (PWA parity).
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
  if (!looksLikeWorkerEndpoint(worker)) return false;
  return true;
}

/**
 * Normalize `axis.worker.url` before minting with Bearer.
 * Always allows loopback and looks-like-Worker hosts (product default cloud
 * Worker). Other remotes require `allowRemote: true` (application-scoped
 * `axis.engine.allowRemoteEndpoint`) so a workspace setting cannot exfiltrate
 * the Worker key to an attacker host.
 */
export function checkWorkerUrl(
  raw: string | undefined | null,
  opts?: { allowRemote?: boolean },
): EndpointCheck {
  const base = checkHttpBaseUrl(raw, {
    allowRemote: true,
    defaultUrl: DEFAULT_WORKER_URL,
    label: 'worker',
  });
  if (!base.ok) return base;
  if (opts?.allowRemote === true) return base;
  if (loopbackHost(base.endpoint) || looksLikeWorkerEndpoint(base.endpoint)) {
    return base;
  }
  return {
    ok: false,
    error:
      'AXIS worker URL must be loopback or a known AXIS Worker host unless axis.engine.allowRemoteEndpoint is enabled.',
  };
}

/** `https://worker…/api/ws/live` — ticket issue and the upgrade path. */
export function workerLiveHttpUrl(workerEndpoint: string): string {
  const base = normalizeWorkerBase(workerEndpoint) || String(workerEndpoint || '').trim().replace(/\/+$/, '');
  return `${base}${LIVE_WS_PATH}`;
}

/**
 * Worker live WebSocket URL. `ticket` is omitted until mint returns so the
 * long-lived `pn_` key never appears on the URL.
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
  u.pathname = LIVE_WS_PATH;
  u.search = '';
  u.hash = '';
  const t = String(ticket || '').trim();
  if (t) u.searchParams.set('ticket', t);
  return u.toString();
}

/** Reject URLs that would put a long-lived key or MCP bridge path on the wire. */
export function assertSafeLiveWsUrl(url: string): void {
  const s = String(url || '');
  if (s.includes(MCP_BRIDGE_PATH)) {
    throw new LiveTicketError('live WS must not use /api/mcp/bridge', false);
  }
  if (/[?&]key=/.test(s) || /[?&]api_key=/.test(s)) {
    throw new LiveTicketError('live WS must not put key on the query string', false);
  }
  if (/pn_[a-f0-9]{16,}/i.test(s)) {
    throw new LiveTicketError('live WS must not put pn_ on the URL', false);
  }
}

export type MintLiveTicketOpts = {
  fetchImpl?: FetchLike;
  /** Override mint timeout (ms). */
  timeoutMs?: number;
};

export async function mintLiveTicket(
  proxy: LiveProxy,
  opts?: MintLiveTicketOpts,
): Promise<string> {
  const key = String(proxy.apiKey || '').trim();
  if (!key) throw new LiveTicketError('live ticket: Worker API key missing', false);
  if (!WORKER_API_KEY_RE.test(key)) {
    throw new LiveTicketError('live ticket: Worker API key invalid', false);
  }
  const url = `${workerLiveHttpUrl(proxy.endpoint)}?issue=ticket`;

  const fetchImpl = opts?.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = opts?.timeoutMs ?? MINT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => {
    ac.abort();
  }, timeoutMs);

  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: ac.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new LiveTicketError(`live ticket mint failed — ${message}`, true);
  } finally {
    clearTimeout(timer);
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
    const text = await res.text();
    body = JSON.parse(text) as { ticket?: unknown };
  } catch {
    throw new LiveTicketError('live ticket body is not JSON', true);
  }
  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (!TICKET_RE.test(ticket)) throw new LiveTicketError('live ticket missing', false);
  return ticket;
}
