/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cache / series key helpers for the on-chain data plane.
 */

import { describe, expect, it } from 'bun:test';
import { instrumentCacheKey, seriesSeriesKey } from '../src/onchain/keys';
import type { OnchainInstrument } from '../src/onchain/types';

function inst(partial: Partial<OnchainInstrument> = {}): OnchainInstrument {
  return {
    chainId: 'eip155:1',
    protocolId: 'aave',
    metric: 'tvl',
    symbol: 'AAVE TVL',
    ...partial,
  };
}

describe('instrumentCacheKey', () => {
  it('builds stable provider|chain|protocol|address|metric|facet|resolution keys', () => {
    expect(instrumentCacheKey('defillama', inst({ address: '0xabc', facet: 'usd' }), '1d')).toBe(
      'defillama|eip155:1|aave|0xabc|tvl|usd|1d',
    );
  });

  it('normalizes empty / missing parts to underscore', () => {
    expect(
      instrumentCacheKey('', inst({ chainId: '', protocolId: undefined, address: '  ', facet: '' }), ''),
    ).toBe('_|_|_|_|tvl|_|_');
  });

  it('is deterministic for the same inputs', () => {
    const a = instrumentCacheKey('defillama', inst(), '1d');
    const b = instrumentCacheKey('defillama', inst(), '1d');
    expect(a).toBe(b);
  });

  it('distinguishes resolution and metric', () => {
    const base = inst();
    expect(instrumentCacheKey('defillama', base, '1d')).not.toBe(
      instrumentCacheKey('defillama', base, '1h'),
    );
    expect(instrumentCacheKey('defillama', inst({ metric: 'tvl' }), '1d')).not.toBe(
      instrumentCacheKey('defillama', inst({ metric: 'fees' }), '1d'),
    );
  });
});

describe('seriesSeriesKey', () => {
  it('prefixes attachment ids with onchain_', () => {
    expect(seriesSeriesKey('att-1')).toBe('onchain_att-1');
  });

  it('falls back to onchain_unknown for blank ids', () => {
    expect(seriesSeriesKey('')).toBe('onchain_unknown');
    expect(seriesSeriesKey('   ')).toBe('onchain_unknown');
  });
});
