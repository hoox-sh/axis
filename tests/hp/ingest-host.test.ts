/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Redesign2WsClient } from '../../src/engine/ws-client';
import { resetHpFlags, setHpEnabled } from '../../src/hp/feature-flag';
import { decodeInbound, IngestCursorTable } from '../../src/hp/workers/ingest-core';
import {
  createLiveWsClient,
  IngestHostClient,
  setIngestWorkerFactory,
  type IngestWorkerTransport,
} from '../../src/hp/workers/host';
import type { HostToIngest, IngestToHost } from '../../src/hp/workers/protocol';

const SUB = 'series:binance|spot|BTC/USDT|1m';

/**
 * Loopback "worker": the host posts {@link HostToIngest}, this replies with the
 * same {@link IngestToHost} messages the real ingest worker emits. Decoding uses
 * the production {@link decodeInbound}, so JSON and AXB1 both travel the port.
 */
class FakeIngest {
  readonly sent: string[] = [];
  readonly table = new IngestCursorTable();
  /** When false, `connect` stays pending until the test posts a status. */
  autoOpen = true;
  transport: IngestWorkerTransport;
  terminated = false;

  constructor() {
    const self = this;
    this.transport = {
      postMessage(msg: HostToIngest) {
        if (msg.type === 'connect') {
          if (!self.autoOpen) return;
          self.emit({ type: 'status', status: 'open' });
          self.emit({ type: 'open', first: true });
          return;
        }
        if (msg.type === 'send') {
          // The real worker stringifies the frame verbatim.
          self.sent.push(JSON.stringify(msg.frame));
          self.table.rememberOutbound(msg.frame);
        }
      },
      terminate() {
        self.terminated = true;
      },
      onmessage: null,
      onerror: null,
    };
  }

  private emit(msg: IngestToHost): void {
    this.transport.onmessage?.({ data: msg } as MessageEvent<IngestToHost>);
  }

  /** Simulate an inbound socket payload (string or AXB1 bytes). */
  push(raw: unknown): void {
    const out = decodeInbound(raw, this.table);
    if (!out.ok) {
      this.emit({ type: 'malformed', reason: out.reason });
      return;
    }
    if (out.kind === 'pong') {
      this.emit({ type: 'pong' });
      return;
    }
    this.emit({ type: 'frames', frames: out.frames });
  }

  status(status: 'connecting' | 'open' | 'closed' | 'error'): void {
    this.emit({ type: 'status', status });
  }

  reopen(first: boolean): void {
    this.emit({ type: 'open', first });
  }
}

function fullJson(seq: number): string {
  return JSON.stringify({
    type: 'full',
    id: SUB,
    sessionId: 'ses-1',
    seq,
    payload: {
      seriesKey: SUB,
      count: 1,
      closed_upto: 0,
      bars: [{ time: 60, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
    },
  });
}

afterEach(() => {
  setIngestWorkerFactory(null);
  resetHpFlags();
});

describe('createLiveWsClient', () => {
  test('HP off keeps the main-thread Redesign2 client byte-for-byte', () => {
    const fake = new FakeIngest();
    setIngestWorkerFactory(() => fake.transport);
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(Redesign2WsClient);
    expect(client).not.toBeInstanceOf(IngestHostClient);
  });

  test('HP on with a Worker uses the ingest host', () => {
    setHpEnabled(true);
    const fake = new FakeIngest();
    setIngestWorkerFactory(() => fake.transport);
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(IngestHostClient);
    client.disconnect();
  });
});

describe('IngestHostClient over a fake ingest port', () => {
  function makeClient(): { client: IngestHostClient; fake: FakeIngest } {
    setHpEnabled(true);
    const fake = new FakeIngest();
    setIngestWorkerFactory(() => fake.transport);
    const client = new IngestHostClient({ endpoint: 'http://127.0.0.1:5002' });
    return { client, fake };
  }

  test('connect resolves when the worker reports open', async () => {
    const { client } = makeClient();
    await client.connect();
    expect(client.isOpen).toBe(true);
    client.disconnect();
  });

  test('JSON decoded off-thread reaches onFrame and awaitFrame', async () => {
    const { client, fake } = makeClient();
    await client.connect();
    const seen: string[] = [];
    client.onFrame = (frame) => seen.push(frame.type);

    const waited = client.awaitFrame(SUB, 1_000);
    fake.push(fullJson(1));

    expect(seen).toEqual(['full']);
    const frame = await waited;
    expect(frame.type).toBe('full');
    expect(frame.seq).toBe(1);
    expect((frame.payload as { count: number }).count).toBe(1);
    client.disconnect();
  });

  test('subscribe is serialized exactly like the JSON client would send it', async () => {
    const { client, fake } = makeClient();
    await client.connect();
    client.subscribe(SUB, 'series', {
      exchange: 'binance',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1m',
    });
    expect(fake.sent).toHaveLength(1);
    const sent = JSON.parse(fake.sent[0] ?? '{}') as Record<string, unknown>;
    expect(sent.type).toBe('subscribe');
    expect(sent.id).toBe(SUB);
    expect(sent.payload).toMatchObject({ kind: 'series', encoding: 'axb1' });
    client.disconnect();
  });

  test('a worker reopen fires reconnect handlers so callers can re-subscribe', async () => {
    const { client, fake } = makeClient();
    await client.connect();
    let fired = 0;
    client.addReconnectHandler(() => {
      fired += 1;
    });
    fake.reopen(false);
    expect(fired).toBe(1);
    client.disconnect();
    expect(fake.terminated).toBe(true);
  });

  test('a dead worker is replaced and callers resubscribe', async () => {
    setHpEnabled(true);
    const fakes: FakeIngest[] = [];
    setIngestWorkerFactory(() => {
      const fake = new FakeIngest();
      fakes.push(fake);
      return fake.transport;
    });
    const client = new IngestHostClient({ endpoint: 'http://127.0.0.1:5002' });
    await client.connect();
    let fired = 0;
    client.addReconnectHandler(() => {
      fired += 1;
    });
    const first = fakes[0];
    if (!first) throw new Error('missing worker');
    first.transport.onerror?.(new Event('error') as ErrorEvent);
    await Promise.resolve();
    expect(first.terminated).toBe(true);
    expect(fakes).toHaveLength(2);
    expect(client.isOpen).toBe(true);
    expect(fired).toBe(1);
    expect(client).toBeInstanceOf(IngestHostClient);
    client.disconnect();
  });

  test('worker crashes stop spawning after the cap', async () => {
    setHpEnabled(true);
    const fakes: FakeIngest[] = [];
    setIngestWorkerFactory(() => {
      const fake = new FakeIngest();
      fakes.push(fake);
      return fake.transport;
    });
    const client = new IngestHostClient({ endpoint: 'http://127.0.0.1:5002' });
    await client.connect();
    for (let i = 0; i < 8; i++) {
      const current = fakes[fakes.length - 1];
      if (!current) throw new Error('missing worker');
      current.transport.onerror?.(new Event('error') as ErrorEvent);
      await Promise.resolve();
    }
    expect(fakes).toHaveLength(6);
    expect(client.isOpen).toBe(false);
    client.disconnect();
  });

  test('worker status errors reject a pending connect and drop waiters', async () => {
    const { client, fake } = makeClient();
    fake.autoOpen = false;
    const connecting = client.connect();
    fake.status('error');
    await expect(connecting).rejects.toThrow('ingest error');
    expect(client.isOpen).toBe(false);
    client.disconnect();
  });
});
