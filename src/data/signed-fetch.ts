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
 * Authenticated CEX GET: vault credentials + venue HMAC, then Worker signed
 * proxy for Binance when the browser cannot CORS to api.binance.com.
 *
 * Secrets stay in the vault / request headers. Never log them.
 *
 * @module data/signed-fetch
 */

import { getCredentialForVenue } from './credentials';
import { signVenueRequest, type VenueId } from './venues';
import type { ProviderVenue } from './provider';
import { store } from '../store';
import {
  DEFAULT_ONCHAIN_WORKER_BASE,
  looksLikeOnchainWorkerEndpoint,
  normalizeEndpointBase,
} from '../onchain/proxy';

export type SignedFetchOpts = {
  venue: VenueId;
  path: string;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** Skip Worker signed proxy (tests). */
  skipWorkerProxy?: boolean;
  /** AXIS Worker origin for `/api/market/binance/signed/…`. */
  workerBase?: string;
};

function resolveSignedWorkerBase(explicit?: string): string {
  const fromCfg = normalizeEndpointBase(explicit);
  if (fromCfg && looksLikeOnchainWorkerEndpoint(fromCfg)) return fromCfg;
  const fromStore = normalizeEndpointBase(store.endpoint);
  if (fromStore && looksLikeOnchainWorkerEndpoint(fromStore)) return fromStore;
  return DEFAULT_ONCHAIN_WORKER_BASE;
}

function queryRecord(query?: Record<string, string | number | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    out[k] = String(v);
  }
  return out;
}

function queryString(query?: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(queryRecord(query))) p.set(k, v);
  return p.toString();
}

function venueForId(id: VenueId): ProviderVenue {
  return id;
}

/**
 * True when the in-memory vault has a key+secret for this CEX venue.
 */
export function hasSignedCreds(venue: VenueId): boolean {
  const c = getCredentialForVenue(venueForId(venue));
  return !!(c?.apiKey && c?.secret);
}

/**
 * Signed GET JSON. Throws if no credentials or every path fails.
 * Binance: direct HMAC then AXIS Worker `/api/market/binance/signed/klines`.
 */
export async function fetchSignedJson(opts: SignedFetchOpts): Promise<unknown> {
  const cred = getCredentialForVenue(venueForId(opts.venue));
  if (!cred?.apiKey || !cred?.secret) {
    throw new Error(`${opts.venue}: no API key in session vault`);
  }

  const signed = await signVenueRequest(opts.venue, {
    method: 'GET',
    path: opts.path,
    query: opts.query,
    apiKey: cred.apiKey,
    secret: cred.secret,
    passphrase: cred.passphrase,
  });

  try {
    const res = await fetch(signed.url, {
      cache: 'no-store',
      signal: opts.signal,
      headers: { Accept: 'application/json', ...signed.headers },
    });
    if (res.ok) return await res.json();
    if (res.status === 401 || res.status === 403) {
      throw new Error(`${opts.venue}: signed HTTP ${res.status}`);
    }
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (err instanceof Error && /signed HTTP 401|signed HTTP 403/.test(err.message)) throw err;
    // CORS / network — try Worker for Binance klines
  }

  if (
    opts.venue === 'binance' &&
    !opts.skipWorkerProxy &&
    (opts.path === '/api/v3/klines' || opts.path.endsWith('/klines'))
  ) {
    const worker = resolveSignedWorkerBase(opts.workerBase);
    const q = queryString(opts.query);
    const url = `${worker.replace(/\/+$/, '')}/api/market/binance/signed/klines${q ? `?${q}` : ''}`;
    const res = await fetch(url, {
      cache: 'no-store',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        'X-Exchange-Key': cred.apiKey,
        'X-Exchange-Secret': cred.secret,
      },
    });
    if (!res.ok) throw new Error(`binance worker signed: HTTP ${res.status}`);
    return await res.json();
  }

  throw new Error(`${opts.venue}: signed fetch failed`);
}
