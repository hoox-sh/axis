// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  remoteSink,
  onSinkError,
  _resetDatasetSinksForTests,
} from '../src/data/dataset-sinks';
import { _resetBarsCacheForTests } from '../src/data/bars-cache';
import { registerDynamicStorage, unregisterDynamicStorage } from '../src/storage/catalog';
import type { Bar } from '../src/store/types';

function bar(t: number, close: number): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

beforeEach(async () => {
  _resetDatasetSinksForTests();
  await _resetBarsCacheForTests();
});

describe('dataset-sinks · remote', () => {
  it('get returns pending bars before the remote flush lands', async () => {
    const sink = remoteSink('git');
    const key = 'binance-rest|BTCUSDT|1d';
    await sink.put(key, [bar(60, 1)]);
    await sink.put(key, [bar(120, 2)]);
    const got = await sink.get(key);
    expect(got?.map((b) => b.time)).toEqual([60, 120]);
  });

  it('removing a document that is already gone is not a failure', async () => {
    const errors: Array<{ mode: string; key: string }> = [];
    onSinkError((mode, key) => errors.push({ mode, key }));
    registerDynamicStorage({
      id: 'cloud',
      name: 'fake cloud',
      kind: 'storage',
      async list() {
        return [];
      },
      async read() {
        return null;
      },
      async write() {
        return { id: 'x' };
      },
      async remove() {
        const err = new Error('script datasets/x not found') as Error & { status?: number };
        err.status = 404;
        throw err;
      },
      async status() {
        return { ok: true };
      },
    } as never);
    try {
      const sink = remoteSink('worker');
      await sink.remove('binance-rest|BTCUSDT|1m');
      expect(errors).toEqual([]);
    } finally {
      onSinkError(null);
      unregisterDynamicStorage('cloud');
    }
  });
});
