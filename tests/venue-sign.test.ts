// Copyright (C) 2024-2026 jango_blockchained
//
// This file is part of pynescript.
//
// pynescript is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// pynescript is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with pynescript.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import './setup';
import { describe, expect, it } from 'bun:test';
import {
  okxHeaders,
  signVenueRequest,
  type SignInput,
  type VenueId,
} from '../src/data/venues';

const TS = 1_700_000_000_000;
const SECRET = 'testsecret';
const KEY = 'testkey';
const PASS = 'testpass';

const creds = {
  method: 'GET' as const,
  apiKey: KEY,
  secret: SECRET,
  passphrase: PASS,
  timestampMs: TS,
};

function assertNoSecretLeak(url: string, headers: Record<string, string>): void {
  expect(url.startsWith('https://')).toBe(true);
  expect(url.includes(SECRET)).toBe(false);
  for (const value of Object.values(headers)) {
    expect(value).not.toBe(SECRET);
    expect(value.includes(SECRET)).toBe(false);
  }
}

describe('signVenueRequest binance', () => {
  it('HMAC-SHA256 hex signature and X-MBX-APIKEY', async () => {
    const signed = await signVenueRequest('binance', {
      ...creds,
      path: '/api/v3/klines',
      query: { symbol: 'BTCUSDT', interval: '1d' },
    });
    expect(signed.headers['X-MBX-APIKEY']).toBe(KEY);
    const url = new URL(signed.url);
    expect(url.origin).toBe('https://api.binance.com');
    expect(url.pathname).toBe('/api/v3/klines');
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(url.searchParams.get('interval')).toBe('1d');
    expect(url.searchParams.get('timestamp')).toBe(String(TS));
    const signature = url.searchParams.get('signature');
    expect(signature).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(signature ?? '')).toBe(true);
    assertNoSecretLeak(signed.url, signed.headers);
  });
});

describe('signVenueRequest okx', () => {
  it('builds OK-ACCESS headers for private GET', async () => {
    const input: SignInput = {
      ...creds,
      path: '/api/v5/account/balance',
      query: { ccy: 'BTC' },
    };
    const signed = await signVenueRequest('okx', input);
    expect(signed.url).toBe('https://www.okx.com/api/v5/account/balance?ccy=BTC');
    expect(signed.headers['OK-ACCESS-KEY']).toBe(KEY);
    expect(signed.headers['OK-ACCESS-PASSPHRASE']).toBe(PASS);
    expect(signed.headers['OK-ACCESS-TIMESTAMP']).toBe(new Date(TS).toISOString());
    expect(signed.headers['OK-ACCESS-SIGN']).toBeTruthy();
    expect(signed.headers['OK-ACCESS-SIGN']).not.toContain(SECRET);
    assertNoSecretLeak(signed.url, signed.headers);
  });

  it('okxHeaders matches signOkx for the same prehash', async () => {
    const headers = await okxHeaders(
      'GET',
      '/api/v5/account/balance?ccy=BTC',
      '',
      creds,
    );
    const signed = await signVenueRequest('okx', {
      ...creds,
      path: '/api/v5/account/balance',
      query: { ccy: 'BTC' },
    });
    expect(headers).toEqual(signed.headers);
  });
});

describe('signVenueRequest bybit', () => {
  it('sets v5 HMAC headers', async () => {
    const signed = await signVenueRequest('bybit', {
      ...creds,
      path: '/v5/market/kline',
      query: { category: 'spot', symbol: 'BTCUSDT', interval: 'D' },
    });
    expect(signed.url.startsWith('https://api.bybit.com/v5/market/kline?')).toBe(true);
    expect(signed.url).toContain('symbol=BTCUSDT');
    expect(signed.headers['X-BAPI-API-KEY']).toBe(KEY);
    expect(signed.headers['X-BAPI-TIMESTAMP']).toBe(String(TS));
    expect(signed.headers['X-BAPI-RECV-WINDOW']).toBe('5000');
    expect(signed.headers['X-BAPI-SIGN']).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(signed.headers['X-BAPI-SIGN'] ?? '')).toBe(true);
    assertNoSecretLeak(signed.url, signed.headers);
  });
});

describe('signVenueRequest coinbase', () => {
  it('sets CB-ACCESS headers', async () => {
    const signed = await signVenueRequest('coinbase', {
      ...creds,
      path: '/products/BTC-USD/candles',
      query: { granularity: 86400 },
    });
    expect(signed.url).toBe(
      'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400',
    );
    expect(signed.headers['CB-ACCESS-KEY']).toBe(KEY);
    expect(signed.headers['CB-ACCESS-PASSPHRASE']).toBe(PASS);
    expect(signed.headers['CB-ACCESS-TIMESTAMP']).toBe(String(Math.floor(TS / 1000)));
    expect(signed.headers['CB-ACCESS-SIGN']).toBeTruthy();
    assertNoSecretLeak(signed.url, signed.headers);
  });
});

describe('signVenueRequest kraken', () => {
  it('sets API-Key and API-Sign', async () => {
    const signed = await signVenueRequest('kraken', {
      ...creds,
      path: '/0/public/OHLC',
      query: { pair: 'XBTUSD', interval: 1440 },
    });
    expect(signed.url.startsWith('https://api.kraken.com/0/public/OHLC?')).toBe(true);
    expect(signed.url).toContain('pair=XBTUSD');
    expect(signed.url).toContain(`nonce=${TS}`);
    expect(signed.headers['API-Key']).toBe(KEY);
    expect(signed.headers['API-Sign']).toBeTruthy();
    assertNoSecretLeak(signed.url, signed.headers);
  });
});

describe('signVenueRequest all venues', () => {
  const cases: Array<{ venue: VenueId; path: string; query: SignInput['query'] }> = [
    { venue: 'binance', path: '/api/v3/klines', query: { symbol: 'BTCUSDT', interval: '1d' } },
    { venue: 'okx', path: '/api/v5/market/candles', query: { instId: 'BTC-USDT', bar: '1D' } },
    { venue: 'bybit', path: '/v5/market/kline', query: { category: 'spot', symbol: 'BTCUSDT' } },
    { venue: 'coinbase', path: '/products/BTC-USD/candles', query: { granularity: 86400 } },
    { venue: 'kraken', path: '/0/public/OHLC', query: { pair: 'XBTUSD' } },
  ];

  for (const { venue, path, query } of cases) {
    it(`${venue} url is https and secret stays off the wire`, async () => {
      const signed = await signVenueRequest(venue, { ...creds, path, query });
      expect(Object.keys(signed.headers).length).toBeGreaterThan(0);
      assertNoSecretLeak(signed.url, signed.headers);
    });
  }
});
