/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Always-on scale invariants for live `appendBar` (path update + history cap).
 * Full 500k-tick firehose belongs under AXIS_BENCH=1 (see tests/bench when added).
 */

import './setup';
import { describe, expect, it, beforeEach } from 'bun:test';
import {
  HISTORY_BARS_MAX,
  appendBar,
  loadBars,
  store,
  setStore,
} from '../src/store';
import type { Bar } from '../src/store/types';

function makeBars(n: number, start = 1_700_000_000, step = 60): Bar[] {
  const out = new Array<Bar>(n);
  let px = 100;
  for (let i = 0; i < n; i++) {
    const open = px;
    const close = open + ((i & 1) === 0 ? 0.25 : -0.15);
    out[i] = {
      time: start + i * step,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1000 + (i % 50),
    };
    px = close;
  }
  return out;
}

beforeEach(() => {
  setStore('live', {
    active: true,
    needsRerun: false,
    lastBarTime: 0,
    streamId: 'mock',
    preferAfterLoad: false,
    rerunOn: 'every-tick',
  });
});

describe('appendBar scale invariants', () => {
  it('updates same-time tip in place without growing length', () => {
    const n = 1_000;
    loadBars(makeBars(n), 'BTCUSDT', '1m', 'bench');
    const lenBefore = store.bars.length;
    const last = store.bars[lenBefore - 1]!;
    // Plain object (not a store proxy spread) so path-update is unambiguous
    appendBar({
      time: last.time,
      open: last.open,
      high: last.high + 1,
      low: last.low,
      close: 999.25,
      volume: last.volume,
    });
    expect(store.bars.length).toBe(lenBefore);
    expect(store.bars[lenBefore - 1]!.close).toBe(999.25);
  });

  it('appends new time and respects HISTORY_BARS_MAX', () => {
    const n = 500;
    loadBars(makeBars(n), 'BTCUSDT', '1m', 'bench');
    const last = store.bars[store.bars.length - 1]!;
    appendBar({
      time: last.time + 60,
      open: last.close,
      high: last.close + 1,
      low: last.close - 1,
      close: last.close,
      volume: 1,
    });
    expect(store.bars.length).toBe(Math.min(n + 1, HISTORY_BARS_MAX));
  });
});
