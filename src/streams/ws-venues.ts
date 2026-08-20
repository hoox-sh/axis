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
 * Shared venue WS URL + subscribe-message builders.
 *
 * Used by both browser-side {@link StreamPlugin.start} and the Worker
 * Durable Object relay to avoid duplicating per-venue subscription logic.
 *
 * @module streams/ws-venues
 */

export type VenueId = 'binance' | 'okx' | 'bybit' | 'coinbase' | 'kraken';

// ── Symbol normalization ──────────────────────────────────────────

/** OKX instrument id: `BTCUSDT` → `BTC-USDT`. */
function okxInstId(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[-_/]/g, '');
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
  return `${s}-USDT`;
}

/** Coinbase product id: `BTCUSDT` → `BTC-USD` (or `BTC-USDT`). */
function coinbaseProduct(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[-_/]/g, '');
  if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
  if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
  return `${s}-USD`;
}

/** Kraken pair: `BTCUSDT` → `XBTUSDT` (BTC → XBT). */
function krakenPair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[-_/]/g, '');
  let base = s;
  let quote = 'USD';
  if (s.endsWith('USDT')) {
    base = s.slice(0, -4);
    quote = 'USDT';
  } else if (s.endsWith('USD')) {
    base = s.slice(0, -3);
    quote = 'USD';
  }
  if (base === 'BTC') base = 'XBT';
  return `${base}${quote}`;
}

// ── Interval maps ─────────────────────────────────────────────────

const OKX_CHANNEL: Record<string, string> = {
  '1m': 'candle1m',
  '5m': 'candle5m',
  '15m': 'candle15m',
  '1h': 'candle1H',
  '4h': 'candle4H',
  '1d': 'candle1D',
  '1w': 'candle1W',
};

const BYBIT_TOPIC: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
};

const KRAKEN_INTERVAL: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

// ── Public API ────────────────────────────────────────────────────

export interface VenueWsConfig {
  url: string;
  /** Subscribe message to send after WS open. null = URL-based subscription (Binance). */
  subscribe: Record<string, unknown> | string | null;
}

/**
 * Build the WS URL and subscribe message for a venue + symbol + interval.
 * Returns null for offline/mock venues.
 */
export function buildVenueWs(
  venue: VenueId,
  symbol: string,
  interval: string,
): VenueWsConfig | null {
  const sym = symbol.toUpperCase();

  switch (venue) {
    case 'binance': {
      const iv = interval || '1d';
      const path = `/ws/${sym.toLowerCase()}@kline_${iv}`;
      return {
        url: `wss://stream.binance.com:9443${path}`,
        subscribe: null, // URL-based subscription
      };
    }
    case 'okx': {
      const instId = okxInstId(sym);
      const channel = OKX_CHANNEL[interval] || 'candle1D';
      return {
        url: 'wss://ws.okx.com:8443/ws/v5/business',
        subscribe: { op: 'subscribe', args: [{ channel, instId }] },
      };
    }
    case 'bybit': {
      const iv = BYBIT_TOPIC[interval] || 'D';
      const topic = `kline.${iv}.${sym}`;
      return {
        url: 'wss://stream.bybit.com/v5/public/spot',
        subscribe: { op: 'subscribe', args: [topic] },
      };
    }
    case 'coinbase': {
      const product = coinbaseProduct(sym);
      return {
        url: 'wss://advanced-trade-ws.coinbase.com',
        subscribe: { type: 'subscribe', product_ids: [product], channel: 'candles' },
      };
    }
    case 'kraken': {
      const pair = krakenPair(sym);
      const iv = KRAKEN_INTERVAL[interval] || 1440;
      return {
        url: 'wss://ws.kraken.com/',
        subscribe: {
          event: 'subscribe',
          pair: [pair],
          subscription: { name: 'ohlc', interval: iv },
        },
      };
    }
    default:
      return null;
  }
}

/**
 * All supported venue WS URL hosts (for allowlist / validation).
 */
export const VENUE_WS_HOSTS: Record<VenueId, string[]> = {
  binance: ['stream.binance.com'],
  okx: ['ws.okx.com'],
  bybit: ['stream.bybit.com'],
  coinbase: ['advanced-trade-ws.coinbase.com'],
  kraken: ['ws.kraken.com'],
};
