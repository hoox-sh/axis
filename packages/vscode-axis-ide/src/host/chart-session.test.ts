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
import { defaultChartDocument } from '../editors/chart-document';
import { HOST_TO_VIEW, decode, encode } from '../protocol';
import {
  buildChartSession,
  buildSeriesKey,
  resolveMockBarCount,
} from './chart-session';
import { MOCK_BARS_CAP, intervalToSeconds } from './mock-bars';

describe('chart session', () => {
  test('buildSeriesKey normalizes exchange|market|SYMBOL|interval (pair-form)', () => {
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
        market: 'spot',
        symbol: 'BTCUSDT',
        interval: '5m',
      }),
    ).toBe('binance|spot|BTC/USDT|5m');
    expect(
      buildSeriesKey({
        exchange: 'coinbase',
        market: 'spot',
        symbol: 'ethusd',
        interval: '5m',
      }),
    ).toBe('coinbase|spot|ETHUSD|5m');
  });

  test('resolveMockBarCount: positive doc → setting → default', () => {
    expect(resolveMockBarCount(50, 1500)).toBe(50);
    expect(resolveMockBarCount(0, 80)).toBe(80);
    expect(resolveMockBarCount(-1, 120)).toBe(120);
    expect(resolveMockBarCount(0, undefined)).toBe(1500);
    expect(resolveMockBarCount(MOCK_BARS_CAP + 50, 80)).toBe(MOCK_BARS_CAP);
  });

  test('buildChartSession honors historyBarsSetting when doc count is unset', () => {
    const doc = { ...defaultChartDocument(), historyBars: 0, symbol: 'BTC/USDT', exchange: 'binance' };
    const session = buildChartSession({
      doc,
      useMockBars: true,
      historyBarsSetting: 75,
    });
    expect(session.bars).toHaveLength(75);
    expect(session.full.bars).toHaveLength(75);
  });

  test('buildChartSession emits init + full with protocol-valid payload', () => {
    const doc = {
      ...defaultChartDocument(),
      symbol: 'ETH/USDT',
      exchange: 'binance',
      market: 'spot',
      interval: '1m',
      historyBars: 60,
    };
    const session = buildChartSession({ doc, useMockBars: true, seq: 1 });
    expect(session.seriesKey).toBe('binance|spot|ETH/USDT|1m');
    expect(session.init.seriesKey).toBe(session.seriesKey);
    expect(session.bars).toHaveLength(60);
    expect(session.full.seq).toBe(1);

    const env = encode(HOST_TO_VIEW.ChartFull, session.full);
    const decoded = decode(env);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.envelope.type).toBe(HOST_TO_VIEW.ChartFull);
      const payload = decoded.envelope.payload as {
        bars: Array<{
          time: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>;
        seq: number;
      };
      expect(payload.seq).toBe(1);
      expect(payload.bars).toHaveLength(60);
      expect(session.bars).toHaveLength(60);
      const bar = payload.bars[0];
      const sessionBar = session.bars[0];
      expect(bar).toBeDefined();
      expect(sessionBar).toBeDefined();
      if (!bar || !sessionBar) return;
      expect(bar).toEqual(sessionBar);
      expect(Object.keys(bar).sort()).toEqual([
        'close',
        'high',
        'low',
        'open',
        'time',
        'volume',
      ]);
    }
  });

  test('useMockBars false posts empty chart.full to clear series', () => {
    const session = buildChartSession({
      doc: defaultChartDocument(),
      useMockBars: false,
      seq: 3,
    });
    expect(session.bars).toEqual([]);
    expect(session.full).toEqual({ bars: [], drawings: [], seq: 3 });
    expect(session.init.drawings).toEqual([]);
  });

  test('mock bars use unix-second steps matching interval', () => {
    const doc = {
      ...defaultChartDocument(),
      interval: '5m',
      historyBars: 10,
      symbol: 'BTC/USDT',
      exchange: 'binance',
    };
    const session = buildChartSession({ doc });
    const step = intervalToSeconds('5m');
    expect(step).toBe(300);
    for (let i = 1; i < session.bars.length; i++) {
      const cur = session.bars[i];
      const prev = session.bars[i - 1];
      expect(cur).toBeDefined();
      expect(prev).toBeDefined();
      if (!cur || !prev) continue;
      expect(cur.time - prev.time).toBe(step);
    }
  });
});
