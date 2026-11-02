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
import { defaultChartDocument } from './chart-document';
import { handleChartWebviewMessage } from './chart-messages';
import { buildChartSession } from '../host/chart-session';
import { HOST_TO_VIEW, VIEW_TO_HOST, decode, encode } from '../protocol';
import {
  initialChartState,
  normalizeBars,
  reduceChartMessage,
} from '../../webview/chart/src/state';

describe('chart.full encode → decode → reducer apply', () => {
  test('session full round-trips into webview reducer bars', () => {
    const doc = {
      ...defaultChartDocument(),
      symbol: 'BTC/USDT',
      exchange: 'binance',
      historyBars: 50,
    };
    const session = buildChartSession({ doc, useMockBars: true, seq: 1 });

    const env = encode(HOST_TO_VIEW.ChartFull, session.full);
    const decoded = decode(env);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const payload = decoded.envelope.payload as Record<string, unknown>;
    let state = initialChartState();
    state = reduceChartMessage(state, 'chart.init', {
      theme: 'void',
      seriesKey: session.seriesKey,
      panes: doc.panes,
      cssVars: {},
    });
    expect(state.bars).toEqual([]);
    state = reduceChartMessage(state, decoded.envelope.type, payload);

    expect(state.ready).toBe(true);
    expect(state.seriesKey).toBe('binance|spot|BTC/USDT|1m');
    expect(state.seq).toBe(1);
    expect(state.bars).toHaveLength(50);
    expect(session.bars).toHaveLength(50);
    const applied = state.bars[0];
    const expected = session.bars[0];
    expect(applied).toBeDefined();
    expect(expected).toBeDefined();
    if (!applied || !expected) return;
    expect(applied.time).toBeTypeOf('number');
    expect(applied).toEqual({
      time: expected.time,
      open: expected.open,
      high: expected.high,
      low: expected.low,
      close: expected.close,
      volume: expected.volume,
    });
    expect(applied.high).toBeGreaterThanOrEqual(Math.max(applied.open, applied.close));
  });

  test('second chart.full replaces series; empty full clears', () => {
    let state = initialChartState();
    state = reduceChartMessage(state, 'chart.full', {
      bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }],
      seq: 1,
    });
    expect(state.bars).toHaveLength(1);

    state = reduceChartMessage(state, 'chart.full', {
      bars: [
        { time: 10, open: 2, high: 3, low: 1, close: 2.5, volume: 2 },
        { time: 11, open: 2.5, high: 4, low: 2, close: 3, volume: 3 },
      ],
      seq: 2,
    });
    expect(state.seq).toBe(2);
    expect(state.bars).toHaveLength(2);
    const first = state.bars[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.time).toBe(10);

    state = reduceChartMessage(state, 'chart.init', {
      theme: 'void',
      seriesKey: 'x',
      panes: [],
      cssVars: {},
    });
    expect(state.bars).toEqual([]);
    expect(state.seq).toBe(0);

    state = reduceChartMessage(state, 'chart.full', { bars: [], seq: 3 });
    expect(state.bars).toEqual([]);
    expect(state.seq).toBe(3);
  });

  test('handshake handler returns init + full envelopes', () => {
    const doc = {
      ...defaultChartDocument(),
      symbol: 'SOL/USDT',
      exchange: 'binance',
      historyBars: 40,
    };
    const session = buildChartSession({ doc, useMockBars: true });
    const ready = encode(VIEW_TO_HOST.WebviewReady, {
      view: 'chart',
      capabilities: ['chart-full'],
    });
    const result = handleChartWebviewMessage(ready, () => ({
      init: session.init,
      full: session.full,
    }));
    expect(result.kind).toBe('init');
    if (result.kind !== 'init') return;
    expect(result.envelope.type).toBe(HOST_TO_VIEW.ChartInit);
    expect(result.full.type).toBe(HOST_TO_VIEW.ChartFull);
    expect((result.full.payload as { bars: unknown[] }).bars).toHaveLength(40);
  });

  test('normalizeBars accepts short keys and ignores garbage', () => {
    const bars = normalizeBars([
      { t: 1, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { time: 2, open: 1, high: 1, low: 1, close: 1 },
      null,
      { open: 1 },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      time: 1,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 10,
    });
  });

  test('reducer ignores unknown types', () => {
    const state = reduceChartMessage(initialChartState(), 'nope', {});
    expect(state).toEqual(initialChartState());
  });
});
