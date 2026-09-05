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
 * Minimal Binance kline WebSocket stream (no auto-reconnect).
 *
 * **Prefer** `streams/catalog.ts` → `binanceStream` for production AXIS:
 * that path uses {@link openReconnectableWs} and the unified plugin registry.
 * This module remains as a thin standalone reference / older import path.
 *
 * Contract: `start({ symbol, interval, onBar, onStatus, onError }) → stop()`.
 * URL: `wss://stream.binance.com:9443/ws/{symbol}@kline_{interval}`.
 *
 * @module streams/binance
 * @deprecated Use `binanceStream` from `streams/catalog` in new code.
 */

import type { Bar } from '../store/types';

/** Local stream shape (subset of plugins/types StreamPlugin). */
export interface StreamPlugin {
  id: string;
  name: string;
  start(opts: {
    symbol: string;
    interval: string;
    onBar: (bar: Bar) => void;
    onStatus: (status: { state: string }) => void;
    onError: (err: Error) => void;
  }): () => void;
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '8h': '8h',
  '12h': '12h',
  '1d': '1d',
  '3d': '3d',
  '1w': '1w',
  '1M': '1M',
};

/** Single-symbol Binance public kline stream (no reconnect). */
export const binanceStream: StreamPlugin = {
  id: 'binance-ws',
  name: 'Binance WebSocket',
  start({ symbol, interval, onBar, onStatus, onError }) {
    const wsInterval = INTERVAL_MAP[interval] || interval;
    const sym = String(symbol || '').toLowerCase();
    const url = `wss://stream.binance.com:9443/ws/${sym}@kline_${wsInterval}`;
    let stopped = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      onError(e instanceof Error ? e : new Error(String(e)));
      return () => {};
    }

    ws.onopen = () => {
      if (stopped) return;
      try {
        onStatus({ state: 'open' });
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      if (stopped) return;
      try {
        onError(new Error('WebSocket error'));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      try {
        onStatus({ state: 'closed' });
      } catch {
        /* ignore */
      }
    };

    ws.onmessage = (e) => {
      if (stopped) return;
      try {
        const data = JSON.parse(e.data as string);
        const k = data?.k;
        if (!k) return;
        const time = Math.floor(Number(k.t) / 1000);
        const open = +k.o;
        const high = +k.h;
        const low = +k.l;
        const close = +k.c;
        const volume = +k.v;
        if (
          !Number.isFinite(time) ||
          time <= 0 ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close)
        ) {
          return;
        }
        const bar: Bar = {
          time,
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) && volume >= 0 ? volume : undefined,
        };
        onBar(bar);
      } catch {
        /* ignore malformed frames */
      }
    };

    return () => {
      if (stopped) return;
      stopped = true;
      try {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.onopen = null;
        ws.close();
      } catch {
        /* ignore */
      }
    };
  },
};
