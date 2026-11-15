// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * One Binance kline socket for the chart.
 *
 * Symbol and interval changes are SUBSCRIBE / UNSUBSCRIBE on the combined
 * stream. Closing the raw `/ws/<sym>@kline` socket on every switch raced
 * Binance's ping and Chromium logged "Ping received after close" while the
 * Live chip stayed up. `stop()` from a restart is deferred one turn so the
 * following `start()` can retarget the same socket instead of closing it.
 *
 * @module streams/binance-kline
 */

import { binanceCombinedStreamUrls } from '../data/binance-http';
import { sanitizeStreamBar } from '../data/parse-bars';
import type { Bar } from '../store/types';
import { openReconnectableWs } from './reconnect-ws';

export interface BinanceKlineHandlers {
  onBar: (bar: Bar) => void;
  onStatus: (s: { state: string; url?: string; detail?: string }) => void;
  onError: (e: Error) => void;
}

interface LiveSocket {
  stopWs: () => void;
  ws: WebSocket | null;
  param: string;
  urls: string[];
  handlers: BinanceKlineHandlers;
}

let live: LiveSocket | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let subId = 1;

function send(ws: WebSocket | null, method: 'SUBSCRIBE' | 'UNSUBSCRIBE', param: string): void {
  if (ws?.readyState !== 1 || !param) return;
  try {
    ws?.send(JSON.stringify({ method, params: [param], id: ++subId }));
  } catch {
    /* socket closing */
  }
}

function klineFromFrame(raw: string, onBar: (bar: Bar) => void): void {
  const data = JSON.parse(raw) as { data?: { k?: Record<string, unknown> }; k?: Record<string, unknown> };
  const k = data?.data?.k || data?.k;
  if (!k) return;
  const bar = sanitizeStreamBar({
    time: Math.floor(Number(k['t']) / 1000),
    open: k['o'],
    high: k['h'],
    low: k['l'],
    close: k['c'],
    volume: k['v'],
    closed: !!k['x'],
  });
  if (bar) onBar(bar);
}

function retarget(nextParam: string, handlers: BinanceKlineHandlers): void {
  if (!live) return;
  live.handlers = handlers;
  if (live.param === nextParam) return;
  const prev = live.param;
  live.param = nextParam;
  if (live.ws && live.ws.readyState === 1) {
    if (prev) send(live.ws, 'UNSUBSCRIBE', prev);
    send(live.ws, 'SUBSCRIBE', nextParam);
  }
}

function teardown(): void {
  const cur = live;
  live = null;
  if (!cur) return;
  try {
    cur.stopWs();
  } catch {
    /* ignore */
  }
}

function open(param: string, urls: string[], handlers: BinanceKlineHandlers): LiveSocket {
  const session: LiveSocket = {
    stopWs: () => {},
    ws: null,
    param,
    urls,
    handlers,
  };
  session.stopWs = openReconnectableWs({
    url: urls[0] || 'wss://data-stream.binance.vision/stream',
    urls,
    onStatus: (s) => session.handlers.onStatus(s),
    onError: (e) => session.handlers.onError(e),
    onOpen: (ws) => {
      session.ws = ws;
      send(ws, 'SUBSCRIBE', session.param);
    },
    onMessage: (ev) => {
      try {
        klineFromFrame(String(ev.data ?? ''), session.handlers.onBar);
      } catch {
        /* ignore acks and junk */
      }
    },
  });
  return session;
}

/**
 * Start or retarget the shared Binance kline stream.
 * @returns stop — idempotent; a restart in the same turn keeps the socket.
 */
export function startBinanceKline(
  param: string,
  urls: string[],
  handlers: BinanceKlineHandlers,
): () => void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  const gen = ++generation;
  const stream = String(param || '').trim();
  const list = urls.filter((u) => typeof u === 'string' && u.trim());
  if (!live) live = open(stream, list.length ? list : binanceCombinedStreamUrls(), handlers);
  else retarget(stream, handlers);
  return () => {
    if (gen !== generation) return;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (gen !== generation) return;
      teardown();
    }, 0);
  };
}

/** @internal */
export function _resetBinanceKlineForTests(): void {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = null;
  generation += 1;
  teardown();
}
