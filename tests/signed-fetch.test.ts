/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import './setup';
import { describe, expect, it, afterEach } from 'bun:test';
import { putCredential, clearCredentials } from '../src/data/credentials';
import { fetchSignedJson, hasSignedCreds } from '../src/data/signed-fetch';
import { fetchBinanceJson } from '../src/data/binance-http';
import { mockFetch, jsonResponse } from './helpers/mock-fetch';

afterEach(() => {
  clearCredentials();
});

describe('signed-fetch', () => {
  it('hasSignedCreds is false until vault put', () => {
    expect(hasSignedCreds('binance')).toBe(false);
    putCredential({ venue: 'binance', apiKey: 'k', secret: 's' });
    expect(hasSignedCreds('binance')).toBe(true);
  });

  it('fetchSignedJson HMAC-fetches Binance without putting secret in the URL', async () => {
    putCredential({ venue: 'binance', apiKey: 'mk', secret: 'supersecret-value' });
    let seen = '';
    const restore = mockFetch(async (input) => {
      seen = String(input);
      expect(seen).not.toContain('supersecret-value');
      expect(seen).toContain('signature=');
      expect(seen).toContain('timestamp=');
      return jsonResponse([[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']]);
    });
    try {
      const data = await fetchSignedJson({
        venue: 'binance',
        path: '/api/v3/klines',
        query: { symbol: 'BTCUSDT', interval: '1d', limit: 2 },
        skipWorkerProxy: true,
      });
      expect(Array.isArray(data)).toBe(true);
    } finally {
      restore();
    }
  });

  it('fetchBinanceJson uses vault signed path for klines', async () => {
    putCredential({ venue: 'binance', apiKey: 'mk', secret: 's3cret' });
    let seen = '';
    const restore = mockFetch(async (input) => {
      seen = String(input);
      expect(seen).not.toContain('s3cret');
      return jsonResponse([[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']]);
    });
    try {
      const data = await fetchBinanceJson({
        path: 'klines',
        query: 'symbol=BTCUSDT&interval=1d&limit=2',
        skipWorkerProxy: true,
      });
      expect(Array.isArray(data)).toBe(true);
      expect(seen).toContain('signature=');
    } finally {
      restore();
    }
  });

  it('fetchBinanceJson stays public when skipSigned', async () => {
    putCredential({ venue: 'binance', apiKey: 'mk', secret: 's3cret' });
    let seen = '';
    const restore = mockFetch(async (input) => {
      seen = String(input);
      return jsonResponse([[1_700_000_000_000, '1', '2', '0.5', '1.5', '10']]);
    });
    try {
      await fetchBinanceJson({
        path: 'klines',
        query: 'symbol=BTCUSDT&interval=1d',
        skipSigned: true,
        skipWorkerProxy: true,
      });
      expect(seen).not.toContain('signature=');
    } finally {
      restore();
    }
  });

  it('throws when vault has no credentials', async () => {
    let threw = false;
    try {
      await fetchSignedJson({ venue: 'binance', path: '/api/v3/klines' });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('no API key');
    }
    expect(threw).toBe(true);
  });

  it('hasSignedCreds is false when secret is missing', () => {
    putCredential({ venue: 'coinbase', apiKey: 'k', secret: '' });
    expect(hasSignedCreds('coinbase')).toBe(false);
  });

  it('throws signed HTTP on 401 without worker fallback', async () => {
    // coinbase secrets are base64-decoded per Exchange auth
    putCredential({ venue: 'coinbase', apiKey: 'k', secret: 'c2VjcmV0' });
    const restore = mockFetch(async () => new Response('{}', { status: 401 }));
    try {
      let threw = false;
      try {
        await fetchSignedJson({ venue: 'coinbase', path: '/x', skipWorkerProxy: true });
      } catch (e) {
        threw = true;
        expect(String(e)).toContain('401');
      }
      expect(threw).toBe(true);
    } finally {
      restore();
    }
  });

  it('falls back to worker proxy for binance klines after CORS failure', async () => {
    putCredential({ venue: 'binance', apiKey: 'mk', secret: 's3cret' });
    let calls = 0;
    let workerUrl = '';
    const restore = mockFetch(async (input) => {
      calls += 1;
      if (calls === 1) throw new Error('CORS blocked');
      workerUrl = String(input);
      expect(workerUrl).toContain('/api/market/binance/signed/klines');
      expect(workerUrl).toContain('symbol=BTCUSDT');
      return jsonResponse([{ ok: true }]);
    });
    try {
      const data = await fetchSignedJson({
        venue: 'binance',
        path: '/api/v3/klines',
        query: { symbol: 'BTCUSDT', empty: '', skip: undefined },
      });
      expect(calls).toBe(2);
      expect(JSON.stringify(data)).toContain('ok');
    } finally {
      restore();
    }
  });

  it('throws worker HTTP error when proxy is non-ok', async () => {
    putCredential({ venue: 'binance', apiKey: 'mk', secret: 's3cret' });
    let calls = 0;
    const restore = mockFetch(async () => {
      calls += 1;
      if (calls === 1) throw new Error('CORS blocked');
      return new Response('{}', { status: 502 });
    });
    try {
      let threw = false;
      try {
        await fetchSignedJson({ venue: 'binance', path: '/api/v3/klines' });
      } catch (e) {
        threw = true;
        expect(String(e)).toContain('502');
      }
      expect(threw).toBe(true);
    } finally {
      restore();
    }
  });

  it('throws signed fetch failed when no worker path applies', async () => {
    putCredential({ venue: 'coinbase', apiKey: 'k', secret: 'c2VjcmV0' });
    const restore = mockFetch(async () => {
      throw new Error('offline');
    });
    try {
      let threw = false;
      try {
        await fetchSignedJson({ venue: 'coinbase', path: '/x' });
      } catch (e) {
        threw = true;
        expect(String(e)).toContain('signed fetch failed');
      }
      expect(threw).toBe(true);
    } finally {
      restore();
    }
  });

  it('rethrows abort errors instead of falling back', async () => {
    putCredential({ venue: 'binance', apiKey: 'mk', secret: 's3cret' });
    const ctl = new AbortController();
    ctl.abort();
    const restore = mockFetch(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    try {
      let threw = false;
      try {
        await fetchSignedJson({
          venue: 'binance',
          path: '/api/v3/klines',
          signal: ctl.signal,
          skipWorkerProxy: true,
        });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    } finally {
      restore();
    }
  });
});
