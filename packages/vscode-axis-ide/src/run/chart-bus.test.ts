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

import { afterEach, describe, expect, test } from 'bun:test';
import {
  getLastChartFull,
  notifyChart,
  resetChartBusForTests,
  subscribeChartNotify,
  type ChartNotifyMessage,
} from './chart-bus';

afterEach(() => {
  resetChartBusForTests();
});

describe('chart-bus', () => {
  test('fans out to subscribers and respects dispose', () => {
    const seen: ChartNotifyMessage[] = [];
    const sub = subscribeChartNotify((m) => {
      seen.push(m);
    });
    notifyChart({
      type: 'host.run.status',
      payload: { epoch: 1, state: 'running' },
      seriesKey: 'a|b|C|1m',
    });
    expect(seen).toHaveLength(1);
    sub.dispose();
    notifyChart({
      type: 'host.run.status',
      payload: { epoch: 2, state: 'ok' },
    });
    expect(seen).toHaveLength(1);
  });

  test('swallows listener errors', () => {
    subscribeChartNotify(() => {
      throw new Error('boom');
    });
    expect(() =>
      notifyChart({
        type: 'chart.full',
        payload: { bars: [], seq: 1 },
        seriesKey: 'x|y|Z|1m',
      }),
    ).not.toThrow();
  });

  test('reset clears listeners and last-full cache', () => {
    const seen: ChartNotifyMessage[] = [];
    subscribeChartNotify((m) => seen.push(m));
    notifyChart({
      type: 'chart.full',
      payload: { bars: [{ time: 1 }], seq: 2 },
      seriesKey: 'binance|spot|BTC/USDT|1m',
    });
    expect(getLastChartFull('binance|spot|BTC/USDT|1m')?.payload.seq).toBe(2);
    resetChartBusForTests();
    notifyChart({
      type: 'host.run.status',
      payload: { epoch: 1, state: 'ok' },
    });
    expect(seen).toHaveLength(1); // only the chart.full before reset
    expect(getLastChartFull('binance|spot|BTC/USDT|1m')).toBeUndefined();
  });

  test('stores last chart.full per seriesKey for replay', () => {
    notifyChart({
      type: 'chart.full',
      payload: { bars: [{ time: 1 }], seq: 2 },
      seriesKey: 'a|b|C|1m',
    });
    notifyChart({
      type: 'chart.full',
      payload: { bars: [{ time: 9 }], seq: 3 },
      seriesKey: 'a|b|C|1m',
    });
    notifyChart({
      type: 'chart.full',
      payload: { bars: [{ time: 5 }], seq: 4 },
      seriesKey: 'x|y|Z|5m',
    });
    expect(getLastChartFull('a|b|C|1m')?.payload.seq).toBe(3);
    expect(getLastChartFull('a|b|C|1m')?.payload.bars).toEqual([{ time: 9 }]);
    expect(getLastChartFull('x|y|Z|5m')?.payload.seq).toBe(4);
    expect(getLastChartFull('missing')).toBeUndefined();
    expect(getLastChartFull('')).toBeUndefined();
  });

  test('fans out chart.delta without retaining for replay', () => {
    const seen: ChartNotifyMessage[] = [];
    subscribeChartNotify((m) => seen.push(m));
    notifyChart({
      type: 'chart.delta',
      payload: { baseIndex: 1, tail: [{ time: 2 }], seq: 3 },
      seriesKey: 'a|b|C|1m',
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe('chart.delta');
    expect(getLastChartFull('a|b|C|1m')).toBeUndefined();
  });
});
