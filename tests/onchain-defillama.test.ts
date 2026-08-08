/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * DefiLlama protocol TVL fetch + history parse (mocked global fetch).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  DEFILLAMA_DEFAULT_BASE,
  DEFILLAMA_PROVIDER_ID,
  _clearDefiLlamaProtocolsCache,
  fetchDefiLlamaProtocolTvl,
  parseDefiLlamaTvlHistory,
  searchDefiLlamaProtocols,
} from '../src/onchain/defillama';
import { jsonResponse, mockFetch } from './helpers/mock-fetch';

let restoreFetch: (() => void) | null = null;

beforeEach(() => {
  _clearDefiLlamaProtocolsCache();
  restoreFetch = null;
});

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  _clearDefiLlamaProtocolsCache();
});

describe('parseDefiLlamaTvlHistory', () => {
  it('maps date + totalLiquidityUSD, sorts, and dedupes', () => {
    expect(
      parseDefiLlamaTvlHistory([
        { date: 3, totalLiquidityUSD: 30 },
        { date: 1, totalLiquidityUSD: 10 },
        { date: 2, totalLiquidityUSD: 20 },
        { date: 2, totalLiquidityUSD: 22 },
        { date: 'bad', totalLiquidityUSD: 1 },
      ]),
    ).toEqual([
      { time: 1, value: 10 },
      { time: 2, value: 22 },
      { time: 3, value: 30 },
    ]);
  });

  it('accepts millisecond dates and alternate value keys', () => {
    const pts = parseDefiLlamaTvlHistory([
      { date: 1_700_000_000_000, tvl: 100 },
      { date: 1_700_086_400, value: 110 },
    ]);
    expect(pts[0]!.time).toBe(1_700_000_000);
    expect(pts[0]!.value).toBe(100);
    expect(pts[1]!.time).toBe(1_700_086_400);
    expect(pts[1]!.value).toBe(110);
  });

  it('returns empty for non-arrays', () => {
    expect(parseDefiLlamaTvlHistory(null)).toEqual([]);
    expect(parseDefiLlamaTvlHistory({})).toEqual([]);
  });
});

describe('fetchDefiLlamaProtocolTvl', () => {
  it('fetches protocol TVL and builds a scalar OnchainDataset', async () => {
    const calls: string[] = [];
    restoreFetch = mockFetch((input) => {
      const url = String(input);
      calls.push(url);
      expect(url).toBe(`${DEFILLAMA_DEFAULT_BASE}/protocol/aave`);
      return jsonResponse({
        name: 'Aave',
        slug: 'aave',
        tvl: [
          { date: 100, totalLiquidityUSD: 1_000 },
          { date: 200, totalLiquidityUSD: 2_000 },
        ],
      });
    });

    const ds = await fetchDefiLlamaProtocolTvl('Aave');
    expect(calls).toHaveLength(1);
    expect(ds.id).toBe('defillama-tvl:aave');
    expect(ds.kind).toBe('scalar_series');
    expect(ds.resolution).toBe('1d');
    expect(ds.instrument).toEqual({
      chainId: 'all',
      protocolId: 'aave',
      metric: 'tvl',
      symbol: 'Aave TVL',
    });
    expect(ds.points).toEqual([
      { time: 100, value: 1_000 },
      { time: 200, value: 2_000 },
    ]);
    expect(ds.series?.tvl).toEqual(ds.points);
    expect(ds.finality).toBe('finalized');
    expect(ds.provenance).toEqual({
      provider: DEFILLAMA_PROVIDER_ID,
      queryId: 'aave',
      url: `${DEFILLAMA_DEFAULT_BASE}/protocol/aave`,
    });
  });

  it('honors baseUrl override (proxy path)', async () => {
    restoreFetch = mockFetch((input) => {
      expect(String(input)).toBe('https://proxy.example/llama/protocol/uniswap');
      return jsonResponse({
        name: 'Uniswap',
        slug: 'uniswap',
        tvl: [{ date: 1, totalLiquidityUSD: 9 }],
      });
    });
    const ds = await fetchDefiLlamaProtocolTvl('uniswap', {
      baseUrl: 'https://proxy.example/llama/',
    });
    expect(ds.provenance.url).toBe('https://proxy.example/llama/protocol/uniswap');
    expect(ds.points).toHaveLength(1);
  });

  it('rejects empty slug and empty TVL history', async () => {
    await expect(fetchDefiLlamaProtocolTvl('   ')).rejects.toThrow(/slug is required/i);

    restoreFetch = mockFetch(() =>
      jsonResponse({ name: 'Empty', slug: 'empty', tvl: [] }),
    );
    await expect(fetchDefiLlamaProtocolTvl('empty')).rejects.toThrow(/empty TVL history/i);
  });

  it('surfaces HTTP errors', async () => {
    restoreFetch = mockFetch(() => jsonResponse({ error: 'nope' }, 404));
    await expect(fetchDefiLlamaProtocolTvl('missing')).rejects.toThrow(/HTTP 404/);
  });
});

describe('searchDefiLlamaProtocols', () => {
  it('filters cached protocols list by name/slug', async () => {
    restoreFetch = mockFetch((input) => {
      expect(String(input)).toContain('/protocols');
      return jsonResponse([
        { name: 'Aave', slug: 'aave', tvl: 5e9 },
        { name: 'Uniswap', slug: 'uniswap', tvl: 4e9 },
        { name: 'Lido', slug: 'lido', tvl: 3e9 },
      ]);
    });

    const hits = await searchDefiLlamaProtocols('uni', 10);
    expect(hits.map((h) => h.slug)).toEqual(['uniswap']);
    expect(hits[0]!.name).toBe('Uniswap');
  });
});
