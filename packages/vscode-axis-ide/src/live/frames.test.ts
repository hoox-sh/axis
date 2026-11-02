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
  normalizeLiveFrame,
  seriesKeyFromFrameId,
  toChartDeltaPayload,
  toChartFullPayload,
} from './frames';

describe('normalizeLiveFrame', () => {
  test('parses full / delta (snake + camel) / status / close', () => {
    const full = normalizeLiveFrame({
      type: 'full',
      seq: 1,
      id: 'series:binance|spot|BTC/USDT|1m',
      payload: {
        bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }],
        plots: { a: [1] },
      },
    });
    expect(full).toEqual({
      kind: 'full',
      seq: 1,
      bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }],
      plots: { a: [1] },
      seriesKey: 'binance|spot|BTC/USDT|1m',
    });
    expect(toChartFullPayload(full as Extract<typeof full, { kind: 'full' }>)).toEqual({
      bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }],
      plots: { a: [1] },
      seq: 1,
    });

    const delta = normalizeLiveFrame({
      type: 'delta',
      seq: 2,
      payload: {
        base_index: 0,
        tail: [{ time: 2, open: 2, high: 3, low: 1, close: 2.5 }],
      },
    });
    expect(delta.kind).toBe('delta');
    if (delta.kind === 'delta') {
      expect(delta.baseIndex).toBe(0);
      expect(toChartDeltaPayload(delta)).toEqual({
        baseIndex: 0,
        tail: [{ time: 2, open: 2, high: 3, low: 1, close: 2.5 }],
        seq: 2,
      });
    }

    const tip = normalizeLiveFrame({
      kind: 'delta',
      seq: 3,
      baseIndex: 1,
      bars: [{ t: 3, o: 1, h: 1, l: 1, c: 1 }],
      plots: [[9]],
    });
    expect(tip.kind).toBe('delta');
    if (tip.kind === 'delta') {
      expect(tip.baseIndex).toBe(1);
      expect(tip.tail).toEqual([{ t: 3, o: 1, h: 1, l: 1, c: 1 }]);
      expect(toChartDeltaPayload(tip).plots).toEqual([[9]]);
    }

    expect(normalizeLiveFrame({ type: 'status', status: 'live' })).toEqual({
      kind: 'status',
      status: 'live',
    });

    const close = normalizeLiveFrame({
      type: 'close',
      seq: 4,
      payload: {
        time: 100,
        ohlcv: { open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 },
      },
    });
    expect(close).toEqual({
      kind: 'close',
      seq: 4,
      bar: { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9 },
      seriesKey: undefined,
    });
  });

  test('rejects garbage and incomplete frames', () => {
    expect(normalizeLiveFrame(null).kind).toBe('unknown');
    expect(normalizeLiveFrame('x').kind).toBe('unknown');
    expect(normalizeLiveFrame({ type: 'full' }).kind).toBe('unknown');
    expect(normalizeLiveFrame({ type: 'delta', seq: 1 }).kind).toBe('unknown');
    expect(normalizeLiveFrame({ type: 'delta', seq: 1, base_index: 0 }).kind).toBe(
      'unknown',
    );
    expect(normalizeLiveFrame({ type: 'nope', seq: 1 }).kind).toBe('unknown');
    expect(
      normalizeLiveFrame({
        type: 'close',
        payload: { time: 1, ohlcv: { open: 1 } },
      }).kind,
    ).toBe('close');
    const badClose = normalizeLiveFrame({
      type: 'close',
      payload: { time: 1, ohlcv: { open: 1 } },
    });
    expect(badClose.kind === 'close' && badClose.bar).toBe(null);
  });

  test('seriesKeyFromFrameId strips series: prefix', () => {
    expect(seriesKeyFromFrameId('series:binance|spot|BTC/USDT|1m')).toBe(
      'binance|spot|BTC/USDT|1m',
    );
    expect(seriesKeyFromFrameId('binance|spot|ETH/USDT|5m')).toBe(
      'binance|spot|ETH/USDT|5m',
    );
    expect(seriesKeyFromFrameId('series:')).toBeUndefined();
    expect(seriesKeyFromFrameId('plain')).toBeUndefined();
    expect(seriesKeyFromFrameId(1)).toBeUndefined();
  });

  test('hostile getters do not throw', () => {
    const hostile = {
      get type() {
        throw new Error('boom');
      },
    };
    expect(normalizeLiveFrame(hostile).kind).toBe('unknown');
  });

  test('status from top-level; close ohlcv top-level or body OHLC', () => {
    expect(
      normalizeLiveFrame({ type: 'status', status: 'calculating', payload: {} }),
    ).toEqual({ kind: 'status', status: 'calculating' });
    expect(normalizeLiveFrame({ type: 'status', payload: {} })).toEqual({
      kind: 'status',
      status: '',
    });

    // payload without ohlcv → fall through to raw.ohlcv
    const rawOhlcv = normalizeLiveFrame({
      type: 'close',
      ohlcv: { o: 1, h: 2, l: 0.5, c: 1.5, v: 4 },
      payload: { time: 50 },
    });
    expect(rawOhlcv.kind).toBe('close');
    if (rawOhlcv.kind === 'close') {
      expect(rawOhlcv.bar).toEqual({
        time: 50,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 4,
      });
    }

    // no ohlcv object → OHLC fields on body
    const bodyOhlc = normalizeLiveFrame({
      type: 'close',
      payload: { time: 60, open: 1, high: 2, low: 0.5, close: 1.2 },
    });
    expect(bodyOhlc.kind).toBe('close');
    if (bodyOhlc.kind === 'close') {
      expect(bodyOhlc.bar).toEqual({
        time: 60,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.2,
      });
    }
  });
});
