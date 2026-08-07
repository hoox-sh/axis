/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * On-chain dataset cache — memory path (IndexedDB unavailable in Bun unit tests).
 */

import { describe, expect, it, beforeEach } from 'bun:test';
import {
  ONCHAIN_CACHE_MAX_SERIES,
  _clearOnchainMemoryCache,
  deleteCachedDataset,
  getCachedDataset,
  listCachedDatasetKeys,
  putCachedDataset,
} from '../src/onchain/cache';
import { instrumentCacheKey } from '../src/onchain/keys';
import type { OnchainDataset, OnchainInstrument } from '../src/onchain/types';

function instrument(partial: Partial<OnchainInstrument> = {}): OnchainInstrument {
  return {
    chainId: 'all',
    protocolId: 'aave',
    metric: 'tvl',
    symbol: 'Aave TVL',
    ...partial,
  };
}

function dataset(partial: Partial<OnchainDataset> = {}): OnchainDataset {
  return {
    id: 'defillama-tvl:aave',
    kind: 'scalar_series',
    instrument: instrument(),
    resolution: '1d',
    points: [
      { time: 100, value: 1 },
      { time: 200, value: 2 },
    ],
    asOf: 1_700_000_000,
    finality: 'finalized',
    provenance: { provider: 'defillama', queryId: 'aave' },
    ...partial,
  };
}

describe('onchain-cache (memory)', () => {
  beforeEach(() => {
    _clearOnchainMemoryCache();
  });

  it('put/get round-trip clones the dataset', async () => {
    const key = instrumentCacheKey('defillama', instrument(), '1d');
    const src = dataset();
    await putCachedDataset(key, src);

    const got = await getCachedDataset(key);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(src.id);
    expect(got!.points).toEqual(src.points);
    expect(got!.instrument.protocolId).toBe('aave');

    // Mutation of returned clone must not poison cache
    got!.points![0]!.value = 999;
    const again = await getCachedDataset(key);
    expect(again!.points![0]!.value).toBe(1);
  });

  it('returns null for missing / blank keys', async () => {
    expect(await getCachedDataset('missing')).toBeNull();
    expect(await getCachedDataset('')).toBeNull();
    expect(await getCachedDataset('   ')).toBeNull();
  });

  it('delete removes a key; list reflects stored keys', async () => {
    const k1 = instrumentCacheKey('defillama', instrument({ protocolId: 'aave' }), '1d');
    const k2 = instrumentCacheKey('defillama', instrument({ protocolId: 'lido' }), '1d');
    await putCachedDataset(k1, dataset({ id: 'a', instrument: instrument({ protocolId: 'aave' }) }));
    await putCachedDataset(k2, dataset({ id: 'b', instrument: instrument({ protocolId: 'lido' }) }));

    const keys = await listCachedDatasetKeys();
    expect(keys).toContain(k1);
    expect(keys).toContain(k2);

    await deleteCachedDataset(k1);
    expect(await getCachedDataset(k1)).toBeNull();
    expect(await getCachedDataset(k2)).not.toBeNull();
  });

  it('ignores put with blank key', async () => {
    await putCachedDataset('', dataset());
    expect(await listCachedDatasetKeys()).toEqual([]);
  });

  it('exposes a finite series cap', () => {
    expect(ONCHAIN_CACHE_MAX_SERIES).toBeGreaterThan(0);
    expect(ONCHAIN_CACHE_MAX_SERIES).toBeLessThanOrEqual(256);
  });

  it('evicts oldest when over memory series cap', async () => {
    const n = ONCHAIN_CACHE_MAX_SERIES + 4;
    for (let i = 0; i < n; i++) {
      const inst = instrument({ protocolId: `p${i}` });
      const key = instrumentCacheKey('defillama', inst, '1d');
      await putCachedDataset(
        key,
        dataset({ id: `ds-${i}`, instrument: inst, points: [{ time: i, value: i }] }),
      );
      // Ensure updatedAt ordering is distinct across puts
      await Bun.sleep(1);
    }
    const keys = await listCachedDatasetKeys();
    expect(keys.length).toBeLessThanOrEqual(ONCHAIN_CACHE_MAX_SERIES);
    // Newest protocol should still be present
    const newest = instrumentCacheKey(
      'defillama',
      instrument({ protocolId: `p${n - 1}` }),
      '1d',
    );
    expect(keys).toContain(newest);
  });
});
