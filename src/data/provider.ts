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
 * Provider session — the venue identity every aggregator must inherit.
 *
 * AXIS is composable (source × stream × engine), but OHLCV aggregation is not:
 * mixing Binance history with OKX live (or Kraken quotes on a Binance chart)
 * silently poisons indicators, compare, watchlist, and cache.
 *
 * {@link ProviderSession} is the lock. Plugin `capabilities.venue` is the
 * source of truth; id substring matching is the fallback for dynamic plugins.
 *
 * @module data/provider
 */

import type { PluginCapabilities } from '../plugins/types';

/** Exchange / plane identity for CEX + synthetic + DEX. */
export type ProviderVenue =
  | 'binance'
  | 'okx'
  | 'bybit'
  | 'coinbase'
  | 'kraken'
  | 'gecko'
  | 'mock'
  | 'upload'
  | 'cache'
  | 'generic';

export type ProviderAuthMode = 'public' | 'authenticated';
export type ProviderMarket = 'spot' | 'linear' | 'inverse' | 'option';
export type ProviderGateway = 'direct' | 'worker' | 'pyne' | 'sidecar';

/**
 * Active market-data identity. Secrets never live here — only a vault
 * {@link ProviderSession.credentialId} handle.
 */
export interface ProviderSession {
  /** Venue id (`binance`) or long-tail `ccxt:<exchange>`. */
  id: string;
  sourceId: string;
  streamId: string;
  venue: ProviderVenue;
  market: ProviderMarket;
  authMode: ProviderAuthMode;
  /** Vault ref; never the API secret. */
  credentialId?: string;
  gateway: ProviderGateway;
}

export const DEFAULT_PROVIDER: ProviderSession = {
  id: 'binance',
  sourceId: 'binance-rest',
  streamId: 'binance-ws',
  venue: 'binance',
  market: 'spot',
  authMode: 'public',
  gateway: 'direct',
};

const VENUE_LABEL: Record<ProviderVenue, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  gecko: 'GeckoTerminal',
  mock: 'Mock',
  upload: 'Upload',
  cache: 'Cache',
  generic: 'Generic',
};

/** Human venue name for HUD / symbol modal. */
export function providerVenueLabel(venue: ProviderVenue): string {
  return VENUE_LABEL[venue] || venue;
}

/** Compact HUD / status label, e.g. `Binance spot · public`. */
export function formatProviderLabel(p: Pick<ProviderSession, 'venue' | 'market' | 'authMode'>): string {
  const auth = p.authMode === 'authenticated' ? 'key' : 'public';
  return `${providerVenueLabel(p.venue)} ${p.market} · ${auth}`;
}

/**
 * Map a plugin id to a venue. Prefer {@link venueFromCapabilities} when the
 * plugin is registered — this is the fallback for unknown / dynamic ids.
 */
export function venueFromPluginId(id: string | undefined | null): ProviderVenue | null {
  if (!id) return null;
  const s = id.toLowerCase();
  if (s.includes('binance')) return 'binance';
  if (s.includes('okx')) return 'okx';
  if (s.includes('bybit')) return 'bybit';
  if (s.includes('coinbase')) return 'coinbase';
  if (s.includes('kraken')) return 'kraken';
  if (s.includes('gecko')) return 'gecko';
  if (s.includes('mock')) return 'mock';
  if (s.includes('csv') || s.includes('upload')) return 'upload';
  if (s === 'data-manager' || s.includes('cache')) return 'cache';
  return null;
}

/** Read `capabilities.venue` when declared. */
export function venueFromCapabilities(
  caps?: PluginCapabilities | null,
): ProviderVenue | null {
  const v = caps?.venue;
  if (
    v === 'binance' ||
    v === 'okx' ||
    v === 'bybit' ||
    v === 'coinbase' ||
    v === 'kraken' ||
    v === 'gecko' ||
    v === 'mock' ||
    v === 'upload' ||
    v === 'cache' ||
    v === 'generic'
  ) {
    return v;
  }
  return null;
}

function venueOf(
  id: string | undefined,
  caps?: PluginCapabilities | null,
): ProviderVenue | null {
  return venueFromCapabilities(caps) || venueFromPluginId(id);
}

/**
 * Resolve the venue for a source (+ optional stream hint).
 * Data Manager: pass the cached series' underlying source as
 * `opts.underlyingSourceId` (caller reads {@link getDataManagerSelection}).
 */
export function resolveProviderVenue(
  sourceId: string,
  streamId?: string,
  opts?: {
    sourceCaps?: PluginCapabilities | null;
    streamCaps?: PluginCapabilities | null;
    /** Data Manager cache row's venue source id. */
    underlyingSourceId?: string;
  },
): ProviderVenue {
  if (sourceId === 'data-manager') {
    const fromCache = venueOf(opts?.underlyingSourceId);
    if (fromCache && fromCache !== 'cache') return fromCache;
    const fromStream = venueOf(streamId, opts?.streamCaps);
    if (fromStream && fromStream !== 'mock' && fromStream !== 'generic') {
      return fromStream;
    }
    return 'binance';
  }

  const fromSource = venueOf(sourceId, opts?.sourceCaps);
  if (fromSource && fromSource !== 'generic' && fromSource !== 'mock' && fromSource !== 'upload') {
    return fromSource;
  }

  // Offline / synthetic history: honour an exchange stream selection
  const fromStream = venueOf(streamId, opts?.streamCaps);
  if (fromStream && fromStream !== 'mock' && fromStream !== 'generic') return fromStream;
  if (fromSource) return fromSource;
  if (fromStream) return fromStream;
  return 'generic';
}

const OFFLINE_STREAM = 'mock-poll';

const SOURCE_STREAM: Record<string, string> = {
  'binance-rest': 'binance-ws',
  'okx-rest': 'okx-ws',
  'bybit-rest': 'bybit-ws',
  'coinbase-rest': 'coinbase-ws',
  'kraken-rest': 'kraken-ws',
  'ccxt-rest': 'ccxt-ws',
};

/**
 * Matching live stream for a historical source.
 *
 * Data Manager: pass the cache row's venue source id as `underlyingSourceId`
 * (same as {@link resolveProviderVenue}).
 */
export function defaultStreamForSource(
  sourceId: string,
  underlyingSourceId?: string,
): string {
  if (
    sourceId === 'mock-walk' ||
    sourceId === 'csv-upload' ||
    sourceId === 'geckoterminal-ohlcv'
  ) {
    return OFFLINE_STREAM;
  }
  if (sourceId === 'data-manager') {
    const venue = underlyingSourceId ? String(underlyingSourceId) : '';
    if (venue && venue !== 'data-manager' && venue !== 'csv-upload') {
      return defaultStreamForSource(venue);
    }
    return 'binance-ws';
  }
  return SOURCE_STREAM[sourceId] || 'binance-ws';
}

/** True when live stream is the default pair for this source. */
export function isSourceStreamPaired(
  sourceId: string,
  streamId: string,
  underlyingSourceId?: string,
): boolean {
  if (!streamId) return false;
  return defaultStreamForSource(sourceId, underlyingSourceId) === streamId;
}

export function buildProviderSession(
  sourceId: string,
  streamId: string,
  opts?: {
    sourceCaps?: PluginCapabilities | null;
    streamCaps?: PluginCapabilities | null;
    authMode?: ProviderAuthMode;
    credentialId?: string;
    gateway?: ProviderGateway;
    market?: ProviderMarket;
    underlyingSourceId?: string;
  },
): ProviderSession {
  const venue = resolveProviderVenue(sourceId, streamId, opts);
  const market = opts?.market || opts?.sourceCaps?.market || 'spot';
  return {
    id: venue === 'generic' ? sourceId || 'generic' : venue,
    sourceId,
    streamId: streamId || defaultStreamForSource(sourceId),
    venue,
    market,
    authMode: opts?.authMode === 'authenticated' ? 'authenticated' : 'public',
    credentialId: opts?.credentialId,
    gateway: opts?.gateway || 'direct',
  };
}

const AUTH_MODES: ProviderAuthMode[] = ['public', 'authenticated'];
const MARKETS: ProviderMarket[] = ['spot', 'linear', 'inverse', 'option'];
const GATEWAYS: ProviderGateway[] = ['direct', 'worker', 'pyne', 'sidecar'];

/** Hydrate a persisted provider bag; never trust secrets from disk. */
export function hydrateProviderSession(
  raw: unknown,
  sourceId: string,
  streamId: string,
): ProviderSession {
  const base = buildProviderSession(sourceId, streamId);
  if (!raw || typeof raw !== 'object') return base;
  const bag = raw as Record<string, unknown>;
  const authMode = AUTH_MODES.includes(bag.authMode as ProviderAuthMode)
    ? (bag.authMode as ProviderAuthMode)
    : base.authMode;
  const market = MARKETS.includes(bag.market as ProviderMarket)
    ? (bag.market as ProviderMarket)
    : base.market;
  const gateway = GATEWAYS.includes(bag.gateway as ProviderGateway)
    ? (bag.gateway as ProviderGateway)
    : base.gateway;
  const credentialId =
    typeof bag.credentialId === 'string' && bag.credentialId.trim()
      ? bag.credentialId.trim()
      : undefined;
  return {
    ...base,
    authMode,
    market,
    gateway,
    credentialId,
  };
}

/** Durable slice — no secrets. */
export function persistProviderSession(p: ProviderSession): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: p.id,
    sourceId: p.sourceId,
    streamId: p.streamId,
    venue: p.venue,
    market: p.market,
    authMode: p.authMode,
    gateway: p.gateway,
  };
  if (p.credentialId) out.credentialId = p.credentialId;
  return out;
}
