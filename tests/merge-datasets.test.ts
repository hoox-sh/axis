// Copyright (C) 2024-2026 jango_blockchained
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'bun:test';
import {
  barsConflict,
  mergeWithConflictPolicy,
} from '../src/data/merge-datasets';
import type { Bar } from '../src/store/types';

function bar(t: number, close: number, volume = 1): Bar {
  return { time: t, open: close, high: close + 1, low: close - 1, close, volume };
}

describe('merge-datasets · barsConflict', () => {
  it('same OHLCV is not a conflict', () => {
    expect(barsConflict(bar(60, 100), bar(60, 100))).toBe(false);
  });

  it('tiny float noise is not a conflict (relative tolerance)', () => {
    expect(barsConflict(bar(60, 100), bar(60, 100.0000001))).toBe(false);
  });

  it('different close is a conflict', () => {
    expect(barsConflict(bar(60, 100), bar(60, 105))).toBe(true);
  });

  it('different volume is a conflict', () => {
    expect(barsConflict(bar(60, 100), bar(60, 100, 2))).toBe(true);
  });
});

describe('merge-datasets · mergeWithConflictPolicy', () => {
  const current = [bar(60, 100), bar(120, 200)];
  const incoming = [bar(120, 250), bar(180, 300)];

  it('unions non-overlapping bars and counts additions', () => {
    const res = mergeWithConflictPolicy(current, [bar(180, 300)]);
    expect(res.bars.map((b) => b.time)).toEqual([60, 120, 180]);
    expect(res.added).toBe(1);
    expect(res.conflicts).toHaveLength(0);
  });

  it('newest-wins (default) resolves conflicts toward incoming', () => {
    const res = mergeWithConflictPolicy(current, incoming);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]!.time).toBe(120);
    const merged = res.bars.find((b) => b.time === 120)!;
    expect(merged.close).toBe(250);
  });

  it('keep-current resolves conflicts toward existing', () => {
    const res = mergeWithConflictPolicy(current, incoming, { policy: 'keep-current' });
    expect(res.conflicts).toHaveLength(1);
    expect(res.bars.find((b) => b.time === 120)!.close).toBe(200);
  });

  it('prefer-incoming behaves like newest-wins', () => {
    const res = mergeWithConflictPolicy(current, incoming, { policy: 'prefer-incoming' });
    expect(res.bars.find((b) => b.time === 120)!.close).toBe(250);
  });

  it('agreement on overlap is not a conflict', () => {
    const res = mergeWithConflictPolicy(current, [bar(120, 200)]);
    expect(res.conflicts).toHaveLength(0);
    expect(res.added).toBe(0);
  });

  it('output is sorted and deduped even from unsorted inputs', () => {
    const res = mergeWithConflictPolicy(
      [bar(180, 3), bar(60, 1)],
      [bar(60, 1), bar(120, 2)],
    );
    expect(res.bars.map((b) => b.time)).toEqual([60, 120, 180]);
  });

  it('tolerance can be loosened to ignore small venue drift', () => {
    const res = mergeWithConflictPolicy([bar(60, 100)], [bar(60, 100.5)], {
      tolerance: 0.01,
    });
    expect(res.conflicts).toHaveLength(0);
  });
});
