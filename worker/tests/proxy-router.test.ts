// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
//
// This file is part of axis.
//
// axis is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// axis is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with axis.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Allowlisted proxy router: prefix claim, method gate, ordered routes, and the
 * exported allowlists that pin the accepted `/api/onchain/*` and `/api/market/*`
 * paths. These planes are not an open reverse proxy — the route table is the
 * security boundary, so its contents are asserted here.
 */

import { describe, expect, it } from 'bun:test';
import { createProxyRouter, proxyJson, type ProxyRoute } from '../src/proxy-router';
import { READ_CORS } from '../src/http';
import { handleOnchain, onchainAllowlist } from '../src/onchain';
import { handleMarket, marketAllowlist } from '../src/market';

const ORIGIN = 'https://axis.hoox.sh';
const req = (method: string, url: string) => new Request(url, { method });

function okRoute(path: string): ProxyRoute {
  return { path, handle: ({ origin }) => proxyJson(READ_CORS)({ hit: path }, origin) };
}

function testRouter(routes: ProxyRoute[]) {
  return createProxyRouter({
    prefix: '/api/x',
    cors: READ_CORS,
    health: () => ({ status: 'healthy' }),
    routes,
    notFound: { message: 'Unknown /api/x%s', extra: { hint: 'see /api/x/health' } },
  });
}

describe('createProxyRouter routing', () => {
  const router = testRouter([
    okRoute('/one'),
    { path: '/two', trailingSlash: true, handle: ({ origin }) => proxyJson(READ_CORS)({ hit: 'two' }, origin) },
    { match: /^\/item\/([^/]+)$/, label: '/item/:id', handle: ({ origin, params }) => proxyJson(READ_CORS)({ item: params[0] }, origin) },
    { startsWith: '/fam', handle: ({ origin }) => proxyJson(READ_CORS)({ hit: 'family' }, origin) },
  ]);

  it('returns null for paths outside its prefix', () => {
    expect(router.handle(req('GET', 'https://a.test/api/other'), ORIGIN, '/api/other')).toBeNull();
    expect(router.handle(req('GET', 'https://a.test/api'), ORIGIN, '/api')).toBeNull();
    // Prefix must end at a segment boundary — /api/xyz is not ours.
    expect(router.handle(req('GET', 'https://a.test/api/xyzzy'), ORIGIN, '/api/xyzzy')).toBeNull();
  });

  it('serves health at the bare prefix and /health', async () => {
    for (const p of ['/api/x', '/api/x/', '/api/x/health']) {
      const res = (await router.handle(req('GET', `https://a.test${p}`), ORIGIN, p))!;
      expect(await res.json()).toEqual({ status: 'healthy' });
    }
  });

  it('dispatches literal paths', async () => {
    const res = (await router.handle(req('GET', 'https://a.test/api/x/one'), ORIGIN, '/api/x/one'))!;
    expect(await res.json()).toEqual({ hit: '/one' });
  });

  it('tolerates a trailing slash only where declared', async () => {
    expect((await router.handle(req('GET', 'https://a.test/api/x/one/'), ORIGIN, '/api/x/one/'))!.status).toBe(404);
    const res = (await router.handle(req('GET', 'https://a.test/api/x/two/'), ORIGIN, '/api/x/two/'))!;
    expect(await res.json()).toEqual({ hit: 'two' });
  });

  it('passes regex captures through as params', async () => {
    const res = (await router.handle(req('GET', 'https://a.test/api/x/item/abc'), ORIGIN, '/api/x/item/abc'))!;
    expect(await res.json()).toEqual({ item: 'abc' });
  });

  it('matches a family fallback at and below its segment', async () => {
    for (const p of ['/api/x/fam', '/api/x/fam/deep/path']) {
      const res = (await router.handle(req('GET', `https://a.test${p}`), ORIGIN, p))!;
      expect(await res.json()).toEqual({ hit: 'family' });
    }
  });

  it('evaluates routes in order so earlier entries win', async () => {
    const ordered = testRouter([
      { match: /^\/dup\/(.+)$/, label: '/dup/:name', handle: ({ origin }) => proxyJson(READ_CORS)({ which: 'first' }, origin) },
      { startsWith: '/dup', handle: ({ origin }) => proxyJson(READ_CORS)({ which: 'second' }, origin) },
    ]);
    const res = (await ordered.handle(req('GET', 'https://a.test/api/x/dup/z'), ORIGIN, '/api/x/dup/z'))!;
    expect(await res.json()).toEqual({ which: 'first' });
  });

  it('answers OPTIONS with a bare CORS 204', async () => {
    const res = (await router.handle(req('OPTIONS', 'https://a.test/api/x/one'), ORIGIN, '/api/x/one'))!;
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('rejects non-GET methods with 405 before routing', async () => {
    const res = (await router.handle(req('POST', 'https://a.test/api/x/one'), ORIGIN, '/api/x/one'))!;
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ status: 'error', code: 'METHOD', message: 'GET required' });
  });

  it('falls back to NOT_FOUND with the extra hint', async () => {
    const res = (await router.handle(req('GET', 'https://a.test/api/x/nope'), ORIGIN, '/api/x/nope'))!;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'Unknown /api/x/nope',
      hint: 'see /api/x/health',
    });
  });
});

describe('exported allowlists', () => {
  it('on-chain exposes only the documented provider paths', () => {
    expect(onchainAllowlist()).toEqual([
      '/api/onchain/health',
      '/api/onchain/llama/protocols',
      '/api/onchain/llama/protocol/:slug',
      '/api/onchain/gecko/search/pools',
      '/api/onchain/gecko/networks/:network/pools/:address/ohlcv/:timeframe',
      '/api/onchain/gecko/*',
    ]);
  });

  it('refuses to publish a regex source as the public surface', () => {
    const unlabelled = testRouter([{ match: /^\/x\/([^/]+)$/, handle: okRoute('/x').handle }]);
    expect(() => unlabelled.allowedPaths()).toThrow(/needs a label/);
  });

  it('market exposes only the fixed venue paths', () => {
    expect(marketAllowlist()).toEqual([
      '/api/market/health',
      '/api/market/binance/klines',
      '/api/market/binance/signed/klines',
      '/api/market/binance/ticker/24hr',
      '/api/market/binance/exchangeInfo',
      '/api/market/mexc/klines',
      '/api/market/mexc/ticker/24hr',
      '/api/market/mexc/exchangeInfo',
    ]);
  });
});

describe('router wiring in the proxy planes', () => {
  it('both handlers yield null outside their prefix', () => {
    const r = req('GET', 'https://a.test/api/scripts');
    expect(handleOnchain(r, {} as never, ORIGIN, '/api/scripts')).toBeNull();
    expect(handleMarket(r, {} as never, ORIGIN, '/api/scripts')).toBeNull();
  });

  it('claim the prefix at a segment boundary, so a typo yields null not a 404', () => {
    const r = req('GET', 'https://a.test/api/onchainfoo');
    expect(handleOnchain(r, {} as never, ORIGIN, '/api/onchainfoo')).toBeNull();
    expect(handleMarket(r, {} as never, ORIGIN, '/api/marketfoo')).toBeNull();
  });

  it('an unknown path inside the prefix is a 404 envelope, not a crash', async () => {
    const onchain = (await handleOnchain(
      req('GET', 'https://a.test/api/onchain/nope'),
      {} as never,
      ORIGIN,
      '/api/onchain/nope',
    ))!;
    expect(onchain.status).toBe(404);
    expect(await onchain.json()).toMatchObject({ status: 'error', code: 'NOT_FOUND' });

    const market = (await handleMarket(
      req('GET', 'https://a.test/api/market/nope'),
      {} as never,
      ORIGIN,
      '/api/market/nope',
    ))!;
    expect(market.status).toBe(404);
    expect(await market.json()).toMatchObject({ status: 'error', code: 'NOT_FOUND' });
  });

  it('health routes report their plane', async () => {
    const o = (await handleOnchain(
      req('GET', 'https://a.test/api/onchain/health'),
      {} as never,
      ORIGIN,
      '/api/onchain/health',
    ))!;
    expect(await o.json()).toMatchObject({ service: 'axis-onchain' });

    const m = (await handleMarket(
      req('GET', 'https://a.test/api/market/health'),
      {} as never,
      ORIGIN,
      '/api/market/health',
    ))!;
    expect(await m.json()).toMatchObject({ service: 'axis-market' });
  });
});