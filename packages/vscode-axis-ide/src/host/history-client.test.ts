// Copyright (C) 2026 jango_blockchained
//
// This file is part of AXIS IDE (hoox-sh.axis-ide).
//
// AXIS IDE is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, version 3 of the License only.
//
// AXIS IDE is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with AXIS IDE.  If not, see <https://www.gnu.org/licenses/>.
//
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_DATAFEED_URL,
  REMOTE_DATAFEED_DENIED,
  checkDatafeedUrl,
  fetchHistorical,
  mapDatafeedBar,
  mapDatafeedBars,
  type HistoryFetchLike,
} from './history-client';

function jsonResponse(body: unknown, status = 200): Awaited<ReturnType<HistoryFetchLike>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe('history-client', () => {
  test('checkDatafeedUrl defaults to loopback :5003', () => {
    const r = checkDatafeedUrl('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endpoint).toBe(DEFAULT_DATAFEED_URL);
  });

  test('checkDatafeedUrl denies remote without allowRemote', () => {
    const r = checkDatafeedUrl('https://feed.example.com');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(REMOTE_DATAFEED_DENIED);
  });

  test('mapDatafeedBar normalizes seconds and rejects bad rows', () => {
    expect(
      mapDatafeedBar({
        time: 1_700_000_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
      }),
    ).toEqual({
      time: 1_700_000_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    });
    expect(
      mapDatafeedBar({
        time: 1_700_000_000_000,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 0,
      })?.time,
    ).toBe(1_700_000_000);
    expect(mapDatafeedBar(null)).toBeNull();
    expect(mapDatafeedBar({ time: 'x', open: 1, high: 1, low: 1, close: 1, volume: 1 })).toBeNull();
  });

  test('fetchHistorical success maps bars and pair-forms symbol', async () => {
    const seen: string[] = [];
    const fetchImpl: HistoryFetchLike = async (input) => {
      seen.push(String(input));
      return jsonResponse([
        {
          time: 1_700_000_000,
          open: 10,
          high: 12,
          low: 9,
          close: 11,
          volume: 100,
        },
      ]);
    };
    const result = await fetchHistorical({
      exchange: 'Binance',
      symbol: 'BTCUSDT',
      timeframe: '1m',
      limit: 50,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bars).toHaveLength(1);
    expect(result.bars[0]?.close).toBe(11);
    expect(seen[0]).toContain(`${DEFAULT_DATAFEED_URL}/datafeed/ohlcv?`);
    expect(seen[0]).toContain('exchange=binance');
    expect(seen[0]).toContain(encodeURIComponent('BTC/USDT'));
    expect(seen[0]).toContain('timeframe=1m');
    expect(seen[0]).toContain('limit=50');
  });

  test('fetchHistorical HTTP failure path', async () => {
    const fetchImpl: HistoryFetchLike = async () =>
      jsonResponse({ error: 'exchange down' }, 502);
    const result = await fetchHistorical({
      exchange: 'binance',
      symbol: 'ETH/USDT',
      timeframe: '5m',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/HTTP 502/);
    expect(result.error).toMatch(/exchange down/);
  });

  test('fetchHistorical network failure path', async () => {
    const fetchImpl: HistoryFetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await fetchHistorical({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ECONNREFUSED/);
    expect(result.error).toMatch(/axis-datafeed/);
  });

  test('fetchHistorical rejects missing exchange/symbol', async () => {
    const result = await fetchHistorical({
      exchange: '',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      fetchImpl: async () => jsonResponse([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exchange/i);
  });

  test('fetchHistorical denies remote baseUrl without allowRemote', async () => {
    let called = false;
    const result = await fetchHistorical({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      baseUrl: 'https://remote.example.com',
      fetchImpl: async () => {
        called = true;
        return jsonResponse([]);
      },
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(REMOTE_DATAFEED_DENIED);
  });

  test('mapDatafeedBars skips invalid entries', () => {
    expect(
      mapDatafeedBars([
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { bad: true },
        null,
      ]),
    ).toHaveLength(1);
  });

  test('mapDatafeedBar rejects non-positive time and catches hostile rows', () => {
    expect(
      mapDatafeedBar({
        time: 0,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
      }),
    ).toBeNull();
    const hostile = {
      get time() {
        throw new Error('boom');
      },
    };
    expect(mapDatafeedBar(hostile)).toBeNull();
  });

  test('mapDatafeedBars returns empty for non-arrays', () => {
    expect(mapDatafeedBars({ time: 1 })).toEqual([]);
    expect(mapDatafeedBars(null)).toEqual([]);
  });

  test('fetchHistorical rejects missing symbol and accepts since', async () => {
    const missing = await fetchHistorical({
      exchange: 'binance',
      symbol: '   ',
      timeframe: '1m',
      fetchImpl: async () => jsonResponse([]),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/symbol/i);

    const seen: string[] = [];
    const ok = await fetchHistorical({
      exchange: 'binance',
      symbol: 'ETH/USDT',
      timeframe: '1m',
      since: 1_700_000_000_000,
      limit: -5,
      fetchImpl: async (input) => {
        seen.push(String(input));
        return jsonResponse([]);
      },
    });
    expect(ok.ok).toBe(true);
    expect(seen[0]).toContain('since=1700000000000');
    expect(seen[0]).not.toContain('limit=');
  });

  test('fetchHistorical aborted signal and non-JSON bodies', async () => {
    const ac = new AbortController();
    ac.abort();
    const aborted = await fetchHistorical({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      signal: ac.signal,
      fetchImpl: async () => {
        throw new Error('aborted');
      },
    });
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error).toMatch(/aborted/i);

    const badJson = await fetchHistorical({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => 'not-json',
      }),
    });
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.error).toMatch(/non-JSON/i);

    const httpRaw = await fetchHistorical({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        text: async () => 'plain failure',
      }),
    });
    expect(httpRaw.ok).toBe(false);
    if (!httpRaw.ok) expect(httpRaw.error).toMatch(/plain failure/);

    const objErr = await fetchHistorical({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      timeframe: '1m',
      fetchImpl: async () => jsonResponse({ error: 'venue denied' }),
    });
    expect(objErr.ok).toBe(false);
    if (!objErr.ok) expect(objErr.error).toMatch(/venue denied/);
  });

  test('fetchHistorical outer catch on hostile exchange', async () => {
    const hostile = {
      toString() {
        throw new Error('x');
      },
    };
    const result = await fetchHistorical({
      exchange: hostile as unknown as string,
      symbol: 'BTC/USDT',
      timeframe: '1m',
      fetchImpl: async () => jsonResponse([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unexpected|x/i);
  });
});
