/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'bun:test';
import { Redesign2WsClient } from '../../src/engine/ws-client';

const META = { exchange: 'binance', market: 'spot', symbol: 'BTC/USDT', interval: '1m' };

function openClient() {
  const client = new Redesign2WsClient({ endpoint: 'https://example.test' });
  const sent: string[] = [];
  (client as unknown as { ws: unknown }).ws = {
    readyState: 1,
    send: (s: string) => {
      sent.push(s);
    },
    close: () => {},
  };
  return { client, sent };
}

describe('redesign2 typed send + routing (F-05)', () => {
  test('subscribe/resume/repair/unsubscribe emit contract frames', () => {
    const { client, sent } = openClient();
    client.subscribe('sub-1', 'script', META, { script: 'indicator("x")' });
    client.resumeSubscription('sub-1', 100, 123);
    client.requestRepair('sub-1', 120);
    client.unsubscribe('sub-1');
    const types = sent.map((s) => (JSON.parse(s) as { type: string }).type);
    expect(types).toEqual(['subscribe', 'resume', 'repair', 'unsubscribe']);
    const sub = JSON.parse(sent[0]!) as { id: string; payload: { kind: string } };
    expect(sub.id).toBe('sub-1');
    expect(sub.payload.kind).toBe('script');
  });

  test('awaitFrame resolves on a matching validated id frame', async () => {
    const { client } = openClient();
    const waited = client.awaitFrame('sub-9', 1000);
    (client as unknown as { handleMessage: (r: string) => void }).handleMessage(
      JSON.stringify({ type: 'status', id: 'sub-9', payload: { code: 'live' } }),
    );
    const frame = await waited;
    expect(frame.type).toBe('status');
  });

  test('malformed frames are skipped and reported, never dispatched', () => {
    const { client } = openClient();
    const seen: unknown[] = [];
    const bad: unknown[] = [];
    client.onFrame = (f) => seen.push(f);
    client.onMalformed = (r) => bad.push(r);
    (client as unknown as { handleMessage: (r: string) => void }).handleMessage(
      JSON.stringify({ type: 'delta', sessionId: 's', payload: {} }),
    );
    expect(bad.length).toBe(1);
    expect(seen.length).toBe(0);
  });

  test('awaitFrame rejects on timeout', async () => {
    const { client } = openClient();
    await expect(client.awaitFrame('never', 20)).rejects.toThrow('timed out');
  });

  test('reconnect handlers register and unregister', () => {
    const { client } = openClient();
    const off = client.addReconnectHandler(() => {});
    expect((client as unknown as { reconnects: { size: number } }).reconnects.size).toBe(1);
    off();
    expect((client as unknown as { reconnects: { size: number } }).reconnects.size).toBe(0);
  });
});
