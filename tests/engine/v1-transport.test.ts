/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Redesign2WsClient } from '../../src/engine/ws-client';
import { _resetV1Metrics, v1MetricsSnapshot } from '../../src/engine/v1/metrics';
import {
  engineTransport,
  resetEngineTransport,
  setEngineTransport,
} from '../../src/engine/v1/transport';
import {
  createLiveWsClient,
  IngestHostClient,
  setIngestWorkerAvailableForTests,
  setIngestWorkerFactory,
  type IngestWorkerTransport,
} from '../../src/hp/workers/host';
import { MockWebSocket } from '../helpers/mock-ws';

function fakeWorker(): IngestWorkerTransport {
  return {
    postMessage() {},
    terminate() {},
    onmessage: null,
    onerror: null,
  };
}

const nativeJsonParse = JSON.parse.bind(JSON);

afterEach(() => {
  JSON.parse = nativeJsonParse;
  setIngestWorkerFactory(null);
  setIngestWorkerAvailableForTests(null);
  resetEngineTransport();
  _resetV1Metrics();
});

describe('axis.engine.transport', () => {
  test('defaults to worker and round-trips json', () => {
    expect(engineTransport()).toBe('worker');
    setEngineTransport('json');
    expect(engineTransport()).toBe('json');
    setEngineTransport('worker');
    expect(engineTransport()).toBe('worker');
  });

  test('explicit json keeps the main-thread client', () => {
    setEngineTransport('json');
    setIngestWorkerFactory(() => fakeWorker());
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(Redesign2WsClient);
    expect(client).not.toBeInstanceOf(IngestHostClient);
  });

  test('worker flag uses the ingest host', () => {
    setEngineTransport('worker');
    setIngestWorkerFactory(() => fakeWorker());
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(IngestHostClient);
    client.disconnect();
  });

  test('a requested worker with no Worker falls back once', () => {
    setEngineTransport('worker');
    setIngestWorkerAvailableForTests(false);
    const first = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    const second = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(first).toBeInstanceOf(Redesign2WsClient);
    expect(second).toBeInstanceOf(Redesign2WsClient);
    expect(v1MetricsSnapshot().counts.jsonFallback).toBe(1);
  });

  test('json rollback JSON.parse-s inbound live text on the window', async () => {
    setEngineTransport('json');
    const restoreWs = MockWebSocket.install();
    const client = createLiveWsClient({
      endpoint: 'http://127.0.0.1:5002',
      heartbeatIntervalMs: 60_000,
      connectTimeoutMs: 1_000,
    });
    expect(client).toBeInstanceOf(Redesign2WsClient);
    expect(client).not.toBeInstanceOf(IngestHostClient);
    try {
      await client.connect();
      const payload = JSON.stringify({
        type: 'full',
        id: 'series:binance|spot|BTC/USDT|1m',
        sessionId: 'ses-1',
        seq: 1,
        payload: {
          seriesKey: 'series:binance|spot|BTC/USDT|1m',
          count: 1,
          closed_upto: 0,
          bars: [{ time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
        },
      });
      const seen: unknown[] = [];
      client.onFrame = (frame) => seen.push(frame);
      const calls: string[] = [];
      JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
        calls.push(text);
        return nativeJsonParse(text, reviver);
      }) as typeof JSON.parse;
      try {
        MockWebSocket.instances[0]?.push(payload);
      } finally {
        JSON.parse = nativeJsonParse;
      }
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ type: 'full', seq: 1 });
      expect(calls).toContain(payload);
    } finally {
      client.disconnect();
      restoreWs();
    }
  });

  test('worker path delivers decoded frames without JSON.parse on the window', async () => {
    setEngineTransport('worker');
    let port: IngestWorkerTransport | null = null;
    setIngestWorkerFactory(() => {
      const transport: IngestWorkerTransport = {
        postMessage(msg) {
          if (msg.type === 'connect') {
            queueMicrotask(() => {
              transport.onmessage?.({
                data: { type: 'status', status: 'open' },
              } as MessageEvent);
              transport.onmessage?.({
                data: { type: 'open', first: true },
              } as MessageEvent);
            });
          }
        },
        terminate() {},
        onmessage: null,
        onerror: null,
      };
      port = transport;
      return transport;
    });
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(IngestHostClient);
    try {
      await client.connect();
      const seen: unknown[] = [];
      client.onFrame = (frame) => seen.push(frame);
      const calls: string[] = [];
      JSON.parse = ((
        text: string,
        reviver?: (this: unknown, key: string, value: unknown) => unknown,
      ) => {
        calls.push(text);
        return nativeJsonParse(text, reviver);
      }) as typeof JSON.parse;
      try {
        port?.onmessage?.({
          data: {
            type: 'frames',
            frames: [{ type: 'full', id: 'series:x', seq: 1, payload: { count: 1 } }],
          },
        } as MessageEvent);
      } finally {
        JSON.parse = nativeJsonParse;
      }
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ type: 'full', seq: 1 });
      expect(calls).toEqual([]);
    } finally {
      client.disconnect();
    }
  });
});
