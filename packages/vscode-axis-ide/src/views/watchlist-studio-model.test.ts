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
  WATCHLIST_MOCK_CLOSE,
  buildWatchlistSnapshot,
  encodeWatchlistStudioSnapshot,
  normalizeWatchlistSymbol,
  parseWatchlistStudioMessage,
  parseWatchlistStudioState,
  type WatchlistQuoteSource,
} from './watchlist-studio-model';

function throwOn(key: string, base?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(base ?? {}, {
    get(target, prop, receiver) {
      if (prop === key) throw new Error(String(prop));
      return Reflect.get(target, prop, receiver);
    },
  });
}

function listThrowsAt(items: unknown[], index: number): unknown[] {
  return new Proxy(items.slice(), {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < target.length; i += 1) {
            if (i === index) throw new Error('iter');
            yield target[i];
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe('normalizeWatchlistSymbol', () => {
  test('rejects non-strings and blank input', () => {
    expect(normalizeWatchlistSymbol(undefined)).toBe('');
    expect(normalizeWatchlistSymbol(null)).toBe('');
    expect(normalizeWatchlistSymbol(12)).toBe('');
    expect(normalizeWatchlistSymbol({ symbol: 'BTC' })).toBe('');
    expect(normalizeWatchlistSymbol('   ')).toBe('');
    expect(normalizeWatchlistSymbol('')).toBe('');
  });

  test('uppercases and strips whitespace', () => {
    expect(normalizeWatchlistSymbol(' btc usdt ')).toBe('BTCUSDT');
    expect(normalizeWatchlistSymbol('ETHUSDT')).toBe('ETHUSDT');
  });
});

describe('parseWatchlistStudioState', () => {
  test('rejects non-objects', () => {
    expect(parseWatchlistStudioState(undefined)).toEqual({ symbols: [], selected: null });
    expect(parseWatchlistStudioState(null)).toEqual({ symbols: [], selected: null });
    expect(parseWatchlistStudioState('BTC')).toEqual({ symbols: [], selected: null });
    expect(parseWatchlistStudioState(1)).toEqual({ symbols: [], selected: null });
    expect(parseWatchlistStudioState(['BTCUSDT'])).toEqual({ symbols: [], selected: null });
  });

  test('normalizes, dedupes, and drops a selected symbol that is not listed', () => {
    expect(
      parseWatchlistStudioState({
        symbols: [' btc usdt ', 'ETHUSDT', 'BTCUSDT', '', 12, '   '],
        selected: 'SOLUSDT',
      }),
    ).toEqual({ symbols: ['BTCUSDT', 'ETHUSDT'], selected: null });
    expect(
      parseWatchlistStudioState({
        symbols: ['ethusdt', 'BTCUSDT'],
        selected: ' eth usdt ',
      }),
    ).toEqual({ symbols: ['ETHUSDT', 'BTCUSDT'], selected: 'ETHUSDT' });
  });

  test('ignores a non-array symbols field and a blank selected', () => {
    expect(parseWatchlistStudioState({ symbols: 'BTCUSDT', selected: '' })).toEqual({
      symbols: [],
      selected: null,
    });
    expect(parseWatchlistStudioState({ symbols: ['BTCUSDT'], selected: 4 })).toEqual({
      symbols: ['BTCUSDT'],
      selected: null,
    });
  });

  test('hostile symbols getter, selected getter, and a throwing iterator', () => {
    expect(parseWatchlistStudioState(throwOn('symbols'))).toEqual({
      symbols: [],
      selected: null,
    });
    expect(
      parseWatchlistStudioState(throwOn('selected', { symbols: ['BTCUSDT'] })),
    ).toEqual({ symbols: ['BTCUSDT'], selected: null });
    expect(
      parseWatchlistStudioState({
        symbols: listThrowsAt(['BTCUSDT', 'ETHUSDT'], 0),
        selected: 'BTCUSDT',
      }),
    ).toEqual({ symbols: [], selected: null });
    expect(
      parseWatchlistStudioState({
        symbols: listThrowsAt(['BTCUSDT', 'ETHUSDT'], 1),
        selected: 'BTCUSDT',
      }),
    ).toEqual({ symbols: ['BTCUSDT'], selected: 'BTCUSDT' });
  });
});

describe('parseWatchlistStudioMessage', () => {
  test('rejects non-objects, bad types, and unknown names', () => {
    expect(parseWatchlistStudioMessage(undefined)).toEqual({ ok: false, reason: 'not-object' });
    expect(parseWatchlistStudioMessage(null)).toEqual({ ok: false, reason: 'not-object' });
    expect(parseWatchlistStudioMessage(1)).toEqual({ ok: false, reason: 'not-object' });
    expect(parseWatchlistStudioMessage('add')).toEqual({ ok: false, reason: 'not-object' });
    expect(parseWatchlistStudioMessage([])).toEqual({ ok: false, reason: 'not-object' });
    expect(parseWatchlistStudioMessage({})).toEqual({ ok: false, reason: 'bad-type' });
    expect(parseWatchlistStudioMessage({ type: 1 })).toEqual({ ok: false, reason: 'bad-type' });
    expect(parseWatchlistStudioMessage({ type: '' })).toEqual({ ok: false, reason: 'bad-type' });
    expect(parseWatchlistStudioMessage({ type: 'watchlist.' })).toEqual({
      ok: false,
      reason: 'unknown-type',
    });
    expect(parseWatchlistStudioMessage({ type: 'watchlist.nope', symbol: 'BTCUSDT' })).toEqual({
      ok: false,
      reason: 'unknown-type',
    });
    expect(parseWatchlistStudioMessage({ type: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown-type',
    });
  });

  test('parses ready, add, remove, and select with or without the prefix', () => {
    expect(parseWatchlistStudioMessage({ type: 'ready' })).toEqual({ ok: true, type: 'ready' });
    expect(parseWatchlistStudioMessage({ type: 'watchlist.ready', symbol: 'BTCUSDT' })).toEqual({
      ok: true,
      type: 'ready',
    });
    expect(parseWatchlistStudioMessage({ type: 'watchlist.add', symbol: ' btc usdt ' })).toEqual({
      ok: true,
      type: 'add',
      symbol: 'BTCUSDT',
    });
    expect(parseWatchlistStudioMessage({ type: 'add', symbol: 'ETHUSDT' })).toEqual({
      ok: true,
      type: 'add',
      symbol: 'ETHUSDT',
    });
    expect(parseWatchlistStudioMessage({ type: 'watchlist.remove', symbol: 'ethusdt' })).toEqual({
      ok: true,
      type: 'remove',
      symbol: 'ETHUSDT',
    });
    expect(parseWatchlistStudioMessage({ type: 'remove', symbol: 'SOLUSDT' })).toEqual({
      ok: true,
      type: 'remove',
      symbol: 'SOLUSDT',
    });
    expect(parseWatchlistStudioMessage({ type: 'watchlist.select', symbol: 'solusdt' })).toEqual({
      ok: true,
      type: 'select',
      symbol: 'SOLUSDT',
    });
    expect(parseWatchlistStudioMessage({ type: 'select', symbol: 'BTCUSDT' })).toEqual({
      ok: true,
      type: 'select',
      symbol: 'BTCUSDT',
    });
  });

  test('rejects an empty symbol and never throws on hostile getters', () => {
    expect(parseWatchlistStudioMessage({ type: 'watchlist.add', symbol: '   ' })).toEqual({
      ok: false,
      reason: 'empty-symbol',
    });
    expect(parseWatchlistStudioMessage({ type: 'add', symbol: 1 })).toEqual({
      ok: false,
      reason: 'empty-symbol',
    });
    expect(parseWatchlistStudioMessage(throwOn('type'))).toEqual({ ok: false, reason: 'throw' });
    expect(parseWatchlistStudioMessage(throwOn('symbol', { type: 'watchlist.add' }))).toEqual({
      ok: false,
      reason: 'throw',
    });
  });
});

describe('buildWatchlistSnapshot', () => {
  test('mock feed shows placeholder close and does not read ticks', () => {
    let reads = 0;
    const snap = buildWatchlistSnapshot(
      { symbols: ['btcusdt', 'ETHUSDT'], selected: 'ethusdt' },
      {
        mock: true,
        getQuote() {
          reads += 1;
          return { tickPrice: 9999, barClose: 1, streamState: 'open' };
        },
      },
    );
    expect(reads).toBe(0);
    expect(WATCHLIST_MOCK_CLOSE).toBe(100);
    expect(snap.placeholder).toBe(true);
    expect(snap.count).toBe(2);
    expect(snap.selected).toBe('ETHUSDT');
    expect(snap.focusSymbol).toBe('ETHUSDT');
    expect(snap.focusPriceText).toBe('100.00');
    expect(snap.rows[0]).toEqual({
      symbol: 'BTCUSDT',
      priceText: '100.00',
      selected: false,
      placeholder: true,
    });
    expect(snap.rows[1]?.selected).toBe(true);
    expect(encodeWatchlistStudioSnapshot(snap).type).toBe('watchlist.snapshot');
  });

  test('omitted quotes and mock omitted are the placeholder feed', () => {
    const omitted = buildWatchlistSnapshot({ symbols: ['BTCUSDT'], selected: null });
    expect(omitted.placeholder).toBe(true);
    expect(omitted.selected).toBeNull();
    expect(omitted.focusSymbol).toBe('BTCUSDT');
    expect(omitted.focusPriceText).toBe('100.00');
    expect(omitted.rows[0]?.placeholder).toBe(true);

    const mockOmitted = buildWatchlistSnapshot(
      { symbols: [], selected: null },
      { getQuote: () => ({ tickPrice: 5, barClose: 5, streamState: 'open' }) },
    );
    expect(mockOmitted.placeholder).toBe(true);
    expect(mockOmitted.count).toBe(0);
    expect(mockOmitted.focusSymbol).toBeNull();
    expect(mockOmitted.focusPriceText).toBe('—');
    expect(mockOmitted.rows).toEqual([]);
  });

  test('live quotes use the tick only while the stream is open', () => {
    const quotes: WatchlistQuoteSource = {
      mock: false,
      getQuote(symbol) {
        if (symbol === 'BTCUSDT') {
          return { tickPrice: 2500.25, barClose: 1, streamState: 'open' };
        }
        if (symbol === 'ETHUSDT') {
          return { tickPrice: 9999, barClose: 1.5, streamState: 'closed' };
        }
        if (symbol === 'SOLUSDT') {
          return { tickPrice: Number.NaN, barClose: 42.1, streamState: 'open' };
        }
        if (symbol === 'XRPUSDT') {
          return { tickPrice: Number.NaN, barClose: Number.NaN, streamState: 'closed' };
        }
        if (symbol === 'ADAUSDT') {
          return { tickPrice: 0.005, barClose: 1, streamState: 'open' };
        }
        return undefined;
      },
    };
    const snap = buildWatchlistSnapshot(
      {
        symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
        selected: 'ETHUSDT',
      },
      quotes,
    );
    expect(snap.placeholder).toBe(false);
    expect(snap.focusSymbol).toBe('ETHUSDT');
    expect(snap.focusPriceText).toBe('1.50');
    const bySymbol = Object.fromEntries(snap.rows.map((row) => [row.symbol, row.priceText]));
    expect(bySymbol).toEqual({
      BTCUSDT: '2500.25',
      ETHUSDT: '1.50',
      SOLUSDT: '42.10',
      XRPUSDT: '—',
      ADAUSDT: '0.005000',
      DOGEUSDT: '—',
    });
    expect(snap.rows.every((row) => row.placeholder === false)).toBe(true);
    expect(snap.rows.find((row) => row.symbol === 'ETHUSDT')?.selected).toBe(true);
    expect(snap.rows.find((row) => row.symbol === 'BTCUSDT')?.selected).toBe(false);
  });

  test('live feed without getQuote, null quotes, and hostile quote fields', () => {
    const missingFn = buildWatchlistSnapshot(
      { symbols: ['BTCUSDT'], selected: 'BTCUSDT' },
      { mock: false },
    );
    expect(missingFn.rows[0]?.priceText).toBe('—');
    expect(missingFn.placeholder).toBe(false);

    const badShapes = buildWatchlistSnapshot(
      { symbols: ['A', 'B', 'C', 'D', 'E', 'F'], selected: 'A' },
      {
        mock: false,
        getQuote(symbol) {
          if (symbol === 'A') return null;
          if (symbol === 'B') return 'nope';
          if (symbol === 'C') return [];
          if (symbol === 'D') return { tickPrice: '1', barClose: 2 };
          if (symbol === 'E') return { tickPrice: 1, barClose: '2' };
          return { tickPrice: 1, barClose: 2, streamState: 3 };
        },
      },
    );
    expect(badShapes.rows.map((row) => row.priceText)).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '1.00',
    ]);

    const thrown = buildWatchlistSnapshot(
      { symbols: ['BTCUSDT', 'ETHUSDT'], selected: null },
      {
        mock: false,
        getQuote(symbol) {
          if (symbol === 'BTCUSDT') throw new Error('feed');
          return throwOn('streamState', { tickPrice: 1, barClose: 2 });
        },
      },
    );
    expect(thrown.focusSymbol).toBe('BTCUSDT');
    expect(thrown.rows.map((row) => row.priceText)).toEqual(['—', '—']);
  });

  test('hostile quote source returns an empty placeholder snapshot', () => {
    const snap = buildWatchlistSnapshot(
      { symbols: ['BTCUSDT'], selected: 'BTCUSDT' },
      throwOn('mock') as WatchlistQuoteSource,
    );
    expect(snap).toEqual({
      count: 0,
      selected: null,
      focusSymbol: null,
      focusPriceText: '—',
      placeholder: true,
      rows: [],
    });
  });
});
