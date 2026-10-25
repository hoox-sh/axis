/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Redesign2WsClient } from '../../src/engine/ws-client';
import { StreamLiveWire, type WireClient, type WireHandlers } from '../../src/engine/live-wire';
import { decodeInbound, IngestCursorTable } from '../../src/hp/workers/ingest-core';
import { resetEngineTransport, setEngineTransport } from '../../src/engine/v1/transport';
import { _resetV1Metrics, v1MetricsSnapshot } from '../../src/engine/v1/metrics';
import {
  createLiveWsClient,
  IngestHostClient,
  setIngestWorkerFactory,
  type IngestWorkerTransport,
} from '../../src/hp/workers/host';
import type { HostToIngest, IngestToHost } from '../../src/hp/workers/protocol';
import type { Redesign2Frame } from '../../src/engine/frames';
import type { Bar } from '../../src/store/types';

const SUB = 'series:binance|spot|BTC/USDT|1m';
const SCRIPT = 'script:ema';
const SCRIPT_BARS: Bar[] = [{ time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Loopback "worker": the host posts {@link HostToIngest}, this replies with the
 * same {@link IngestToHost} messages the real ingest worker emits. Decode
 * (including `JSON.parse`) runs here, not on {@link IngestHostClient}. The
 * host port only sees objects — G1.
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

  /** Post an already-decoded worker message onto the host port. */
  private emit(msg: IngestToHost): void {
    this.transport.onmessage?.({ data: msg } as MessageEvent<IngestToHost>);
  }

  /**
   * Simulate an inbound socket payload (JSON text or AXB1 bytes).
   * {@link decodeInbound} is the fake worker; the host never sees the string.
   */
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

  unknownOpcode(id: string, opcode: number, seq: number): void {
    this.emit({ type: 'unknown-opcode', opcode, id, seq });
  }

  reopen(first: boolean): void {
    this.emit({ type: 'open', first });
  }

  /** Already-decoded batch, as the real worker posts `type: 'frames'`. */
  postFrames(frames: Redesign2Frame[]): void {
    this.emit({ type: 'frames', frames });
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

function scriptFullJson(seq: number): string {
  return JSON.stringify({
    type: 'full',
    id: SCRIPT,
    sessionId: 'ses-1',
    seq,
    payload: {
      seriesKey: SUB,
      count: 1,
      closed_upto: 0,
      plots: [[1]],
      series: { a: [1] },
    },
  });
}

type Outbound = { type: string; id?: string; payload?: Record<string, unknown> };

function outbound(fake: FakeIngest): Outbound[] {
  return fake.sent.map((s) => JSON.parse(s) as Outbound);
}

const nativeJsonParse = JSON.parse.bind(JSON);

/**
 * Spy `JSON.parse` only while the fake worker posts to the host. Decode of
 * the socket payload already ran in {@link FakeIngest.push}.
 */
function spyParseOnHost(transport: IngestWorkerTransport): { calls: string[]; restore: () => void } {
  const origOnmessage = transport.onmessage;
  const calls: string[] = [];
  transport.onmessage = (ev) => {
    JSON.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      calls.push(text);
      return nativeJsonParse(text, reviver);
    }) as typeof JSON.parse;
    try {
      origOnmessage?.call(transport, ev);
    } finally {
      JSON.parse = nativeJsonParse;
    }
  };
  return {
    calls,
    restore() {
      transport.onmessage = origOnmessage;
      JSON.parse = nativeJsonParse;
    },
  };
}

afterEach(() => {
  JSON.parse = nativeJsonParse;
  setIngestWorkerFactory(null);
  resetEngineTransport();
});

describe('createLiveWsClient', () => {
  test('explicit json keeps the main-thread client', () => {
    setEngineTransport('json');
    const fake = new FakeIngest();
    setIngestWorkerFactory(() => fake.transport);
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(Redesign2WsClient);
    expect(client).not.toBeInstanceOf(IngestHostClient);
  });

  test('the worker transport uses the ingest host', () => {
    setEngineTransport('worker');
    const fake = new FakeIngest();
    setIngestWorkerFactory(() => fake.transport);
    const client = createLiveWsClient({ endpoint: 'http://127.0.0.1:5002' });
    expect(client).toBeInstanceOf(IngestHostClient);
    client.disconnect();
  });
});

describe('IngestHostClient over a fake ingest port', () => {
  function makeClient(): { client: IngestHostClient; fake: FakeIngest } {
    setEngineTransport('worker');
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

  test('a worker batch reaches onFrames as one array', async () => {
    const { client, fake } = makeClient();
    await client.connect();
    const batches: number[] = [];
    const types: string[] = [];
    client.onFrames = (frames) => {
      batches.push(frames.length);
      for (const frame of frames) types.push(frame.type);
    };
    fake.postFrames([
      {
        type: 'delta',
        id: SUB,
        seq: 1,
        payload: { bars: SCRIPT_BARS, forming: true },
      },
      {
        type: 'delta',
        id: SCRIPT,
        seq: 1,
        payload: { base_index: 0, count: 1, tail_len: 1, series: { a: [1] } },
      },
    ]);
    expect(batches).toEqual([2]);
    expect(types).toEqual(['delta', 'delta']);
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

  test('G1: a JSON string from the socket is an object on onFrame with no host parse', async () => {
    const { client, fake } = makeClient();
    await client.connect();
    const payload = fullJson(1);
    const seen: unknown[] = [];
    client.onFrame = (frame) => seen.push(frame);
    const spy = spyParseOnHost(fake.transport);
    try {
      fake.push(payload);
    } finally {
      spy.restore();
    }
    expect(seen).toHaveLength(1);
    const frame = seen[0];
    expect(frame).toBeDefined();
    expect(typeof frame).toBe('object');
    expect(frame).not.toBeNull();
    expect(typeof frame === 'string').toBe(false);
    expect(frame).toMatchObject({ type: 'full', id: SUB, seq: 1 });
    expect(spy.calls.filter((text) => text === payload)).toEqual([]);
    client.disconnect();
  });

  test('G1: a raw JSON string on the worker port is not parsed on the host', async () => {
    const { client, fake } = makeClient();
    await client.connect();
    const payload = fullJson(1);
    const seen: unknown[] = [];
    client.onFrame = (frame) => seen.push(frame);
    const spy = spyParseOnHost(fake.transport);
    try {
      fake.transport.onmessage?.({ data: payload } as unknown as MessageEvent<IngestToHost>);
    } finally {
      spy.restore();
    }
    expect(seen).toEqual([]);
    expect(spy.calls).toEqual([]);
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
    setEngineTransport('worker');
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

  test('a worker crash resumes series and script with axb1 on the replacement worker', async () => {
    _resetV1Metrics();
    setEngineTransport('worker');
    const fakes: FakeIngest[] = [];
    setIngestWorkerFactory(() => {
      const fake = new FakeIngest();
      fakes.push(fake);
      return fake.transport;
    });
    const client = new IngestHostClient({ endpoint: 'http://127.0.0.1:5002' });
    const handlers: WireHandlers = {
      onStatus: () => {},
      onSeriesFull: () => {},
      onSeriesDelta: () => {},
      onCloseVerified: () => {},
    };
    const wire = new StreamLiveWire(
      client as unknown as WireClient,
      handlers,
      (async () => ({
        status: 'success',
        plots: [],
        series: {},
        events: [],
        meta: {},
      })) as never,
    );
    try {
      const series = wire.ensureSeries(SUB, {
        exchange: 'binance',
        market: 'spot',
        symbol: 'BTC/USDT',
        interval: '1m',
      });
      await tick();
      await tick();
      const first = fakes[0];
      if (!first) throw new Error('missing worker');
      expect(outbound(first).some((f) => f.type === 'subscribe' && f.id === SUB)).toBe(true);
      expect(outbound(first).find((f) => f.id === SUB)?.payload).toMatchObject({
        kind: 'series',
        encoding: 'axb1',
      });
      first.push(fullJson(4));
      await series;

      const script = wire.evalScript({
        subId: SCRIPT,
        script: 'indicator() {}',
        meta: {},
        bars: SCRIPT_BARS,
      });
      await tick();
      await tick();
      expect(outbound(first).find((f) => f.id === SCRIPT)?.payload).toMatchObject({
        kind: 'script',
        encoding: 'axb1',
      });
      first.push(scriptFullJson(7));
      await script;

      expect(wire.snapshotState().subs.map((s) => ({ subId: s.subId, seq: s.seq }))).toEqual([
        { subId: SCRIPT, seq: 7 },
        { subId: SUB, seq: 4 },
      ]);

      first.transport.onerror?.(new Event('error') as ErrorEvent);
      await Promise.resolve();

      expect(first.terminated).toBe(true);
      expect(fakes).toHaveLength(2);
      expect(client.isOpen).toBe(true);
      expect(client).toBeInstanceOf(IngestHostClient);
      expect(v1MetricsSnapshot().counts.jsonFallback ?? 0).toBe(0);

      const next = fakes[1];
      if (!next) throw new Error('missing replacement worker');
      const resumes = outbound(next).filter((f) => f.type === 'resume');
      expect(resumes.map((f) => f.id).sort()).toEqual([SCRIPT, SUB].sort());
      expect(resumes.find((f) => f.id === SUB)?.payload).toEqual({
        count: 1,
        last_time: 60,
        seq: 4,
        encoding: 'axb1',
      });
      expect(resumes.find((f) => f.id === SCRIPT)?.payload).toEqual({
        count: 1,
        last_time: 100,
        seq: 7,
        encoding: 'axb1',
      });

      const nextPayload = fullJson(5);
      const after: unknown[] = [];
      client.onFrames = (frames) => {
        for (const frame of frames) after.push(frame);
      };
      const spy = spyParseOnHost(next.transport);
      try {
        next.push(nextPayload);
      } finally {
        spy.restore();
      }
      expect(after).toHaveLength(1);
      expect(typeof after[0]).toBe('object');
      expect(after[0]).toMatchObject({ type: 'full', seq: 5 });
      expect(spy.calls.filter((text) => text === nextPayload)).toEqual([]);
      expect(v1MetricsSnapshot().counts.jsonFallback ?? 0).toBe(0);
    } finally {
      wire.reset();
      _resetV1Metrics();
    }
  });

  test('a live wire still stops spawning after the crash cap', async () => {
    setEngineTransport('worker');
    const fakes: FakeIngest[] = [];
    setIngestWorkerFactory(() => {
      const fake = new FakeIngest();
      fakes.push(fake);
      return fake.transport;
    });
    const client = new IngestHostClient({ endpoint: 'http://127.0.0.1:5002' });
    const wire = new StreamLiveWire(
      client as unknown as WireClient,
      {
        onStatus: () => {},
        onSeriesFull: () => {},
        onSeriesDelta: () => {},
        onCloseVerified: () => {},
      },
      (async () => ({
        status: 'success',
        plots: [],
        series: {},
        events: [],
        meta: {},
      })) as never,
    );
    try {
      const series = wire.ensureSeries(SUB, {
        exchange: 'binance',
        market: 'spot',
        symbol: 'BTC/USDT',
        interval: '1m',
      });
      await tick();
      await tick();
      fakes[0]?.push(fullJson(1));
      await series;
      for (let i = 0; i < 8; i++) {
        const current = fakes[fakes.length - 1];
        if (!current) throw new Error('missing worker');
        current.transport.onerror?.(new Event('error') as ErrorEvent);
        await Promise.resolve();
      }
      expect(fakes).toHaveLength(6);
      expect(client.isOpen).toBe(false);
      expect(client).toBeInstanceOf(IngestHostClient);
    } finally {
      wire.reset();
    }
  });

  test('worker crashes stop spawning after the cap', async () => {
    setEngineTransport('worker');
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

  test('an unknown opcode is counted and does not close the socket', async () => {
    _resetV1Metrics();
    const { client, fake } = makeClient();
    await client.connect();
    const seen: Array<{ id: string; opcode: number; seq: number }> = [];
    client.onUnknownOpcode = (info) => seen.push(info);
    fake.unknownOpcode('s-1', 127, 3);
    expect(seen).toEqual([{ id: 's-1', opcode: 127, seq: 3 }]);
    expect(client.isOpen).toBe(true);
    expect(fake.terminated).toBe(false);
    expect(v1MetricsSnapshot().counts.unknownOpcode).toBe(1);
    client.disconnect();
    _resetV1Metrics();
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
