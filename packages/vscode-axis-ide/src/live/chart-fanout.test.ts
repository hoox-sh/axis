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
  notifyChart,
  resetChartBusForTests,
  subscribeChartNotify,
  type ChartNotifyMessage,
} from '../run/chart-bus';
import { createLiveChartFanout } from './chart-fanout';
import { createLiveResumeStub } from './resume';

const KEY = 'binance|spot|BTC/USDT|1m';

const bar = (t: number) => ({
  time: t,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 1,
});

afterEach(() => {
  resetChartBusForTests();
});

describe('createLiveChartFanout', () => {
  test('full then continuous delta notify chart-bus', () => {
    const seen: ChartNotifyMessage[] = [];
    subscribeChartNotify((m) => seen.push(m));
    const fanout = createLiveChartFanout({ seriesKey: KEY });

    fanout.onFrame({
      type: 'full',
      seq: 1,
      id: `series:${KEY}`,
      payload: { bars: [bar(1), bar(2)] },
    });
    fanout.onFrame({
      type: 'delta',
      seq: 2,
      id: `series:${KEY}`,
      payload: { base_index: 1, tail: [bar(2)] },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]?.type).toBe('chart.full');
    expect(seen[1]?.type).toBe('chart.delta');
    if (seen[1]?.type === 'chart.delta') {
      expect(seen[1].payload).toEqual({
        baseIndex: 1,
        tail: [bar(2)],
        seq: 2,
      });
      expect(seen[1].seriesKey).toBe(KEY);
    }
    expect(fanout.lastSeq()).toBe(2);
    expect(fanout.barCount()).toBe(2);
  });

  test('seq gap triggers resume stub and skips notify', async () => {
    const seen: ChartNotifyMessage[] = [];
    const resumes: string[] = [];
    subscribeChartNotify((m) => seen.push(m));
    const resume = createLiveResumeStub({
      remintOnResume: false,
      markDegraded: (r) => resumes.push(r),
    });
    const fanout = createLiveChartFanout({
      seriesKey: KEY,
      resume,
      notify: notifyChart,
    });

    fanout.onFrame({
      type: 'full',
      seq: 1,
      id: `series:${KEY}`,
      payload: { bars: [bar(1)] },
    });
    fanout.onFrame({
      type: 'delta',
      seq: 4,
      id: `series:${KEY}`,
      payload: { baseIndex: 0, tail: [bar(9)] },
    });

    await Bun.sleep(0);
    expect(seen).toHaveLength(1);
    expect(resumes).toContain('seq-gap');
    expect(fanout.lastSeq()).toBe(1);

    fanout.handleRequestReload();
    await Bun.sleep(0);
    expect(resumes).toContain('request-reload');
  });

  test('filters other seriesKey; close paints tip delta; reset clears', () => {
    const seen: ChartNotifyMessage[] = [];
    const fanout = createLiveChartFanout({
      seriesKey: KEY,
      notify: (m) => seen.push(m),
    });

    fanout.onFrame({
      type: 'full',
      seq: 1,
      id: 'series:binance|spot|ETH/USDT|1m',
      payload: { bars: [bar(1)] },
    });
    expect(seen).toHaveLength(0);

    fanout.onFrame({
      type: 'full',
      seq: 1,
      id: `series:${KEY}`,
      payload: { bars: [bar(1), bar(2)] },
    });
    fanout.onFrame({
      type: 'close',
      seq: 2,
      id: `series:${KEY}`,
      payload: {
        time: 2,
        ohlcv: { open: 1, high: 2, low: 0.5, close: 1.8, volume: 3 },
      },
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.type).toBe('chart.delta');
    if (seen[1]?.type === 'chart.delta') {
      expect(seen[1].payload.baseIndex).toBe(1);
      expect(seen[1].payload.seq).toBe(2);
    }

    fanout.reset();
    expect(fanout.lastSeq()).toBe(0);
    expect(fanout.barCount()).toBe(0);
  });

  test('duplicate delta no-ops; unsafe baseIndex resumes; stale full dropped', async () => {
    const seen: ChartNotifyMessage[] = [];
    const resumes: string[] = [];
    const fanout = createLiveChartFanout({
      seriesKey: KEY,
      notify: (m) => seen.push(m),
      resume: createLiveResumeStub({
        remintOnResume: false,
        markDegraded: (r) => resumes.push(r),
      }),
    });

    fanout.onFrame({
      type: 'full',
      seq: 5,
      payload: { bars: [bar(1), bar(2)] },
    });
    fanout.onFrame({
      type: 'delta',
      seq: 5,
      payload: { baseIndex: 1, tail: [bar(2)] },
    });
    expect(seen).toHaveLength(1);

    fanout.onFrame({
      type: 'delta',
      seq: 6,
      payload: { baseIndex: 99, tail: [bar(9)] },
    });
    await Bun.sleep(0);
    expect(resumes).toContain('unsafe-delta');

    fanout.onFrame({
      type: 'full',
      seq: 3,
      payload: { bars: [bar(1)] },
    });
    expect(seen).toHaveLength(1);

    fanout.onFrame({ type: 'status', status: 'live' });
    fanout.onFrame('{not-json');
    fanout.onFrame({
      type: 'delta',
      seq: 6,
      payload: { baseIndex: 1, tail: [bar(2)] },
    });
    expect(fanout.lastSeq()).toBe(6);
  });

  test('notify throw does not escape onFrame', () => {
    const fanout = createLiveChartFanout({
      seriesKey: KEY,
      notify: () => {
        throw new Error('bus boom');
      },
    });
    expect(() =>
      fanout.onFrame({
        type: 'full',
        seq: 1,
        payload: { bars: [bar(1)] },
      }),
    ).not.toThrow();
    expect(() =>
      fanout.onFrame({
        type: 'delta',
        seq: 2,
        payload: { baseIndex: 0, tail: [bar(1)] },
      }),
    ).not.toThrow();
    expect(() =>
      fanout.onFrame({
        type: 'close',
        seq: 3,
        payload: {
          time: 1,
          ohlcv: { open: 1, high: 2, low: 0.5, close: 1.5 },
        },
      }),
    ).not.toThrow();
  });

  test('close before full / close seq gap resume; empty seriesKey uses frame key', async () => {
    const resumes: string[] = [];
    const resume = createLiveResumeStub({
      remintOnResume: false,
      markDegraded: (r) => resumes.push(r),
    });
    const early = createLiveChartFanout({ seriesKey: KEY, resume });
    early.onFrame({
      type: 'close',
      payload: { time: 1, ohlcv: { open: 1, high: 2, low: 0.5, close: 1 } },
    });
    await Bun.sleep(0);
    expect(resumes).toContain('close-gap');

    const seen: ChartNotifyMessage[] = [];
    const gap = createLiveChartFanout({
      seriesKey: KEY,
      resume: createLiveResumeStub({
        remintOnResume: false,
        markDegraded: (r) => resumes.push(r),
      }),
      notify: (m) => seen.push(m),
    });
    gap.onFrame({ type: 'full', seq: 2, payload: { bars: [bar(1)] } });
    gap.onFrame({
      type: 'close',
      seq: 9,
      payload: { time: 1, ohlcv: { open: 1, high: 2, low: 0.5, close: 1 } },
    });
    await Bun.sleep(0);
    expect(resumes).toContain('seq-gap');
    expect(seen).toHaveLength(1);

    const empty = createLiveChartFanout({
      seriesKey: '',
      notify: (m) => seen.push(m),
    });
    // No configured key and no frame key → still dropped.
    empty.onFrame({ type: 'full', seq: 1, payload: { bars: [bar(1)] } });
    expect(seen).toHaveLength(1);
    // Empty configured + frame id → bus retains under frame key.
    empty.onFrame({
      type: 'full',
      seq: 1,
      id: `series:${KEY}`,
      payload: { bars: [bar(1)] },
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.seriesKey).toBe(KEY);

    const fromGetter = createLiveChartFanout({
      seriesKey: () => KEY,
      notify: (m) => seen.push(m),
    });
    fromGetter.onFrame({ type: 'full', seq: 1, payload: { bars: [bar(2)] } });
    expect(seen).toHaveLength(3);
    expect(seen[2]?.seriesKey).toBe(KEY);

    const throwing = createLiveChartFanout({
      seriesKey: () => {
        throw new Error('session gone');
      },
      notify: (m) => seen.push(m),
    });
    throwing.onFrame({
      type: 'full',
      seq: 1,
      id: `series:${KEY}`,
      payload: { bars: [bar(3)] },
    });
    expect(seen).toHaveLength(4);
    expect(seen[3]?.seriesKey).toBe(KEY);

    const loose = createLiveChartFanout({
      seriesKey: KEY,
      filterSeriesKey: false,
      notify: (m) => seen.push(m),
    });
    loose.onFrame({
      type: 'full',
      seq: 1,
      id: 'series:other|spot|AAA/BBB|1m',
      payload: { bars: [bar(1)] },
    });
    expect(seen).toHaveLength(5);
    expect(seen[4]?.seriesKey).toBe('other|spot|AAA/BBB|1m');
  });
});
