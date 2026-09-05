/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * GeckoTerminal parse/map helpers (`src/onchain/geckoterminal.ts`).
 * Pure unit tests + mocked fetch — no live network.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  GECKOTERMINAL_DEFAULT_BASE,
  GECKOTERMINAL_PROVIDER_ID,
  GECKO_OHLCV_MAX_LIMIT,
  mapAxisIntervalToGecko,
  mapAxisNetworkToGecko,
  parseGeckoOhlcvList,
  fetchGeckoPoolOhlcv,
  resolveGeckoBeforeTimestamp,
  searchGeckoPools,
} from '../src/onchain/geckoterminal';
import { jsonResponse, mockFetch } from './helpers/mock-fetch';

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  restoreFetch = null;
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe('geckoterminal constants', () => {
  it('exports provider id and public API base', () => {
    expect(GECKOTERMINAL_PROVIDER_ID).toBe('geckoterminal');
    expect(GECKOTERMINAL_DEFAULT_BASE).toBe(
      'https://api.geckoterminal.com/api/v2',
    );
    expect(GECKO_OHLCV_MAX_LIMIT).toBe(1000);
  });
});

describe('resolveGeckoBeforeTimestamp', () => {
  it('prefers beforeTimestamp over endTime and normalizes ms', () => {
    expect(resolveGeckoBeforeTimestamp({ beforeTimestamp: 1_700_000_000 })).toBe(
      1_700_000_000,
    );
    expect(resolveGeckoBeforeTimestamp({ endTime: 1_700_000_000 })).toBe(
      1_700_000_000,
    );
    expect(
      resolveGeckoBeforeTimestamp({
        beforeTimestamp: 100,
        endTime: 999,
      }),
    ).toBe(100);
    expect(
      resolveGeckoBeforeTimestamp({ endTime: 1_700_000_000_000 }),
    ).toBe(1_700_000_000);
    expect(resolveGeckoBeforeTimestamp({})).toBeNull();
    expect(resolveGeckoBeforeTimestamp({ endTime: 0 })).toBeNull();
  });
});

describe('mapAxisNetworkToGecko', () => {
  it('maps common chain aliases', () => {
    expect(mapAxisNetworkToGecko('ethereum')).toBe('eth');
    expect(mapAxisNetworkToGecko('ETH')).toBe('eth');
    expect(mapAxisNetworkToGecko('1')).toBe('eth');
    expect(mapAxisNetworkToGecko('eip155:1')).toBe('eth');
    expect(mapAxisNetworkToGecko('bsc')).toBe('bsc');
    expect(mapAxisNetworkToGecko('56')).toBe('bsc');
    expect(mapAxisNetworkToGecko('arbitrum')).toBe('arbitrum');
    expect(mapAxisNetworkToGecko('base')).toBe('base');
    expect(mapAxisNetworkToGecko('polygon')).toBe('polygon_pos');
    expect(mapAxisNetworkToGecko('solana')).toBe('solana');
    expect(mapAxisNetworkToGecko('sol')).toBe('solana');
  });

  it('returns empty for blank and lowercases unknown ids', () => {
    expect(mapAxisNetworkToGecko('')).toBe('');
    expect(mapAxisNetworkToGecko('  ')).toBe('');
    expect(mapAxisNetworkToGecko('Avalanche')).toBe('avalanche');
  });
});

describe('mapAxisIntervalToGecko', () => {
  it('maps minute / hour / day intervals', () => {
    expect(mapAxisIntervalToGecko('1m')).toEqual({
      timeframe: 'minute',
      aggregate: 1,
    });
    expect(mapAxisIntervalToGecko('5m')).toEqual({
      timeframe: 'minute',
      aggregate: 5,
    });
    expect(mapAxisIntervalToGecko('15m')).toEqual({
      timeframe: 'minute',
      aggregate: 15,
    });
    expect(mapAxisIntervalToGecko('1h')).toEqual({
      timeframe: 'hour',
      aggregate: 1,
    });
    expect(mapAxisIntervalToGecko('4h')).toEqual({
      timeframe: 'hour',
      aggregate: 4,
    });
    expect(mapAxisIntervalToGecko('12h')).toEqual({
      timeframe: 'hour',
      aggregate: 12,
    });
    expect(mapAxisIntervalToGecko('1d')).toEqual({
      timeframe: 'day',
      aggregate: 1,
    });
    expect(mapAxisIntervalToGecko('1M')).toEqual({
      timeframe: 'day',
      aggregate: 1,
    });
  });

  it('falls back unknown intervals to 1h', () => {
    expect(mapAxisIntervalToGecko('')).toEqual({
      timeframe: 'hour',
      aggregate: 1,
    });
    expect(mapAxisIntervalToGecko('weird')).toEqual({
      timeframe: 'hour',
      aggregate: 1,
    });
  });
});

describe('parseGeckoOhlcvList', () => {
  it('maps [ts, o, h, l, c, v] rows, sorts, and dedupes', () => {
    const bars = parseGeckoOhlcvList([
      [300, 3, 4, 2, 3.5, 30],
      [100, 1, 2, 0.5, 1.5, 10],
      [200, 2, 3, 1, 2.5, 20],
      [200, 2.1, 3.1, 1.1, 2.6, 21], // last wins
      ['bad', 1, 1, 1, 1, 1],
      [400, 1], // too short
    ]);
    expect(bars).toEqual([
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 200, open: 2.1, high: 3.1, low: 1.1, close: 2.6, volume: 21 },
      { time: 300, open: 3, high: 4, low: 2, close: 3.5, volume: 30 },
    ]);
  });

  it('accepts millisecond timestamps and JSON:API envelope', () => {
    const bars = parseGeckoOhlcvList({
      data: {
        attributes: {
          ohlcv_list: [[1_700_000_000_000, 10, 12, 9, 11, 1000]],
        },
      },
    });
    expect(bars).toHaveLength(1);
    expect(bars[0]!.time).toBe(1_700_000_000);
    expect(bars[0]!.open).toBe(10);
    expect(bars[0]!.high).toBe(12);
    expect(bars[0]!.low).toBe(9);
    expect(bars[0]!.close).toBe(11);
    expect(bars[0]!.volume).toBe(1000);
  });

  it('returns empty for non-arrays / missing list', () => {
    expect(parseGeckoOhlcvList(null)).toEqual([]);
    expect(parseGeckoOhlcvList({})).toEqual([]);
    expect(parseGeckoOhlcvList({ data: {} })).toEqual([]);
  });
});

const POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';

describe('fetchGeckoPoolOhlcv', () => {
  it('builds upstream URL and returns parsed bars', async () => {
    const calls: string[] = [];
    restoreFetch = mockFetch((input) => {
      const url = String(input);
      calls.push(url);
      expect(url).toContain(
        `${GECKOTERMINAL_DEFAULT_BASE}/networks/eth/pools/${POOL}/ohlcv/hour`,
      );
      expect(url).toContain('aggregate=1');
      expect(url).toContain('currency=usd');
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [
              [100, 1, 2, 0.5, 1.5, 10],
              [200, 1.5, 2.5, 1, 2, 20],
            ],
          },
        },
      });
    });

    const bars = await fetchGeckoPoolOhlcv({
      network: 'ethereum',
      poolAddress: POOL,
      interval: '1h',
      limit: 50,
    });
    expect(calls).toHaveLength(1);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.close).toBe(1.5);
    expect(bars[1]!.close).toBe(2);
  });

  it('honors baseUrl override (Worker proxy path)', async () => {
    restoreFetch = mockFetch((input) => {
      expect(String(input)).toContain(
        `https://proxy.example/gecko/networks/eth/pools/${POOL}/ohlcv/day`,
      );
      return jsonResponse({
        data: { attributes: { ohlcv_list: [[1, 1, 1, 1, 1, 1]] } },
      });
    });
    const bars = await fetchGeckoPoolOhlcv({
      network: 'eth',
      poolAddress: POOL,
      interval: '1d',
      baseUrl: 'https://proxy.example/gecko/',
    });
    expect(bars).toHaveLength(1);
  });

  it('maps endTime → before_timestamp and keeps bars strictly before', async () => {
    const endTime = 1_700_000_300;
    const calls: string[] = [];
    restoreFetch = mockFetch((input) => {
      const url = String(input);
      calls.push(url);
      expect(url).toContain(`before_timestamp=${endTime}`);
      expect(url).toContain('limit=1000');
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [
              [1_700_000_100, 1, 2, 0.5, 1.5, 10],
              [1_700_000_200, 1.5, 2.5, 1, 2, 20],
              // Inclusive boundary / leak — must be dropped (strictly before)
              [endTime, 2, 3, 1, 2.5, 30],
              [1_700_000_400, 3, 4, 2, 3.5, 40],
            ],
          },
        },
      });
    });

    const bars = await fetchGeckoPoolOhlcv({
      network: 'eth',
      poolAddress: POOL,
      interval: '1h',
      limit: 5000, // clamp to GECKO_OHLCV_MAX_LIMIT
      endTime,
    });
    expect(calls).toHaveLength(1);
    expect(bars.map((b) => b.time)).toEqual([1_700_000_100, 1_700_000_200]);
    for (const b of bars) {
      expect(b.time).toBeLessThan(endTime);
    }
    // ascending
    expect(bars[0]!.time).toBeLessThan(bars[1]!.time);
  });

  it('maps beforeTimestamp → before_timestamp (alias of endTime)', async () => {
    restoreFetch = mockFetch((input) => {
      expect(String(input)).toContain('before_timestamp=1700000100');
      return jsonResponse({
        data: {
          attributes: {
            ohlcv_list: [[1_700_000_050, 1, 1, 1, 1, 1]],
          },
        },
      });
    });
    const bars = await fetchGeckoPoolOhlcv({
      network: 'eth',
      poolAddress: POOL,
      interval: '1h',
      beforeTimestamp: 1_700_000_100,
    });
    expect(bars).toHaveLength(1);
    expect(bars[0]!.time).toBe(1_700_000_050);
  });

  it('rejects missing params and empty OHLCV', async () => {
    await expect(
      fetchGeckoPoolOhlcv({ network: '', poolAddress: POOL, interval: '1h' }),
    ).rejects.toThrow(/network is required/i);

    await expect(
      fetchGeckoPoolOhlcv({ network: 'eth', poolAddress: '  ', interval: '1h' }),
    ).rejects.toThrow(/poolAddress is required/i);

    restoreFetch = mockFetch(() =>
      jsonResponse({ data: { attributes: { ohlcv_list: [] } } }),
    );
    await expect(
      fetchGeckoPoolOhlcv({
        network: 'eth',
        poolAddress: POOL,
        interval: '1h',
      }),
    ).rejects.toThrow(/empty OHLCV/i);
  });

  it('surfaces HTTP errors', async () => {
    restoreFetch = mockFetch(() => jsonResponse({ errors: [] }, 404));
    await expect(
      fetchGeckoPoolOhlcv({
        network: 'eth',
        poolAddress: POOL,
        interval: '1h',
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('searchGeckoPools', () => {
  it('parses JSON:API pool hits', async () => {
    restoreFetch = mockFetch((input) => {
      const url = String(input);
      expect(url).toContain(`${GECKOTERMINAL_DEFAULT_BASE}/search/pools`);
      expect(url).toContain('query=WETH');
      expect(url).toContain('network=eth');
      return jsonResponse({
        data: [
          {
            id: `eth_${POOL}`,
            type: 'pool',
            attributes: {
              address: POOL,
              name: 'WETH / USDC 0.05%',
              base_token_price_usd: '2500.5',
            },
            relationships: {
              network: { data: { id: 'eth', type: 'network' } },
            },
          },
        ],
      });
    });

    const hits = await searchGeckoPools({ query: 'WETH', network: 'ethereum' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.address).toBe(POOL);
    expect(hits[0]!.network).toBe('eth');
    expect(hits[0]!.name).toContain('WETH');
    expect(hits[0]!.priceUsd).toBe(2500.5);
  });

  it('returns empty for blank query', async () => {
    const hits = await searchGeckoPools({ query: '   ' });
    expect(hits).toEqual([]);
  });
});
