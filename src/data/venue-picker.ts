// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Topbar Venue token: a UI projection over source plugin id + CCXT exchange bag.
 *
 * Native CEX / mock / csv / gecko / cache use the source plugin id as the
 * select value. Pinned long-tail rows use `ccxt:<id>`. Catch-all `ccxt:`
 * shows the Exchange ID field. Never write `ccxt:bitget` into `store.source`.
 *
 * @module data/venue-picker
 */

import { setActivePlugin } from '../store';
import { writePluginField } from '../ui/plugin-config';

export const PINNED_CCXT: readonly string[] = [
  'bitget',
  'kucoin',
  'gateio',
  'htx',
  'phemex',
  'bingx',
];

export const NATIVE_VENUE_SOURCES: readonly { id: string; label: string }[] = [
  { id: 'binance-rest', label: 'Binance' },
  { id: 'okx-rest', label: 'OKX' },
  { id: 'bybit-rest', label: 'Bybit' },
  { id: 'coinbase-rest', label: 'Coinbase' },
  { id: 'kraken-rest', label: 'Kraken' },
  { id: 'mexc-rest', label: 'MEXC' },
];

export const OTHER_VENUE_SOURCES: readonly { id: string; label: string }[] = [
  { id: 'geckoterminal-ohlcv', label: 'GeckoTerminal' },
  { id: 'mock-walk', label: 'Mock' },
  { id: 'csv-upload', label: 'CSV' },
  { id: 'data-manager', label: 'Data Manager' },
];

const NATIVE_IDS = new Set(NATIVE_VENUE_SOURCES.map((v) => v.id));
const OTHER_IDS = new Set(OTHER_VENUE_SOURCES.map((v) => v.id));

export type VenueGroup = 'native' | 'ccxt' | 'other' | 'plugin';

export type VenueOption = {
  value: string;
  label: string;
  group: VenueGroup;
};

const CCXT_LABEL: Record<string, string> = {
  bitget: 'Bitget',
  kucoin: 'KuCoin',
  gateio: 'Gate.io',
  htx: 'HTX',
  phemex: 'Phemex',
  bingx: 'BingX',
};

export function prettyCcxtLabel(id: string): string {
  const k = String(id || '').trim().toLowerCase();
  if (CCXT_LABEL[k]) return `${CCXT_LABEL[k]} (CCXT)`;
  if (!k) return 'CCXT…';
  return `${k.charAt(0).toUpperCase()}${k.slice(1)} (CCXT)`;
}

export function isCcxtVenueToken(token: string): boolean {
  return token === 'ccxt:' || token.startsWith('ccxt:');
}

/** `ccxt:bitget` → `bitget`; catch-all `ccxt:` → `''`. */
export function exchangeIdFromToken(token: string): string | undefined {
  if (token === 'ccxt:') return '';
  if (token.startsWith('ccxt:') && token.length > 5) return token.slice(5);
  return undefined;
}

export function parseVenueToken(token: string): { sourceId: string; exchange?: string } {
  const t = String(token || '').trim();
  if (t === 'ccxt:' || t.startsWith('ccxt:')) {
    const exchange = exchangeIdFromToken(t);
    return { sourceId: 'ccxt-rest', exchange };
  }
  return { sourceId: t };
}

/**
 * Select value that round-trips current source + CCXT bag.
 * Ignore leftover `pluginsConfig.exchange` unless source is `ccxt-rest`.
 */
export function venueTokenFromState(sourceId: string, ccxtExchange: string): string {
  const src = String(sourceId || '').trim();
  if (src !== 'ccxt-rest') return src || 'binance-rest';
  const ex = String(ccxtExchange || '').trim().toLowerCase();
  if (!ex) return 'ccxt:';
  if ((PINNED_CCXT as readonly string[]).includes(ex)) return `ccxt:${ex}`;
  return 'ccxt:';
}

/** Pair source+stream and, for CCXT tokens, both exchange bags. */
export function applyVenueToken(token: string): void {
  const { sourceId, exchange } = parseVenueToken(token);
  if (sourceId === 'ccxt-rest' && exchange) {
    writePluginField('source:ccxt-rest', 'exchange', exchange);
    writePluginField('stream:ccxt-ws', 'exchange', exchange);
  }
  setActivePlugin('source', sourceId);
}

export function listVenueOptions(
  extraSources: Array<{ id: string; name: string }> = [],
  currentCcxtExchange = '',
): VenueOption[] {
  const out: VenueOption[] = [];
  for (const v of NATIVE_VENUE_SOURCES) {
    out.push({ value: v.id, label: v.label, group: 'native' });
  }
  const seen = new Set<string>(PINNED_CCXT);
  for (const id of PINNED_CCXT) {
    out.push({ value: `ccxt:${id}`, label: prettyCcxtLabel(id), group: 'ccxt' });
  }
  const cur = String(currentCcxtExchange || '').trim().toLowerCase();
  if (cur && !seen.has(cur) && !(NATIVE_VENUE_SOURCES.some((n) => n.label.toLowerCase() === cur))) {
    out.push({ value: `ccxt:${cur}`, label: prettyCcxtLabel(cur), group: 'ccxt' });
  }
  out.push({ value: 'ccxt:', label: 'CCXT…', group: 'ccxt' });
  for (const v of OTHER_VENUE_SOURCES) {
    out.push({ value: v.id, label: v.label, group: 'other' });
  }
  for (const s of extraSources) {
    if (NATIVE_IDS.has(s.id) || OTHER_IDS.has(s.id) || s.id === 'ccxt-rest') continue;
    out.push({ value: s.id, label: s.name, group: 'plugin' });
  }
  return out;
}
