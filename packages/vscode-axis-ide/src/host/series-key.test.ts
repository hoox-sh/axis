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
  FALLBACK_PAIR_CATALOG,
  buildSeriesKey,
  currentSeriesKey,
  pairFormSymbol,
  parseSeriesKey,
} from './series-key';

describe('series-key', () => {
  test('pairFormSymbol maps load form via fallback catalog', () => {
    expect(pairFormSymbol('BTCUSDT')).toBe('BTC/USDT');
    expect(pairFormSymbol('ethusdt')).toBe('ETH/USDT');
    expect(pairFormSymbol('BTC/USDT')).toBe('BTC/USDT');
    expect(pairFormSymbol('UNKNOWNXYZ')).toBe('UNKNOWNXYZ');
  });

  test('pairFormSymbol honors explicit catalog over fallback', () => {
    const catalog = [{ symbol: 'FOOBAR', display: 'FOO/BAR' }];
    expect(pairFormSymbol('FOOBAR', catalog)).toBe('FOO/BAR');
    expect(pairFormSymbol('BTCUSDT', catalog)).toBe('BTCUSDT');
  });

  test('buildSeriesKey is exchange|market|SYMBOL|interval with pair-form', () => {
    expect(
      buildSeriesKey({
        exchange: 'Binance',
        market: 'SPOT',
        symbol: 'btc/usdt',
        interval: '1m',
      }),
    ).toBe('binance|spot|BTC/USDT|1m');
    expect(
      buildSeriesKey({
        exchange: 'binance',
        symbol: 'BTCUSDT',
        interval: '5m',
      }),
    ).toBe('binance|spot|BTC/USDT|5m');
  });

  test('currentSeriesKey defaults market to spot', () => {
    expect(
      currentSeriesKey({
        exchange: 'Binance',
        symbol: 'ETHUSDT',
        interval: '1h',
        catalog: FALLBACK_PAIR_CATALOG,
      }),
    ).toBe('binance|spot|ETH/USDT|1h');
  });

  test('parseSeriesKey splits canonical key', () => {
    expect(parseSeriesKey('binance|spot|BTC/USDT|1m')).toEqual({
      exchange: 'binance',
      market: 'spot',
      symbol: 'BTC/USDT',
      interval: '1m',
    });
    expect(parseSeriesKey('')).toEqual({
      exchange: '',
      market: 'spot',
      symbol: '',
      interval: '1m',
    });
  });

  test('pairFormSymbol / buildSeriesKey / parseSeriesKey catch hostile inputs', () => {
    const boom = {
      toString() {
        throw new Error('boom');
      },
    };
    expect(pairFormSymbol(boom as unknown as string)).toBe('');
    expect(
      buildSeriesKey({
        exchange: boom as unknown as string,
        symbol: 'BTC/USDT',
        interval: '1m',
      }),
    ).toBe('|| |1m');
    expect(parseSeriesKey(boom as unknown as string)).toEqual({
      exchange: '',
      market: 'spot',
      symbol: '',
      interval: '1m',
    });
  });
});
