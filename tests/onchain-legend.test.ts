/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain chart legend rows — visibility, last value, and source order.
 */

import { describe, expect, it } from 'bun:test';
import { onchainLegendEntries } from '../src/onchain/legend';

describe('onchainLegendEntries', () => {
  it('skips hidden and blank ids', () => {
    const series = [
      { id: 'shown', label: '  Shown  ', color: '  #abc  ', visible: true, lastTvl: 10 },
      { id: 'hidden', label: 'Hidden', visible: false, lastTvl: 20 },
      { id: '   ', label: 'Blank', lastTvl: 30 },
      { id: '', label: 'Empty', lastTvl: 40 },
      { label: 'Missing', lastTvl: 50 },
      null,
      'nope',
      { id: 'bare' },
    ] as unknown as Parameters<typeof onchainLegendEntries>[0];

    expect(onchainLegendEntries(null)).toEqual([]);
    expect(onchainLegendEntries(undefined)).toEqual([]);
    expect(onchainLegendEntries([])).toEqual([]);
    expect(onchainLegendEntries(series)).toEqual([
      { id: 'shown', label: 'Shown', color: '#abc', value: 10 },
      { id: 'bare', label: 'bare', color: '', value: null },
    ]);
  });

  it('prefers the last finite point over lastTvl; falls back to lastTvl; null when neither is finite', () => {
    const rows = onchainLegendEntries([
      {
        id: 'points',
        points: [
          { value: 1 },
          { value: Number.NaN },
          { value: 7 },
          { value: Number.POSITIVE_INFINITY },
        ],
        lastTvl: 99,
      },
      {
        id: 'tvl',
        points: [{ value: Number.NaN }],
        lastTvl: 42,
      },
      {
        id: 'zero',
        points: [{ value: 0 }],
        lastTvl: 5,
      },
      {
        id: 'none',
        points: [{ value: Number.NaN }],
        lastTvl: Number.POSITIVE_INFINITY,
      },
      {
        id: 'empty',
        points: null,
        lastTvl: null,
      },
    ]);

    expect(rows.map((row) => [row.id, row.value])).toEqual([
      ['points', 7],
      ['tvl', 42],
      ['zero', 0],
      ['none', null],
      ['empty', null],
    ]);
  });

  it('keeps order', () => {
    const rows = onchainLegendEntries([
      { id: 'c', lastTvl: 1 },
      { id: 'a', visible: false, lastTvl: 2 },
      { id: 'b', lastTvl: 3 },
      { id: 'd', lastTvl: 4 },
      { id: 'e', lastTvl: 5 },
      { id: 'f', lastTvl: 6 },
      { id: 'g', lastTvl: 7 },
      { id: 'h', lastTvl: 8 },
    ]);

    expect(rows.map((row) => row.id)).toEqual(['c', 'b', 'd', 'e', 'f', 'g', 'h']);
  });
});
