/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * HP-2 transport gate: `IngestHostClient.connect` rides the hot SAB only
 * when the tab is cross-origin isolated and the `sab` flag allows it —
 * every other combination keeps the transferable-copy frame path with no
 * shared memory at all.
 */

import '../setup';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  createLiveWsClient,
  IngestHostClient,
  setIngestWorkerFactory,
  type IngestWorkerTransport,
} from '../../src/hp/workers/host';
import { resetHpFlags, setHpEnabled, setHpSabMode } from '../../src/hp/feature-flag';
import type { HostToIngest, IngestToHost } from '../../src/hp/workers/protocol';

/** Loopback worker that records every host message and auto-opens. */
class SabLoopback {
  readonly inbound: HostToIngest[] = [];
  readonly transport: IngestWorkerTransport;

  constructor() {
    const self = this;
    this.transport = {
      postMessage(msg: HostToIngest) {
        self.inbound.push(msg);
        if (msg.type === 'connect') {
          self.emit({ type: 'status', status: 'open' });
          self.emit({ type: 'open', first: true });
        }
      },
      terminate() {},
      onmessage: null,
      onerror: null,
    };
  }

  private emit(msg: IngestToHost): void {
    this.transport.onmessage?.({ data: msg } as MessageEvent<IngestToHost>);
  }

  hot(active: boolean): void {
    this.emit({ type: 'hot', active });
  }

  connectMessage(): HostToIngest | undefined {
    return this.inbound.find((m) => m.type === 'connect');
  }
}

function isolatedClient(loop: SabLoopback): IngestHostClient {
  setHpEnabled(true);
  setIngestWorkerFactory(() => loop.transport);
  const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:8787' });
  if (!(client instanceof IngestHostClient)) throw new Error('expected IngestHostClient');
  return client;
}

const hadIsolation = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');

function setIsolated(on: boolean): void {
  Object.defineProperty(globalThis, 'crossOriginIsolated', {
    value: on,
    configurable: true,
  });
}

afterEach(() => {
  setIngestWorkerFactory(null);
  resetHpFlags();
  if (hadIsolation) Object.defineProperty(globalThis, 'crossOriginIsolated', hadIsolation);
  else delete (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
});

describe('IngestHostClient hot ring gate', () => {
  test('isolated tab: connect rides the SAB and the worker can confirm it', async () => {
    setIsolated(true);
    const loop = new SabLoopback();
    const client = isolatedClient(loop);
    // `buildWire` reads `hotBuffer` synchronously right after construction
    // (rAF sampler + GPU overlay) — the ring must exist before `connect()`.
    expect(client.hotBuffer).not.toBeNull();
    await client.connect();
    const msg = loop.connectMessage();
    expect(msg && 'hotSab' in msg ? msg.hotSab : null).toBeInstanceOf(SharedArrayBuffer);
    expect(client.hotBuffer).not.toBeNull();
    expect(client.hotRingActive).toBe(false); // until the worker confirms
    loop.hot(true);
    expect(client.hotRingActive).toBe(true);
    client.disconnect();
  });

  test('worker denial degrades to the frame path', async () => {
    setIsolated(true);
    const loop = new SabLoopback();
    const client = isolatedClient(loop);
    await client.connect();
    expect(client.hotBuffer).not.toBeNull();
    loop.hot(false);
    expect(client.hotBuffer).toBeNull();
    expect(client.hotRingActive).toBe(false);
    client.disconnect();
  });

  test('non-isolated tab: no SAB crosses the port', async () => {
    setIsolated(false);
    const loop = new SabLoopback();
    const client = isolatedClient(loop);
    await client.connect();
    const msg = loop.connectMessage();
    expect(msg && 'hotSab' in msg ? msg.hotSab : undefined).toBeUndefined();
    expect(client.hotBuffer).toBeNull();
    client.disconnect();
  });

  test('sab flag off: the probe is never consulted', async () => {
    setIsolated(true);
    setHpSabMode('off');
    const loop = new SabLoopback();
    const client = isolatedClient(loop);
    await client.connect();
    const msg = loop.connectMessage();
    expect(msg && 'hotSab' in msg ? msg.hotSab : undefined).toBeUndefined();
    expect(client.hotBuffer).toBeNull();
    client.disconnect();
  });
});
