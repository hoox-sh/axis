/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure adapters: on-chain datasets ↔ chart line / bar shapes.
 */

import { describe, expect, it } from 'bun:test';
import {
  datasetToBars,
  datasetToScalarPoints,
  normalizeProtocolSlug,
  pointsToLineData,
} from '../src/onchain/adapters';
import type { OnchainDataset, OnchainInstrument, TimePoint } from '../src/onchain/types';

function instrument(partial: Partial<OnchainInstrument> = {}): OnchainInstrument {
  return {
    chainId: 'all',
    protocolId: 'uniswap',
    metric: 'tvl',
    symbol: 'Uniswap TVL',
    ...partial,
  };
}

function baseDataset(partial: Partial<OnchainDataset> = {}): OnchainDataset {
  return {
    id: 'ds-1',
    kind: 'scalar_series',
    instrument: instrument(),
    resolution: '1d',
    asOf: 1_700_000_000,
    finality: 'finalized',
    provenance: { provider: 'defillama' },
    ...partial,
  };
}

describe('pointsToLineData', () => {
  it('maps finite points, sorts by time, and dedupes (last wins)', () => {
    const pts: TimePoint[] = [
      { time: 3, value: 30 },
      { time: 1, value: 10 },
      { time: 2, value: 20 },
      { time: 2, value: 22 },
      { time: Number.NaN, value: 1 },
      { time: 4, value: Number.POSITIVE_INFINITY },
    ];
    expect(pointsToLineData(pts)).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 22 },
      { time: 3, value: 30 },
    ]);
  });

  it('returns empty for null / undefined / empty', () => {
    expect(pointsToLineData(null)).toEqual([]);
    expect(pointsToLineData(undefined)).toEqual([]);
    expect(pointsToLineData([])).toEqual([]);
  });
});

describe('datasetToScalarPoints', () => {
  it('prefers points when present', () => {
    const ds = baseDataset({
      points: [
        { time: 2, value: 20 },
        { time: 1, value: 10 },
      ],
      series: { alt: [{ time: 9, value: 99 }] },
      bars: [{ time: 1, open: 1, high: 1, low: 1, close: 5 }],
    });
    expect(datasetToScalarPoints(ds)).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 20 },
    ]);
  });

  it('falls back to first non-empty series', () => {
    const ds = baseDataset({
      series: {
        empty: [],
        tvl: [
          { time: 2, value: 200 },
          { time: 1, value: Number.NaN },
          { time: 1, value: 100 },
        ],
      },
    });
    expect(datasetToScalarPoints(ds)).toEqual([
      { time: 1, value: 100 },
      { time: 2, value: 200 },
    ]);
  });

  it('falls back to bar closes', () => {
    const ds = baseDataset({
      kind: 'ohlcv',
      bars: [
        { time: 2, open: 1, high: 2, low: 1, close: 1.5 },
        { time: 1, open: 1, high: 2, low: 1, close: 1.1 },
      ],
    });
    expect(datasetToScalarPoints(ds)).toEqual([
      { time: 1, value: 1.1 },
      { time: 2, value: 1.5 },
    ]);
  });

  it('returns empty for null / empty dataset', () => {
    expect(datasetToScalarPoints(null)).toEqual([]);
    expect(datasetToScalarPoints(undefined)).toEqual([]);
    expect(datasetToScalarPoints(baseDataset())).toEqual([]);
  });
});

describe('datasetToBars', () => {
  it('copies ohlcv bars when kind is ohlcv', () => {
    const ds = baseDataset({
      kind: 'ohlcv',
      bars: [
        { time: 2, open: 2, high: 3, low: 1, close: 2.5, volume: 10 },
        { time: 1, open: 1, high: 2, low: 0.5, close: 1.5 },
      ],
      synthetic: false,
    });
    const { bars, synthetic } = datasetToBars(ds);
    expect(synthetic).toBe(false);
    expect(bars.map((b) => b.time)).toEqual([1, 2]);
    expect(bars[1]!.close).toBe(2.5);
    expect(bars[1]!.volume).toBe(10);
  });

  it('synthesizes flat OHLC from scalar points', () => {
    const ds = baseDataset({
      points: [
        { time: 1, value: 100 },
        { time: 2, value: 110 },
      ],
    });
    const { bars, synthetic } = datasetToBars(ds);
    expect(synthetic).toBe(true);
    expect(bars).toEqual([
      { time: 1, open: 100, high: 100, low: 100, close: 100 },
      { time: 2, open: 110, high: 110, low: 110, close: 110 },
    ]);
  });
});

describe('normalizeProtocolSlug', () => {
  it('lowercases, hyphenates whitespace, and strips junk', () => {
    expect(normalizeProtocolSlug('  Aave V3  ')).toBe('aave-v3');
    expect(normalizeProtocolSlug('Uniswap (V3)!')).toBe('uniswap-v3');
    expect(normalizeProtocolSlug('foo---bar')).toBe('foo-bar');
  });

  it('returns empty for blank input', () => {
    expect(normalizeProtocolSlug('')).toBe('');
    expect(normalizeProtocolSlug('   ')).toBe('');
  });
});
