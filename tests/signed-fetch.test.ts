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
});
