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
import { resetHpFlags, setHpEnabled } from '../../src/hp/feature-flag';
import {
  createLiveWsClient,
  IngestHostClient,
  setIngestWorkerAvailableForTests,
  setIngestWorkerFactory,
  type IngestWorkerTransport,
} from '../../src/hp/workers/host';
function fakeWorker(): IngestWorkerTransport {
  return {
    postMessage() {},
    terminate() {},
    onmessage: null,
    onerror: null,
  };
}

afterEach(() => {
  setIngestWorkerFactory(null);
  setIngestWorkerAvailableForTests(null);
  resetHpFlags();
  resetEngineTransport();
  _resetV1Metrics();
});

describe('axis.engine.transport', () => {
  test('defaults to json and round-trips worker', () => {
    expect(engineTransport()).toBe('json');
    setEngineTransport('worker');
    expect(engineTransport()).toBe('worker');
    setEngineTransport('json');
    expect(engineTransport()).toBe('json');
  });

  test('HP off and the flag off keep the main-thread client', () => {
    setIngestWorkerFactory(() => fakeWorker());
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(Redesign2WsClient);
    expect(client).not.toBeInstanceOf(IngestHostClient);
  });

  test('worker flag uses the ingest host and does not allocate the hot ring', () => {
    setEngineTransport('worker');
    setIngestWorkerFactory(() => fakeWorker());
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(IngestHostClient);
    if (client instanceof IngestHostClient) expect(client.hotBuffer).toBeNull();
    client.disconnect();
  });

  test('HP on still uses the ingest host when the transport flag is json', () => {
    setHpEnabled(true);
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
});
