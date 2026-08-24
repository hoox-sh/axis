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
 * Built-in **live OHLCV stream** plugins for AXIS.
 *
 * Each stream implements {@link StreamPlugin}: `start(opts) → stop()`.
 * Live bars are normalized to unix-second `Bar` objects (optional `closed` flag).
 * Venue sockets use {@link openReconnectableWs} with exponential backoff.
 *
 * ## Built-ins
 *
 * | id | Transport | Notes |
 * |----|-----------|-------|
 * | `binance-ws` | WS | `wss://stream.binance.com:9443/ws/{sym}@kline_{iv}` |
 * | `okx-ws` | WS | business channel candle subscribe |
 * | `bybit-ws` | WS | v5 public spot kline |
 * | `coinbase-ws` | WS | Advanced Trade `candles` (venue OHLC; fold into chart TF) |
 * | `kraken-ws` | WS | public OHLC channel |
 * | `mexc-ws` | WS | JSON kline (`wss://wbs.mexc.com/ws`) |
 * | `mock-poll` | local | synthetic ticks (pairs with `mock-walk` / CSV / DEX OHLCV) |
 *
 * ## Lifecycle
 *
 * Caller (`streams/multiplex`) owns one active stream: call `start`, then
 * `stop()` on symbol/interval change or Live off. Status states:
 * `open` | `closed` | `reconnecting`.
 *
 * ## Public API
 *
 * - {@link ensureStreamsRegistered}, {@link getStream}, {@link listStreams}
 * - {@link defaultStreamForSource} — map historical source → sensible stream
 * - {@link registerDynamicStream} / {@link unregisterDynamicStream}
 *
 * @module streams/catalog
 * @see {@link StreamPlugin} in `plugins/types`
 * @see {@link startLive} in `streams/multiplex`
 */

import type { Bar } from '../store/types';
import type { StreamPlugin as UnifiedStreamPlugin } from '../plugins/types';
import { registry } from '../plugins/registry';
import { getDataManagerSelection } from '../data/data-manager-source';
import { defaultStreamForSource as defaultStreamForSourceId } from '../data/provider';
import { openReconnectableWs } from './reconnect-ws';
import { binanceKlineWsUrls } from '../data/binance-http';
import { gatewayWs } from '../data/gateway';
import { mexcSpotSymbol, mexcWsKlineInterval } from '../data/venues/mexc';

/** @deprecated Prefer importing StreamPlugin from plugins/types */
export type StreamPlugin = UnifiedStreamPlugin;

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

function intervalToSec(iv: string): number {
  const m = /^(\d+)([mhdw])$/.exec(iv || '');
  if (!m) return 86400;
  const n = parseInt(m[1], 10);
  const mult: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800 };
  return n * (mult[m[2]] || 86400);
}

export const binanceStream: StreamPlugin = {
  id: 'binance-ws',
  name: 'Binance WebSocket',
  kind: 'stream',
  builtIn: true,
  description:
    'Real-time klines via stream.binance.com (auto-reconnect; rotates :9443 → :443 → data-stream).',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'binance',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {},
  start({ symbol, interval, onBar, onStatus, onError }) {
    const wsInterval = INTERVAL_MAP[interval] || interval;
    const urls = binanceKlineWsUrls(String(symbol || ''), wsInterval);
    return openReconnectableWs({
      url: urls[0] || `wss://stream.binance.com:9443/ws/${String(symbol || '').toLowerCase()}@kline_${wsInterval}`,
      urls,
      onStatus,
      onError,
      onMessage: (e) => {
        try {
          const data = JSON.parse(e.data as string);
          const k = data.k;
          if (!k) return;
          onBar({
            time: Math.floor(k.t / 1000),
            open: +k.o,
            high: +k.h,
            low: +k.l,
            close: +k.c,
            volume: +k.v,
            closed: !!k.x,
          });
        } catch {
          /* ignore */
        }
      },
    });
  },
};

/** Offline live feed — synthesizes bars on a timer. */
export const mockPollStream: StreamPlugin = {
  id: 'mock-poll',
  name: 'Mock Poll',
  kind: 'stream',
  builtIn: true,
  description: 'Synthetic live bars (offline). Good with Mock Walk source.',
  capabilities: { offline: true, transport: 'local', venue: 'mock', klineStream: false },
  configSchema: {},
  start({ interval, onBar, onStatus, lastBar }) {
    const step = intervalToSec(interval);
    let stopped = false;
    let cur: Bar = lastBar
      ? { ...lastBar }
      : {
          time: Math.floor(Date.now() / 1000) - step,
          open: 100,
          high: 101,
          low: 99,
          close: 100,
          volume: 100,
        };

    onStatus({ state: 'open', detail: 'mock-poll' });

    const tick = () => {
      if (stopped) return;
      const now = Math.floor(Date.now() / 1000);
      const slot = Math.floor(now / step) * step;
      const drift = (Math.random() - 0.48) * cur.close * 0.008;
      if (slot === cur.time) {
        const close = Math.max(0.01, cur.close + drift);
        cur = {
          ...cur,
          high: Math.max(cur.high, close, cur.open),
          low: Math.min(cur.low, close, cur.open),
          close,
          volume: (cur.volume ?? 0) + Math.random() * 50,
          closed: false,
        };
      } else {
        // New interval slot — multiplex treats time advance as bar-close
        const open = cur.close;
        const close = Math.max(0.01, open + drift);
        cur = {
          time: slot,
          open,
          high: Math.max(open, close),
          low: Math.min(open, close),
          close,
          volume: 50 + Math.random() * 200,
          closed: true,
        };
      }
      if (stopped) return;
      onBar({ ...cur });
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(id);
      onStatus({ state: 'closed' });
    };
  },
};

/** OKX public WS candle channel (books limited; trades/candles public). */
export const okxStream: StreamPlugin = {
  id: 'okx-ws',
  name: 'OKX WebSocket',
  kind: 'stream',
  builtIn: true,
  description: 'OKX public candle channel (wss://ws.okx.com:8443/ws/v5/business).',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'okx',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {},
  start({ symbol, interval, onBar, onStatus, onError }) {
    const instId = (() => {
      const s = symbol.toUpperCase().replace(/[-_/]/g, '');
      if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
      return `${s}-USDT`;
    })();
    const barMap: Record<string, string> = {
      '1m': 'candle1m',
      '5m': 'candle5m',
      '15m': 'candle15m',
      '1h': 'candle1H',
      '4h': 'candle4H',
      '1d': 'candle1D',
      '1w': 'candle1W',
    };
    const channel = barMap[interval] || 'candle1D';
    const url = 'wss://ws.okx.com:8443/ws/v5/business';
    return openReconnectableWs({
      url,
      onStatus,
      onError,
      onOpen: (ws) => {
        ws.send(
          JSON.stringify({
            op: 'subscribe',
            args: [{ channel, instId }],
          }),
        );
      },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          const row = msg?.data?.[0];
          if (!row || !Array.isArray(row)) return;
          // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
          const confirm = row[8];
          onBar({
            time: Math.floor(Number(row[0]) / 1000),
            open: +row[1],
            high: +row[2],
            low: +row[3],
            close: +row[4],
            volume: +row[5],
            closed: confirm === '1' || confirm === 1 || confirm === true,
          });
        } catch {
          /* ignore */
        }
      },
    });
  },
};

/** Bybit v5 public kline stream (spot). */
export const bybitStream: StreamPlugin = {
  id: 'bybit-ws',
  name: 'Bybit WebSocket',
  kind: 'stream',
  builtIn: true,
  description: 'Bybit public kline stream (wss://stream.bybit.com/v5/public/spot).',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'bybit',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {},
  start({ symbol, interval, onBar, onStatus, onError }) {
    const ivMap: Record<string, string> = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '1h': '60',
      '4h': '240',
      '1d': 'D',
      '1w': 'W',
    };
    const iv = ivMap[interval] || 'D';
    const topic = `kline.${iv}.${symbol.toUpperCase()}`;
    const url = 'wss://stream.bybit.com/v5/public/spot';
    return openReconnectableWs({
      url,
      onStatus,
      onError,
      onOpen: (ws) => {
        ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
      },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          const row = msg?.data?.[0];
          if (!row) return;
          onBar({
            time: Math.floor(Number(row.start) / 1000),
            open: +row.open,
            high: +row.high,
            low: +row.low,
            close: +row.close,
            volume: +row.volume,
            closed: row.confirm === true || row.confirm === 'true',
          });
        } catch {
          /* ignore */
        }
      },
    });
  },
};

/**
 * Fold a venue 1m (or native) candle into the chart interval using the
 * candle's **exchange** start time — never wall-clock Date.now().
 */
export function foldVenueCandle(
  cur: Bar | null,
  startSec: number,
  ohlcv: { open: number; high: number; low: number; close: number; volume: number },
  stepSec: number,
  opts?: { mergeVolume?: boolean },
): Bar {
  const step = stepSec > 0 ? stepSec : 60;
  const slot = Math.floor(startSec / step) * step;
  if (!cur || cur.time !== slot) {
    return {
      time: slot,
      open: ohlcv.open,
      high: ohlcv.high,
      low: ohlcv.low,
      close: ohlcv.close,
      volume: ohlcv.volume,
      closed: !!cur && cur.time !== slot,
    };
  }
  const addVol = opts?.mergeVolume !== false;
  return {
    time: slot,
    open: cur.open,
    high: Math.max(cur.high, ohlcv.high),
    low: Math.min(cur.low, ohlcv.low),
    close: ohlcv.close,
    volume: addVol ? (cur.volume ?? 0) + ohlcv.volume : (cur.volume ?? ohlcv.volume),
    closed: false,
  };
}

/** Coinbase Advanced Trade candles (venue OHLC, not ticker buckets). */
export const coinbaseStream: StreamPlugin = {
  id: 'coinbase-ws',
  name: 'Coinbase WebSocket',
  kind: 'stream',
  builtIn: true,
  description:
    'Coinbase Advanced Trade candles (wss://advanced-trade-ws.coinbase.com). Venue OHLC folded into the chart interval.',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'coinbase',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {},
  start({ symbol, interval, onBar, onStatus, onError, lastBar }) {
    const product = (() => {
      const s = symbol.toUpperCase().replace(/[-_/]/g, '');
      if (s.endsWith('USDT')) return `${s.slice(0, -4)}-USDT`;
      if (s.endsWith('USD')) return `${s.slice(0, -3)}-USD`;
      return `${s}-USD`;
    })();
    const step = intervalToSec(interval);
    const url = 'wss://advanced-trade-ws.coinbase.com';
    let cur: Bar | null = lastBar ? { ...lastBar } : null;
    // First fold into a REST lastBar must not add 1m volume (would double-count).
    let seededFromLast = !!lastBar;
    return openReconnectableWs({
      url,
      onStatus,
      onError,
      onOpen: (ws) => {
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: [product],
            channel: 'candles',
          }),
        );
      },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          const events = Array.isArray(msg?.events) ? msg.events : [];
          for (const ev of events) {
            const candles = Array.isArray(ev?.candles) ? ev.candles : [];
            for (const c of candles) {
              const startSec = Math.floor(Number(c.start) || Number(c.start_time) || 0);
              if (!Number.isFinite(startSec) || startSec <= 0) continue;
              const ohlcv = {
                open: +c.open,
                high: +c.high,
                low: +c.low,
                close: +c.close,
                volume: +c.volume || 0,
              };
              if (![ohlcv.open, ohlcv.high, ohlcv.low, ohlcv.close].every(Number.isFinite)) {
                continue;
              }
              const mergeVolume = !(seededFromLast && cur && cur.time === Math.floor(startSec / step) * step);
              cur = foldVenueCandle(cur, startSec, ohlcv, step, { mergeVolume });
              seededFromLast = false;
              onBar({ ...cur });
            }
          }
        } catch {
          /* ignore */
        }
      },
    });
  },
};

/** Kraken public OHLC channel. */
export const krakenStream: StreamPlugin = {
  id: 'kraken-ws',
  name: 'Kraken WebSocket',
  kind: 'stream',
  builtIn: true,
  description: 'Kraken public OHLC (wss://ws.kraken.com/).',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'kraken',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {},
  start({ symbol, interval, onBar, onStatus, onError }) {
    const pair = (() => {
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
      return `${base}/${quote}`;
    })();
    const ivMap: Record<string, number> = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '1h': 60,
      '4h': 240,
      '1d': 1440,
      '1w': 10080,
    };
    const intervalMin = ivMap[interval] || 1440;
    const url = 'wss://ws.kraken.com/';
    return openReconnectableWs({
      url,
      onStatus,
      onError,
      onOpen: (ws) => {
        ws.send(
          JSON.stringify({
            event: 'subscribe',
            pair: [pair],
            subscription: { name: 'ohlc', interval: intervalMin },
          }),
        );
      },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          // [channelID, [time, etime, o, h, l, c, vwap, volume, count], "ohlc-*", "PAIR"]
          if (!Array.isArray(msg) || !Array.isArray(msg[1])) return;
          const row = msg[1];
          if (row.length < 8) return;
          onBar({
            time: Math.floor(Number(row[1])), // etime
            open: +row[2],
            high: +row[3],
            low: +row[4],
            close: +row[5],
            volume: +row[7],
            // Kraken does not always send a closed flag; multiplex uses time advance fallback
            closed: false,
          });
        } catch {
          /* ignore */
        }
      },
    });
  },
};

/** MEXC public JSON kline stream (spot). */
export const mexcStream: StreamPlugin = {
  id: 'mexc-ws',
  name: 'MEXC WebSocket',
  kind: 'stream',
  builtIn: true,
  description: 'MEXC public kline stream (wss://wbs.mexc.com/ws). JSON channel, 15s PING.',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'mexc',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {},
  start({ symbol, interval, onBar, onStatus, onError }) {
    const sym = mexcSpotSymbol(symbol);
    const iv = mexcWsKlineInterval(interval);
    const channel = `${sym}@kline@${iv}`;
    const urls = ['wss://wbs.mexc.com/ws', 'wss://wbs-api.mexc.com/ws'];
    let ping: ReturnType<typeof setInterval> | undefined;
    const stopWs = openReconnectableWs({
      url: urls[0]!,
      urls,
      onStatus,
      onError,
      onOpen: (ws) => {
        ws.send(JSON.stringify({ method: 'SUBSCRIPTION', params: [channel] }));
        if (ping) clearInterval(ping);
        ping = setInterval(() => {
          try {
            ws.send(JSON.stringify({ method: 'PING' }));
          } catch {
            /* closed */
          }
        }, 15_000);
      },
      onMessage: (e) => {
        try {
          const msg = JSON.parse(e.data as string) as {
            d?: { k?: Record<string, unknown> };
            k?: Record<string, unknown>;
            c?: string;
          };
          const k = msg?.d?.k || msg?.k;
          if (!k) return;
          const t = Number(k.t);
          const open = Number(k.o);
          const high = Number(k.h);
          const low = Number(k.l);
          const close = Number(k.c);
          const volume = Number(k.v);
          if (!Number.isFinite(t) || t <= 0) return;
          if (![open, high, low, close].every(Number.isFinite)) return;
          onBar({
            time: Math.floor(t / 1000),
            open,
            high,
            low,
            close,
            volume: Number.isFinite(volume) ? volume : 0,
            closed: false,
          });
        } catch {
          /* ignore */
        }
      },
    });
    return () => {
      if (ping) clearInterval(ping);
      ping = undefined;
      stopWs();
    };
  },
};

/**
 * CCXT live kline stream via datafeed gateway WebSocket.
 * Routes through the PYNE datafeed gateway or local sidecar.
 */
export const ccxtWsStream: StreamPlugin = {
  id: 'ccxt-ws',
  name: 'CCXT WS (Gateway)',
  kind: 'stream',
  builtIn: true,
  description: 'Real-time klines via datafeed gateway WebSocket.',
  capabilities: {
    needsNetwork: true,
    transport: 'ws',
    venue: 'generic',
    market: 'spot',
    klineStream: true,
  },
  configSchema: {
    exchange: { type: 'string', default: '', label: 'Exchange ID' },
    gateway: {
      type: 'select',
      default: 'auto',
      label: 'Gateway',
      options: ['auto', 'pyne', 'sidecar'],
      advanced: true,
    },
  },
  start({ symbol, interval, onBar, onStatus, onError, config }) {
    const exchange = String(config?.exchange ?? '').trim();
    if (!exchange) {
      onError?.(new Error('ccxt-ws: exchange id not configured (stream settings)'));
      return () => {};
    }
    const gateway = String(config?.gateway ?? 'auto') as 'auto' | 'pyne' | 'sidecar';
    let stopped = false;
    let ws: WebSocket | undefined;
    void import('../data/ccxt-session').then(({ bindCcxtSession }) => bindCcxtSession(gateway, exchange)).then((cred) => {
      if (stopped) return;
      const q = new URLSearchParams({
        exchange,
        symbol,
        timeframe: interval,
      });
      if (cred) q.set('cred', cred);
      ws = gatewayWs(gateway, `/watch?${q.toString()}`);
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const frame = JSON.parse(String(ev.data));
          onBar({
            time: frame.time,
            open: frame.open,
            high: frame.high,
            low: frame.low,
            close: frame.close,
            volume: frame.volume,
            closed: frame.closed,
          });
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = (ev: Event) => onError?.(new Error(String(ev)));
      ws.onopen = () => onStatus?.({ state: 'open' });
      ws.onclose = () => onStatus?.({ state: 'closed' });
    }).catch((err: unknown) => {
      if (!stopped) onError?.(err instanceof Error ? err : new Error(String(err)));
    });
    return () => {
      stopped = true;
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  },
};

export const BUILTIN_STREAMS: StreamPlugin[] = [
  binanceStream,
  okxStream,
  bybitStream,
  coinbaseStream,
  krakenStream,
  mexcStream,
  ccxtWsStream,
  mockPollStream,
];

let registered = false;

/** Idempotent registration of {@link BUILTIN_STREAMS} into the unified registry. */
export function ensureStreamsRegistered(): void {
  if (registered) return;
  registered = true;
  for (const s of BUILTIN_STREAMS) {
    if (!registry.getStream(s.id)) {
      registry.registerStream(s);
    }
  }
}

/** Look up a stream by id (ensures built-ins are registered). */
export function getStream(id: string): StreamPlugin | undefined {
  ensureStreamsRegistered();
  return registry.getStream(id);
}

/** All registered streams in registration order. */
export function listStreams(): StreamPlugin[] {
  ensureStreamsRegistered();
  return registry.listStreams();
}

/** Register a runtime stream plugin (dynamic URL loader). */
export function registerDynamicStream(stream: StreamPlugin): void {
  ensureStreamsRegistered();
  if (!stream?.id || typeof stream.start !== 'function') throw new Error('Invalid stream plugin');
  const withKind: StreamPlugin = {
    ...stream,
    kind: 'stream',
    builtIn: stream.builtIn ?? false,
  };
  registry.registerStream(withKind);
}

export function unregisterDynamicStream(id: string): boolean {
  ensureStreamsRegistered();
  return registry.unregisterStream(id);
}

export function listDynamicStreamIds(): string[] {
  ensureStreamsRegistered();
  return registry
    .listStreams()
    .filter((s) => !s.builtIn)
    .map((s) => s.id);
}

/** Pick a sensible stream for the current historical source. */
export function defaultStreamForSource(sourceId: string): string {
  const underlying =
    sourceId === 'data-manager'
      ? getDataManagerSelection()?.sourceId
      : undefined;
  return defaultStreamForSourceId(sourceId, underlying);
}

/** @internal test helper */
export function _resetStreamRegistrationFlag() {
  registered = false;
}
