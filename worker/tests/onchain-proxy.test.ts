/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Worker on-chain allowlisted DefiLlama + GeckoTerminal proxy (`src/onchain.ts`).
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { handleOnchain, _resetOnchainCacheForTests } from '../src/onchain';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';
const env = {} as Env;

function req(path: string, method = 'GET'): Request {
  return new Request(`https://worker.example${path}`, { method });
}

beforeEach(() => {
  _resetOnchainCacheForTests();
});

afterEach(() => {
  mock.restore();
});

describe('handleOnchain routing', () => {
  it('returns null for non-onchain paths', async () => {
    expect(await handleOnchain(req('/api/run'), env, origin, '/api/run')).toBeNull();
  });

  it('serves health with defillama and geckoterminal', async () => {
    const res = await handleOnchain(req('/api/onchain/health'), env, origin, '/api/onchain/health');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as {
      status: string;
      providers: { defillama: unknown; geckoterminal: unknown };
    };
    expect(body.status).toBe('healthy');
    expect(body.providers.defillama).toBeTruthy();
    expect(body.providers.geckoterminal).toBeTruthy();
  });

  it('rejects bad slugs', async () => {
    // Path-style traversal never matches /protocol/:slug → 404 NOT_FOUND
    const traversal = await handleOnchain(
      req('/api/onchain/llama/protocol/../etc/passwd'),
      env,
      origin,
      '/api/onchain/llama/protocol/../etc/passwd',
    );
    expect(traversal!.status).toBe(404);

    // Single-segment junk slug matches route but fails SLUG_RE → 400
    const res = await handleOnchain(
      req('/api/onchain/llama/protocol/not%20valid!'),
      env,
      origin,
      '/api/onchain/llama/protocol/not%20valid!',
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('BAD_SLUG');
  });

  it('rejects non-GET', async () => {
    const res = await handleOnchain(
      req('/api/onchain/health', 'POST'),
      env,
      origin,
      '/api/onchain/health',
    );
    expect(res!.status).toBe(405);
  });
});

describe('handleOnchain llama proxy', () => {
  it('proxies protocols list and caches', async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      expect(url).toContain('api.llama.fi/protocols');
      return new Response(JSON.stringify([{ slug: 'aave', name: 'Aave', tvl: 1 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const r1 = await handleOnchain(
        req('/api/onchain/llama/protocols'),
        env,
        origin,
        '/api/onchain/llama/protocols',
      );
      expect(r1!.status).toBe(200);
      expect(r1!.headers.get('X-Axis-Onchain-Cache')).toBe('MISS');
      const j1 = (await r1!.json()) as Array<{ slug: string }>;
      expect(j1[0]?.slug).toBe('aave');

      const r2 = await handleOnchain(
        req('/api/onchain/llama/protocols'),
        env,
        origin,
        '/api/onchain/llama/protocols',
      );
      expect(r2!.headers.get('X-Axis-Onchain-Cache')).toBe('HIT');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('proxies protocol TVL by slug', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe('https://api.llama.fi/protocol/aave');
      return new Response(
        JSON.stringify({
          name: 'Aave',
          slug: 'aave',
          tvl: [{ date: 1_700_000_000, totalLiquidityUSD: 1e9 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    try {
      const res = await handleOnchain(
        req('/api/onchain/llama/protocol/aave'),
        env,
        origin,
        '/api/onchain/llama/protocol/aave',
      );
      expect(res!.status).toBe(200);
      const body = (await res!.json()) as { slug: string; tvl: unknown[] };
      expect(body.slug).toBe('aave');
      expect(body.tvl.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

const WETH_USDC_POOL = '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640';
const SOL_POOL = '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm';

describe('handleOnchain gecko routing', () => {
  it('rejects invalid network', async () => {
    const res = await handleOnchain(
      req(`/api/onchain/gecko/networks/ETH!/pools/${WETH_USDC_POOL}/ohlcv/hour`),
      env,
      origin,
      `/api/onchain/gecko/networks/ETH!/pools/${WETH_USDC_POOL}/ohlcv/hour`,
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('BAD_NETWORK');
  });

  it('rejects invalid EVM address', async () => {
    const res = await handleOnchain(
      req('/api/onchain/gecko/networks/eth/pools/0xdead/ohlcv/hour'),
      env,
      origin,
      '/api/onchain/gecko/networks/eth/pools/0xdead/ohlcv/hour',
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('BAD_ADDRESS');
  });

  it('rejects invalid timeframe', async () => {
    const res = await handleOnchain(
      req(`/api/onchain/gecko/networks/eth/pools/${WETH_USDC_POOL}/ohlcv/week`),
      env,
      origin,
      `/api/onchain/gecko/networks/eth/pools/${WETH_USDC_POOL}/ohlcv/week`,
    );
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('BAD_TIMEFRAME');
  });

  it('rejects non-allowlisted gecko paths', async () => {
    const res = await handleOnchain(
      req('/api/onchain/gecko/networks/eth/pools'),
      env,
      origin,
      '/api/onchain/gecko/networks/eth/pools',
    );
    expect(res!.status).toBe(404);
    const body = (await res!.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

describe('handleOnchain gecko proxy', () => {
  it('proxies pool OHLCV with query pass-through and caches', async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      expect(url).toContain(
        `https://api.geckoterminal.com/api/v2/networks/eth/pools/${WETH_USDC_POOL}/ohlcv/hour`,
      );
      expect(url).toContain('aggregate=1');
      expect(url).toContain('limit=100');
      expect(url).toContain('currency=usd');
      expect(url).toContain('before_timestamp=1700000000');
      // Disallowed keys must not be forwarded
      expect(url).not.toContain('token=');
      return new Response(
        JSON.stringify({
          data: {
            attributes: {
              ohlcv_list: [[1_700_000_000, 1, 2, 0.5, 1.5, 1000]],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const path =
      `/api/onchain/gecko/networks/eth/pools/${WETH_USDC_POOL}/ohlcv/hour` +
      '?aggregate=1&limit=100&currency=usd&before_timestamp=1700000000&token=base';

    try {
      const r1 = await handleOnchain(req(path), env, origin, path.split('?')[0]!);
      expect(r1!.status).toBe(200);
      expect(r1!.headers.get('X-Axis-Onchain-Cache')).toBe('MISS');
      const j1 = (await r1!.json()) as {
        data: { attributes: { ohlcv_list: unknown[] } };
      };
      expect(j1.data.attributes.ohlcv_list).toHaveLength(1);

      const r2 = await handleOnchain(req(path), env, origin, path.split('?')[0]!);
      expect(r2!.headers.get('X-Axis-Onchain-Cache')).toBe('HIT');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('proxies Solana base58 pool address', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toBe(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${SOL_POOL}/ohlcv/day`,
      );
      return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const path = `/api/onchain/gecko/networks/solana/pools/${SOL_POOL}/ohlcv/day`;
    try {
      const res = await handleOnchain(req(path), env, origin, path);
      expect(res!.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('proxies search/pools with query and caches', async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      expect(url).toContain('https://api.geckoterminal.com/api/v2/search/pools');
      expect(url).toContain('query=ETH');
      expect(url).toContain('network=eth');
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'eth_0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
              attributes: {
                address: WETH_USDC_POOL,
                name: 'WETH / USDC 0.05%',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const path = '/api/onchain/gecko/search/pools?query=ETH&network=eth';
    try {
      const r1 = await handleOnchain(
        req(path),
        env,
        origin,
        '/api/onchain/gecko/search/pools',
      );
      expect(r1!.status).toBe(200);
      expect(r1!.headers.get('X-Axis-Onchain-Cache')).toBe('MISS');
      const j1 = (await r1!.json()) as { data: unknown[] };
      expect(j1.data).toHaveLength(1);

      const r2 = await handleOnchain(
        req(path),
        env,
        origin,
        '/api/onchain/gecko/search/pools',
      );
      expect(r2!.headers.get('X-Axis-Onchain-Cache')).toBe('HIT');
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
