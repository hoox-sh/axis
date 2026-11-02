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
  applyChartHostMessage,
  classifyDeltaSeq,
  initialChartState,
  mergeBarTail,
  normalizeBars,
  pickChartPlugins,
  pluginChipSpecs,
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

  test('chart.init stores plugins; host.run.status updates plugins and keeps bars', () => {
    let state = initialChartState();
    state = reduceChartMessage(state, 'chart.init', {
      theme: 'void',
      seriesKey: 'binance|spot|BTC/USDT|1m',
      panes: [],
      cssVars: {},
      plugins: { source: 'binance-rest', engine: 'server', extra: 'drop' },
    });
    expect(state.plugins).toEqual({ source: 'binance-rest', engine: 'server' });
    expect(state.bars).toEqual([]);

    state = reduceChartMessage(state, 'chart.full', {
      bars: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }],
      seq: 1,
    });
    expect(state.bars).toHaveLength(1);
    const barsBefore = state.bars;

    const status = applyChartHostMessage(state, 'host.run.status', {
      epoch: 0,
      state: 'plugins',
      plugins: { source: 'okx-rest', stream: 'binance-ws', engine: 'pyodide', storage: 'local' },
    });
    expect(status.requestReload).toBe(false);
    expect(status.state.bars).toBe(barsBefore);
    expect(status.state.seq).toBe(1);
    expect(status.state.plugins).toEqual({
      source: 'okx-rest',
      stream: 'binance-ws',
      engine: 'pyodide',
      storage: 'local',
    });

    const noPlugins = applyChartHostMessage(status.state, 'host.run.status', {
      epoch: 1,
      state: 'running',
    });
    expect(noPlugins.state.plugins).toEqual(status.state.plugins);
    expect(noPlugins.state.bars).toBe(status.state.bars);

    const badPlugins = applyChartHostMessage(status.state, 'host.run.status', {
      epoch: 2,
      state: 'plugins',
      plugins: ['x'],
    });
    expect(badPlugins.state.plugins).toEqual(status.state.plugins);

    expect(pluginChipSpecs(status.state.plugins)).toEqual([
      { kind: 'source', prefix: 'src', id: 'okx-rest' },
      { kind: 'stream', prefix: 'stm', id: 'binance-ws' },
      { kind: 'engine', prefix: 'eng', id: 'pyodide' },
      { kind: 'storage', prefix: 'sto', id: 'local' },
    ]);
    expect(pluginChipSpecs(undefined)).toEqual([]);
    expect(pluginChipSpecs({})).toEqual([]);
    expect(pluginChipSpecs({ source: '  ' })).toEqual([]);
    expect(pickChartPlugins(['x'])).toBeUndefined();
    expect(pickChartPlugins(null)).toBeUndefined();
    expect(pickChartPlugins({ source: 'mexc-rest', stream: 1 })).toEqual({ source: 'mexc-rest' });

    const reinit = reduceChartMessage(status.state, 'chart.init', {
      theme: 'void',
      seriesKey: 'x',
      panes: [],
      cssVars: {},
    });
    expect(reinit.plugins).toEqual(status.state.plugins);
    expect(reinit.bars).toEqual([]);

    const emptyPlugins = reduceChartMessage(reinit, 'chart.init', {
      theme: 'void',
      seriesKey: 'x',
      panes: [],
      cssVars: {},
      plugins: {},
    });
    expect(emptyPlugins.plugins).toEqual({});

    const hostile: Record<string, unknown> = { epoch: 0, state: 'plugins' };
    Object.defineProperty(hostile, 'plugins', {
      get() {
        throw new Error('boom-plugins');
      },
    });
    expect(() => applyChartHostMessage(status.state, 'host.run.status', hostile)).not.toThrow();
  });
});

describe('chart.delta merge + seq gap → requestReload', () => {
  const b = (t: number) => ({
    time: t,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 1,
  });

  test('continuous delta merges tail at baseIndex', () => {
    let state = initialChartState();
    state = reduceChartMessage(state, 'chart.full', {
      bars: [b(1), b(2), b(3)],
      seq: 10,
    });
    const tip = applyChartHostMessage(state, 'chart.delta', {
      baseIndex: 2,
      tail: [{ ...b(3), close: 1.8 }],
      seq: 11,
    });
    expect(tip.requestReload).toBe(false);
    expect(tip.state.seq).toBe(11);
    expect(tip.state.bars).toHaveLength(3);
    expect(tip.state.bars[2]?.close).toBe(1.8);

    const append = applyChartHostMessage(tip.state, 'chart.delta', {
      baseIndex: 3,
      tail: [b(4)],
      seq: 12,
    });
    expect(append.requestReload).toBe(false);
    expect(append.state.bars).toHaveLength(4);
    expect(append.state.bars[3]?.time).toBe(4);
  });

  test('seq gap and delta-before-full set requestReload; duplicate no-ops', () => {
    let state = initialChartState();
    const before = applyChartHostMessage(state, 'chart.delta', {
      baseIndex: 0,
      tail: [b(1)],
      seq: 1,
    });
    expect(before.requestReload).toBe(true);
    expect(before.state.bars).toEqual([]);

    state = reduceChartMessage(state, 'chart.full', { bars: [b(1)], seq: 5 });
    const gap = applyChartHostMessage(state, 'chart.delta', {
      baseIndex: 0,
      tail: [b(9)],
      seq: 9,
    });
    expect(gap.requestReload).toBe(true);
    expect(gap.state.seq).toBe(5);

    const dup = applyChartHostMessage(state, 'chart.delta', {
      baseIndex: 0,
      tail: [b(1)],
      seq: 5,
    });
    expect(dup.requestReload).toBe(false);
    expect(dup.state).toEqual(state);
  });

  test('unsafe baseIndex / malformed delta handling', () => {
    let state = reduceChartMessage(initialChartState(), 'chart.full', {
      bars: [b(1)],
      seq: 1,
    });
    const badBase = applyChartHostMessage(state, 'chart.delta', {
      baseIndex: 5,
      tail: [b(2)],
      seq: 2,
    });
    expect(badBase.requestReload).toBe(true);

    const malformed = applyChartHostMessage(state, 'chart.delta', { seq: 2 });
    expect(malformed.requestReload).toBe(false);
    expect(malformed.state).toEqual(state);

    expect(classifyDeltaSeq(1, 2)).toBe('continuous');
    expect(classifyDeltaSeq(1, 1)).toBe('duplicate');
    expect(classifyDeltaSeq(1, 3)).toBe('gap');
    expect(classifyDeltaSeq(0, 1)).toBe('gap');
    expect(mergeBarTail([b(1)], 0, [b(9)])).toEqual([b(9)]);
    expect(mergeBarTail([b(1)], -1, [b(9)])).toBeNull();
  });

  test('chart.delta encode → decode → reducer apply', () => {
    const env = encode(HOST_TO_VIEW.ChartDelta, {
      baseIndex: 1,
      tail: [b(2)],
      seq: 2,
      plots: { x: [1] },
    });
    const decoded = decode(env);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const state = reduceChartMessage(initialChartState(), 'chart.full', {
      bars: [b(1), b(2)],
      seq: 1,
    });
    const out = applyChartHostMessage(
      state,
      decoded.envelope.type,
      decoded.envelope.payload as Record<string, unknown>,
    );
    expect(out.requestReload).toBe(false);
    expect(out.state.seq).toBe(2);
    expect(out.state.bars).toHaveLength(2);
    expect(out.state.bars[1]?.time).toBe(2);
  });
});
