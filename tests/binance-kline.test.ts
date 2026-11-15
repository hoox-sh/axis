/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetBinanceKlineForTests,
  startBinanceKline,
} from '../src/streams/binance-kline';

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  readyState = 0;
  url: string;
  sent: string[] = [];
  closeCount = 0;

  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closeCount += 1;
    this.readyState = 3;
    const fn = this.onclose;
    this.onclose = null;
    fn?.({});
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

const URLS = ['wss://data-stream.binance.vision/stream'];

describe('binance kline socket', () => {
  const prev = globalThis.WebSocket;

  beforeEach(() => {
    FakeWS.instances = [];
    _resetBinanceKlineForTests();
    (globalThis as unknown as { WebSocket: typeof FakeWS }).WebSocket = FakeWS as never;
  });

  afterEach(() => {
    _resetBinanceKlineForTests();
    globalThis.WebSocket = prev;
  });

  it('retargets a symbol change without closing the socket', async () => {
    const bars: string[] = [];
    const stopA = startBinanceKline('btcusdt@kline_15m', URLS, {
      onBar: () => {},
      onStatus: () => {},
      onError: () => {},
    });
    expect(FakeWS.instances.length).toBe(1);
    FakeWS.instances[0]!.open();
    const sub = JSON.parse(FakeWS.instances[0]!.sent[0]!) as { method: string; params: string[] };
    expect(sub.method).toBe('SUBSCRIBE');
    expect(sub.params).toEqual(['btcusdt@kline_15m']);

    stopA();
    const stopB = startBinanceKline('ethusdt@kline_15m', URLS, {
      onBar: (b) => bars.push(String(b.close)),
      onStatus: () => {},
      onError: () => {},
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeWS.instances[0]!.closeCount).toBe(0);
    expect(FakeWS.instances.length).toBe(1);
    const methods = FakeWS.instances[0]!.sent.map(
      (s) => (JSON.parse(s) as { method: string }).method,
    );
    expect(methods).toContain('UNSUBSCRIBE');
    expect(methods.filter((m) => m === 'SUBSCRIBE').length).toBe(2);

    FakeWS.instances[0]!.onmessage?.({
      data: JSON.stringify({
        stream: 'ethusdt@kline_15m',
        data: { k: { t: 1_700_000_000_000, o: '1', h: '2', l: '1', c: '2', v: '3', x: true } },
      }),
    });
    expect(bars).toEqual(['2']);

    stopB();
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeWS.instances[0]!.closeCount).toBe(1);
  });
});
