// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  remoteSink,
  _resetDatasetSinksForTests,
} from '../src/data/dataset-sinks';
import { _resetBarsCacheForTests } from '../src/data/bars-cache';
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
});
