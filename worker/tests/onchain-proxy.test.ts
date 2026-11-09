/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Worker on-chain allowlisted DefiLlama + GeckoTerminal proxy (`src/onchain.ts`).
 */

import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import {
  handleOnchain,
  slimLlamaProtocols,
  LLAMA_PROTOCOLS_RATE_LIMIT,
  LLAMA_PROTOCOLS_RESPONSE_MAX_BYTES,
  ONCHAIN_IP_LIMIT,
  ONCHAIN_UPSTREAM_MAX_BYTES,
  _resetOnchainCacheForTests,
} from '../src/onchain';
import { _resetRateLimitsForTests } from '../src/rate-limit';
import type { Env } from '../src/index';

const origin = 'http://localhost:3000';
const env = {} as Env;

function req(path: string, method = 'GET'): Request {
  return new Request(`https://worker.example${path}`, { method });
}

beforeEach(() => {
  _resetOnchainCacheForTests();
  _resetRateLimitsForTests();
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
      expect(r1!.headers.get('RateLimit-Limit')).toBe(String(LLAMA_PROTOCOLS_RATE_LIMIT));
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

  it('proxies search/pools with query and caches', async () => {    let calls = 0;
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

describe('handleOnchain llama protocols size cap', () => {
  it('slims a fat DefiLlama dump so a guest never receives multi-MB JSON', async () => {
    const originalFetch = globalThis.fetch;
    const fat = [
      {
        slug: 'aave',
        name: 'Aave',
        tvl: 5,
        category: 'Lending',
        chainTvls: { Ethereum: 1, Polygon: 1 },
        tokens: { AAVE: 'x'.repeat(4000) },
      },
      {
        slug: 'uniswap',
        name: 'Uniswap',
        tvl: 9,
        extra: { history: 'y'.repeat(4000) },
      },
    ];
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(fat), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      const res = await handleOnchain(
        req('/api/onchain/llama/protocols'),
        env,
        origin,
        '/api/onchain/llama/protocols',
      );
      expect(res!.status).toBe(200);
      const body = (await res!.json()) as Array<Record<string, unknown>>;
      expect(body).toHaveLength(2);
      expect(body[0]?.slug).toBe('uniswap');
      expect(body[0]?.tvl).toBe(9);
      expect(body[0]?.tokens).toBeUndefined();
      expect(body[0]?.extra).toBeUndefined();
      expect(body[0]?.chainTvls).toBeUndefined();
      expect(body[1]?.slug).toBe('aave');
      expect(body[1]?.category).toBe('Lending');
      const bytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
      expect(bytes).toBeLessThan(LLAMA_PROTOCOLS_RESPONSE_MAX_BYTES);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('truncates a slim list that still exceeds the guest byte cap', () => {
    const rows = Array.from({ length: 80_000 }, (_, i) => ({
      slug: `p${i}`,
      name: `Protocol ${i}`,
      tvl: 80_000 - i,
      category: 'Dexes',
    }));
    const slim = slimLlamaProtocols(JSON.stringify(rows), 8_192);
    expect(slim).not.toBeNull();
    const bytes = new TextEncoder().encode(slim!).byteLength;
    expect(bytes).toBeLessThanOrEqual(8_192);
    const parsed = JSON.parse(slim!) as Array<{ slug: string }>;
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.length).toBeLessThan(rows.length);
    expect(parsed[0]?.slug).toBe('p0');
  });

  it('rejects an over-cap gecko body with 413 PAYLOAD_TOO_LARGE', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"data":true}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(ONCHAIN_UPSTREAM_MAX_BYTES + 1),
        },
      })) as typeof fetch;
    const path = `/api/onchain/gecko/networks/eth/pools/${WETH_USDC_POOL}/ohlcv/hour`;
    try {
      const res = await handleOnchain(req(path), env, origin, path);
      expect(res!.status).toBe(413);
      expect((await res!.json()).code).toBe('PAYLOAD_TOO_LARGE');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('handleOnchain abuse controls (A5)', () => {
  it('coalesces concurrent identical fetches into one upstream call', async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async () => {
      calls += 1;
      return gate;
    }) as typeof fetch;

    try {
      const p1 = handleOnchain(req('/api/onchain/llama/protocols'), env, origin, '/api/onchain/llama/protocols');
      const p2 = handleOnchain(req('/api/onchain/llama/protocols'), env, origin, '/api/onchain/llama/protocols');
      release(
        new Response(JSON.stringify([{ slug: 'aave' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1!.status).toBe(200);
      expect(r2!.status).toBe(200);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('leaves on-chain health unmetered', async () => {
    let last: Response | null = null;
    for (let i = 0; i < ONCHAIN_IP_LIMIT + 5; i++) {
      last = await handleOnchain(req('/api/onchain/health'), env, origin, '/api/onchain/health');
    }
    expect(last!.status).toBe(200);
    expect((await last!.json()).status).toBe('healthy');
  });

  it('rate-limits llama/protocols per IP and advertises the limit', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([{ slug: 'aave', name: 'Aave', tvl: 1 }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      let last: Response | null = null;
      for (let i = 0; i < LLAMA_PROTOCOLS_RATE_LIMIT + 1; i++) {
        last = await handleOnchain(
          req('/api/onchain/llama/protocols'),
          env,
          origin,
          '/api/onchain/llama/protocols',
        );
      }
      expect(last!.status).toBe(429);
      expect(last!.headers.get('Retry-After')).toBe('60');
      expect(last!.headers.get('RateLimit-Limit')).toBe(String(LLAMA_PROTOCOLS_RATE_LIMIT));
      expect((await last!.json()).code).toBe('RATE_LIMIT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rate-limits other on-chain data routes after the shared window', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const path = `/api/onchain/gecko/networks/eth/pools/${WETH_USDC_POOL}/ohlcv/hour`;
    try {
      let last: Response | null = null;
      for (let i = 0; i < ONCHAIN_IP_LIMIT + 1; i++) {
        _resetOnchainCacheForTests();
        last = await handleOnchain(req(path), env, origin, path);
      }
      expect(last!.status).toBe(429);
      expect((await last!.json()).code).toBe('RATE_LIMIT');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
