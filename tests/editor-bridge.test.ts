/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Editor bridge: cross-window frames with a non-string `doc` are dropped
 * before handlers run.
 */

import './setup';
import { describe, expect, it, afterAll } from 'bun:test';
import type { BridgeMessage } from '../src/editor/editor-bridge';
import { bridgeSubscribe } from '../src/editor/editor-bridge';

class FakeBroadcastChannel {
  static last: FakeBroadcastChannel | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    FakeBroadcastChannel.last = this;
  }
  postMessage(_data: unknown) {}
  close() {}
}

const g = globalThis as unknown as { BroadcastChannel?: unknown };
const prevBroadcastChannel = g.BroadcastChannel;
g.BroadcastChannel = FakeBroadcastChannel;

afterAll(() => {
  if (prevBroadcastChannel === undefined) delete g.BroadcastChannel;
  else g.BroadcastChannel = prevBroadcastChannel;
});

describe('editor bridge validation', () => {
  it('drops doc/run frames with non-string doc, delivers the rest', () => {
    const seen: BridgeMessage[] = [];
    const unsub = bridgeSubscribe((m) => {
      seen.push(m);
    });
    try {
      const ch = FakeBroadcastChannel.last;
      expect(ch).not.toBeNull();
      if (!ch) throw new Error('bridge channel not created');
      ch.onmessage?.({ data: { type: 'doc', doc: 123 } as unknown as BridgeMessage });
      ch.onmessage?.({ data: { type: 'run', doc: null } as unknown as BridgeMessage });
      ch.onmessage?.({ data: { type: 'ping' } });
      ch.onmessage?.({ data: { type: 'doc', doc: 'hello' } });
      expect(seen).toEqual([{ type: 'ping' }, { type: 'doc', doc: 'hello' }]);
    } finally {
      unsub();
    }
  });
});
