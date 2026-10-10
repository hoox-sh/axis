/**
 * Copyright (c) 2026 HOOX · AXIS · jango_blockchained
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** D13 — cloud draft PUTs are serialized and coalesced (order-safe). */

import './setup';
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  saveDraft,
  _resetDraftSerializerForTests,
} from '../src/storage/service';
import {
  registerDynamicStorage,
  unregisterDynamicStorage,
} from '../src/storage/catalog';
import { setActivePlugin } from '../src/store';

const PLUGIN_ID = 'wsd-serial-cloud';

let writes: string[] = [];
let inFlight = 0;
let maxInFlight = 0;

function installSerialPlugin() {
  writes = [];
  inFlight = 0;
  maxInFlight = 0;
  registerDynamicStorage({
    id: PLUGIN_ID,
    name: 'WSD Serial Cloud',
    kind: 'storage',
    async list() {
      return [];
    },
    async read() {
      throw new Error('no');
    },
    async write() {
      throw new Error('no');
    },
    async remove() {},
    async saveDraft(d: { content: string; name?: string }) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so overlapping saves would interleave without serialization.
      await new Promise((r) => setTimeout(r, 5));
      writes.push(d.content);
      inFlight -= 1;
    },
  } as never);
  setActivePlugin('storage', PLUGIN_ID);
}

beforeEach(() => {
  _resetDraftSerializerForTests();
  installSerialPlugin();
});

afterEach(() => {
  setActivePlugin('storage', 'local');
  unregisterDynamicStorage(PLUGIN_ID);
  _resetDraftSerializerForTests();
});

describe('serialized saveDraft', () => {
  it('runs overlapping saves in order, never concurrently', async () => {
    await Promise.all([
      saveDraft('one'),
      saveDraft('two'),
      saveDraft('three'),
    ]);
    expect(maxInFlight).toBe(1);
    expect(writes[writes.length - 1]).toBe('three');
  });

  it('coalesces a burst to at most 2 remote writes', async () => {
    await Promise.all([
      saveDraft('a'),
      saveDraft('b'),
      saveDraft('c'),
      saveDraft('d'),
      saveDraft('e'),
    ]);
    expect(maxInFlight).toBe(1);
    expect(writes.length).toBeLessThanOrEqual(2);
    expect(writes[writes.length - 1]).toBe('e');
  });
});
