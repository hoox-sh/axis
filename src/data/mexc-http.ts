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
 * Resilient MEXC public REST helpers for the AXIS PWA.
 *
 * MEXC's public REST does NOT send `Access-Control-Allow-Origin`, so the
 * browser blocks reading responses from `api.mexc.com` directly. The Worker
 * proxy is the primary path; direct is a last-ditch fallback for offline lab,
 * tests (`skipWorkerProxy`), or a custom Worker base that's down.
 *
 * Fetch order:
 * 1. AXIS Worker allowlisted proxy (`/api/market/mexc/…`)
 * 2. Explicit `baseUrl` override (source config)
 * 3. Direct public host (`https://api.mexc.com`)
 *
 * MEXC does not currently support a signed HMAC path here (no
 * `X-MEXC-APIKEY` user-data endpoints consumed by AXIS today). When that
 * need arises, mirror `src/data/signed-fetch.ts`.
 *
 * @module data/mexc-http
 */

import { normalizeEndpointBase } from './worker-origin';
import {
  DEFAULT_MARKET_WORKER_BASE,
  resolveMarketWorkerBase,
} from './market-worker';

export { DEFAULT_MARKET_WORKER_BASE, resolveMarketWorkerBase };

/** Canonical public REST origin; no browser CORS (`Access-Control-Allow-Origin`). */
export const MEXC_REST_HOSTS = ['https://api.mexc.com'] as const;

export type MexcRestPath = 'klines' | 'ticker/24hr' | 'exchangeInfo';

export interface MexcFetchOpts {
  /** Path under `/api/v3/` (or proxy equivalent). */
  path: MexcRestPath;
  /** Query string without leading `?`. */
  query?: string;
  /** Direct host override after Worker (source config `baseUrl`). */
  baseUrl?: string;
  /** Optional worker base override. */
  workerBase?: string;
  signal?: AbortSignal;
  /** Skip Worker proxy (tests / offline lab). Default false. */
  skipWorkerProxy?: boolean;
}

function joinUrl(base: string, path: MexcRestPath, query?: string): string {
  const b = base.replace(/\/+$/, '');
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${b}/api/v3/${path}${q}`;
}

function workerProxyUrl(
  workerBase: string,
  path: MexcRestPath,
  query?: string,
): string {
  const b = workerBase.replace(/\/+$/, '');
  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${b}/api/market/mexc/${path}${q}`;
}

async function workerClientError(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const rec = body as { message?: unknown; code?: unknown };
      const msg = String(rec.message || '').trim();
      const code = String(rec.code || '').trim();
      if (msg && code) return `${msg} (${code})`;
      if (msg) return msg;
    }
  } catch {
    /* non-JSON */
  }
  return `HTTP ${res.status}`;
}

/**
 * Fetch MEXC JSON: Worker proxy first (CORS-safe in browser), then direct
 * public host as last-ditch fallback (network / 5xx only).
 *
 * Worker 4xx (allowlist / not found) is thrown immediately — the browser
 * cannot read `api.mexc.com` and a second hop only adds CORS noise.
 *
 * Throws the last error when every candidate fails.
 */
export async function fetchMexcJson(opts: MexcFetchOpts): Promise<unknown> {
  const errors: string[] = [];

  if (!opts.skipWorkerProxy) {
    const worker = resolveMarketWorkerBase(opts.workerBase);
    const url = workerProxyUrl(worker, opts.path, opts.query);
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: opts.signal,
        headers: { Accept: 'application/json' },
      });
      if (res.ok) return await res.json();
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`MEXC worker: ${await workerClientError(res)}`);
      }
      errors.push(`worker: HTTP ${res.status}`);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (err instanceof Error && err.message.startsWith('MEXC worker:')) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`worker: ${msg}`);
    }
  }

  const bases: string[] = [];
  const preferred = normalizeEndpointBase(opts.baseUrl);
  if (preferred) bases.push(preferred);
  for (const h of MEXC_REST_HOSTS) {
    if (!bases.includes(h)) bases.push(h);
  }

  for (const base of bases) {
    const url = joinUrl(base, opts.path, opts.query);
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: opts.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${base}: ${msg}`);
    }
  }

  throw new Error(
    `MEXC network error (${errors.slice(0, 4).join(' · ') || 'unknown'})`,
  );
}
