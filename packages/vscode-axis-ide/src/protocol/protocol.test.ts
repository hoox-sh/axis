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
  ALL_MESSAGE_TYPES,
  decode,
  encode,
  HOST_TO_VIEW,
  isHostToView,
  isViewToHost,
  KNOWN_TYPES,
  PROTOCOL_ERROR_CODES,
  PROTOCOL_VERSION,
  SECTION_6_MESSAGE_TYPES,
  VIEW_TO_HOST,
  type MessageType,
  type PayloadByType,
} from './index';

/** Canonical sample payload per type — shared with round-trip table. */
const SAMPLES: { [K in MessageType]: PayloadByType[K] } = {
  [HOST_TO_VIEW.ChartInit]: {
    theme: 'dark',
    cssVars: { '--bg': '#000' },
    seriesKey: 'binance|spot|BTCUSDT|1m',
    panes: [{ id: 'main' }],
  },
  [HOST_TO_VIEW.ChartFull]: {
    bars: [{ t: 1, o: 1, h: 2, l: 0.5, c: 1.5 }],
    plots: [{ id: 'sma' }],
    drawings: [],
    seq: 1,
  },
  [HOST_TO_VIEW.ChartDelta]: {
    baseIndex: 10,
    tail: [{ t: 2, o: 1, h: 2, l: 1, c: 2 }],
    plots: null,
    seq: 2,
  },
  [HOST_TO_VIEW.ChartTheme]: {
    kind: 'dark',
    cssVars: { '--fg': '#fff' },
  },
  [HOST_TO_VIEW.ChartDrawingApply]: [{ id: 'line-1', kind: 'trend' }],
  [HOST_TO_VIEW.HostRunStatus]: {
    epoch: 3,
    state: 'running',
    message: 'ok',
  },
  [HOST_TO_VIEW.HostError]: {
    code: 'RUN_FAILED',
    message: 'engine error',
  },
  [HOST_TO_VIEW.ResultsSet]: {
    lastRun: { id: 'r1' },
    strategyReport: null,
    focusId: 'r1',
  },
  [VIEW_TO_HOST.WebviewReady]: {
    view: 'chart',
    capabilities: ['delta'],
  },
  [VIEW_TO_HOST.ChartViewport]: {
    from: 0,
    to: 100,
    logical: { from: 0, to: 50 },
  },
  [VIEW_TO_HOST.DrawingSetTool]: { tool: 'trendline' },
  [VIEW_TO_HOST.DrawingCommit]: { id: 'd1', points: [[0, 1]] },
  [VIEW_TO_HOST.ChartRequestReload]: {},
  [VIEW_TO_HOST.ResultsFocus]: { runId: 'r1' },
  [VIEW_TO_HOST.ResultsReady]: {},
};

afterEach(() => {
  // Undo runtime KNOWN_TYPES mutations from exhaustiveness tests.
  for (const t of [...KNOWN_TYPES]) {
    if (!(ALL_MESSAGE_TYPES as readonly string[]).includes(t)) {
      (KNOWN_TYPES as Set<string>).delete(t);
    }
  }
});

describe('axis.webview.v1 protocol', () => {
  test('PROTOCOL_VERSION is 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  test('ALL_MESSAGE_TYPES matches frozen design §6 golden list', () => {
    expect([...ALL_MESSAGE_TYPES].sort()).toEqual([...SECTION_6_MESSAGE_TYPES].sort());
    expect(new Set(ALL_MESSAGE_TYPES).size).toBe(ALL_MESSAGE_TYPES.length);
    expect(ALL_MESSAGE_TYPES.length).toBe(15);
  });

  test('round-trip encode→decode for every message type', () => {
    for (const type of ALL_MESSAGE_TYPES) {
      const payload = SAMPLES[type];
      const env = encode(type, payload as never, { id: `id-${type}`, ts: 1_700_000_000_000 });
      expect(env.v).toBe(1);
      expect(env.type).toBe(type);
      expect(env.ts).toBe(1_700_000_000_000);
      expect(env.id).toBe(`id-${type}`);
      const result = decode(env);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.type).toBe(type);
        expect(result.envelope.payload).toEqual(payload);
        expect(result.envelope.id).toBe(`id-${type}`);
      }
    }
  });

  test('JSON wire round-trip preserves every message type', () => {
    for (const type of ALL_MESSAGE_TYPES) {
      const env = encode(type, SAMPLES[type] as never, { id: 'wire', ts: 42 });
      const parsed = JSON.parse(JSON.stringify(env));
      const result = decode(parsed);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope).toEqual(env);
      }
    }
  });

  test('encode without opts uses Date.now and omits id', () => {
    const before = Date.now();
    const env = encode(VIEW_TO_HOST.ResultsReady, {});
    const after = Date.now();
    expect(env.id).toBeUndefined();
    expect(env.ts).toBeGreaterThanOrEqual(before);
    expect(env.ts).toBeLessThanOrEqual(after);
  });

  test('chart.drawing.apply accepts object batch', () => {
    const env = encode(HOST_TO_VIEW.ChartDrawingApply, { items: [] });
    const result = decode(env);
    expect(result.ok).toBe(true);
  });

  test('host.run.status allows omitted message', () => {
    const env = encode(HOST_TO_VIEW.HostRunStatus, { epoch: 1, state: 'idle' });
    expect(decode(env).ok).toBe(true);
  });

  test('webview.ready defaults capabilities to [] when omitted', () => {
    const env = encode(VIEW_TO_HOST.WebviewReady, { view: 'results' });
    expect(env.payload).toEqual({ view: 'results', capabilities: [] });
    const result = decode({
      v: 1,
      type: VIEW_TO_HOST.WebviewReady,
      payload: { view: 'chart' },
      ts: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.payload).toEqual({ view: 'chart', capabilities: [] });
    }
  });

  test('direction helpers are type predicates', () => {
    for (const type of Object.values(HOST_TO_VIEW)) {
      expect(isHostToView(type)).toBe(true);
      expect(isViewToHost(type)).toBe(false);
      if (isHostToView(type)) {
        const narrowed: typeof type = type;
        expect(narrowed).toBe(type);
      }
    }
    for (const type of Object.values(VIEW_TO_HOST)) {
      expect(isViewToHost(type)).toBe(true);
      expect(isHostToView(type)).toBe(false);
    }
    expect(isHostToView('nope')).toBe(false);
    expect(isViewToHost('nope')).toBe(false);
  });
});

describe('decode reject paths', () => {
  test('never throws on garbage and asserts BAD_ENVELOPE', () => {
    const junk = [null, undefined, 1, 'x', true, []];
    for (const raw of junk) {
      expect(() => decode(raw)).not.toThrow();
      const r = decode(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_ENVELOPE);
    }
  });

  test('never throws on hostile property getters', () => {
    const raw = {};
    Object.defineProperty(raw, 'v', {
      get() {
        throw new Error('boom-v');
      },
    });
    expect(() => decode(raw)).not.toThrow();
    const r = decode(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_ENVELOPE);
      expect(r.error.message).toContain('boom-v');
    }
  });

  test('bad version variants', () => {
    for (const v of [0, 2, '1', null, undefined, 1.5]) {
      const r = decode({
        v,
        type: HOST_TO_VIEW.HostError,
        payload: { code: 'a', message: 'b' },
        ts: 1,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_VERSION);
    }
  });

  test('unknown type', () => {
    const r = decode({ v: 1, type: 'chart.unknown', payload: {}, ts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.UNKNOWN_TYPE);
  });

  test('empty type string', () => {
    const r = decode({ v: 1, type: '', payload: {}, ts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_TYPE);
  });

  test('non-string type', () => {
    const r = decode({ v: 1, type: 9, payload: {}, ts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_TYPE);
  });

  test('non-finite ts', () => {
    for (const ts of [Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      const r = decode({
        v: 1,
        type: VIEW_TO_HOST.ResultsReady,
        payload: {},
        ts,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_TS);
    }
  });

  test('bad id (non-string or empty)', () => {
    for (const id of [99, '', null]) {
      const r = decode({
        v: 1,
        type: VIEW_TO_HOST.ResultsReady,
        payload: {},
        ts: 1,
        id,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_ID);
    }
  });

  test('missing payload', () => {
    const r = decode({ v: 1, type: VIEW_TO_HOST.ResultsReady, ts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_PAYLOAD);
  });

  test('KNOWN_TYPE without validator hits default BAD_TYPE', () => {
    (KNOWN_TYPES as Set<string>).add('chart.unhandled');
    const r = decode({ v: 1, type: 'chart.unhandled', payload: {}, ts: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_TYPE);
      expect(r.error.message).toContain('unhandled');
    }
  });

  test('payload shape failures per type', () => {
    const cases: Array<{ type: MessageType; payload: unknown; tip: string }> = [
      { type: HOST_TO_VIEW.ChartInit, payload: null, tip: 'object' },
      { type: HOST_TO_VIEW.ChartInit, payload: { theme: 1, cssVars: 1, panes: 1 }, tip: 'seriesKey' },
      { type: HOST_TO_VIEW.ChartInit, payload: { seriesKey: 'x' }, tip: 'theme' },
      {
        type: HOST_TO_VIEW.ChartInit,
        payload: { seriesKey: 'x', theme: 1, cssVars: 1 },
        tip: 'panes',
      },
      { type: HOST_TO_VIEW.ChartFull, payload: [], tip: 'object' },
      { type: HOST_TO_VIEW.ChartFull, payload: { bars: [] }, tip: 'seq' },
      { type: HOST_TO_VIEW.ChartFull, payload: { seq: 1 }, tip: 'bars' },
      { type: HOST_TO_VIEW.ChartFull, payload: { bars: [], seq: Number.NaN }, tip: 'seq' },
      { type: HOST_TO_VIEW.ChartDelta, payload: 'x', tip: 'object' },
      { type: HOST_TO_VIEW.ChartDelta, payload: { baseIndex: 1, seq: 1 }, tip: 'tail' },
      {
        type: HOST_TO_VIEW.ChartDelta,
        payload: { baseIndex: Number.NaN, tail: [], seq: 1 },
        tip: 'baseIndex',
      },
      {
        type: HOST_TO_VIEW.ChartDelta,
        payload: { baseIndex: 1, tail: [] },
        tip: 'seq',
      },
      { type: HOST_TO_VIEW.ChartTheme, payload: null, tip: 'object' },
      { type: HOST_TO_VIEW.ChartTheme, payload: { kind: 1, cssVars: {} }, tip: 'kind' },
      { type: HOST_TO_VIEW.ChartTheme, payload: { kind: '', cssVars: {} }, tip: 'kind' },
      { type: HOST_TO_VIEW.ChartTheme, payload: { kind: 'dark' }, tip: 'cssVars' },
      { type: HOST_TO_VIEW.ChartDrawingApply, payload: 'nope', tip: 'object or array' },
      { type: HOST_TO_VIEW.ChartDrawingApply, payload: null, tip: 'object or array' },
      { type: HOST_TO_VIEW.HostRunStatus, payload: null, tip: 'object' },
      { type: HOST_TO_VIEW.HostRunStatus, payload: { epoch: 'x', state: 'a' }, tip: 'epoch' },
      {
        type: HOST_TO_VIEW.HostRunStatus,
        payload: { epoch: 1, state: 1 },
        tip: 'state',
      },
      {
        type: HOST_TO_VIEW.HostRunStatus,
        payload: { epoch: 1, state: 'a', message: 3 },
        tip: 'message',
      },
      { type: HOST_TO_VIEW.HostError, payload: null, tip: 'object' },
      { type: HOST_TO_VIEW.HostError, payload: { code: 1, message: 'm' }, tip: 'code' },
      { type: HOST_TO_VIEW.HostError, payload: { code: 'E' }, tip: 'message' },
      { type: HOST_TO_VIEW.HostError, payload: { code: 'E', message: 1 }, tip: 'message' },
      { type: HOST_TO_VIEW.ResultsSet, payload: null, tip: 'object' },
      { type: HOST_TO_VIEW.ResultsSet, payload: { lastRun: 1 }, tip: 'strategyReport' },
      {
        type: HOST_TO_VIEW.ResultsSet,
        payload: { lastRun: 1, strategyReport: 1 },
        tip: 'focusId',
      },
      { type: VIEW_TO_HOST.WebviewReady, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.WebviewReady, payload: {}, tip: 'view' },
      { type: VIEW_TO_HOST.WebviewReady, payload: { view: 'pane' }, tip: 'view' },
      { type: VIEW_TO_HOST.WebviewReady, payload: { view: 1 }, tip: 'view' },
      {
        type: VIEW_TO_HOST.WebviewReady,
        payload: { view: 'chart', capabilities: [1] },
        tip: 'capabilities',
      },
      {
        type: VIEW_TO_HOST.WebviewReady,
        payload: { view: 'chart', capabilities: 'x' },
        tip: 'capabilities',
      },
      { type: VIEW_TO_HOST.ChartViewport, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.ChartViewport, payload: { from: 'a', to: 1 }, tip: 'from' },
      {
        type: VIEW_TO_HOST.ChartViewport,
        payload: { from: 1, to: Number.POSITIVE_INFINITY },
        tip: 'to',
      },
      { type: VIEW_TO_HOST.DrawingSetTool, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.DrawingSetTool, payload: { tool: 1 }, tip: 'tool' },
      { type: VIEW_TO_HOST.DrawingCommit, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.DrawingCommit, payload: [], tip: 'object' },
      { type: VIEW_TO_HOST.ChartRequestReload, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.ChartRequestReload, payload: [], tip: 'object' },
      { type: VIEW_TO_HOST.ChartRequestReload, payload: { x: 1 }, tip: 'empty' },
      { type: VIEW_TO_HOST.ResultsFocus, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.ResultsFocus, payload: { runId: 1 }, tip: 'runId' },
      { type: VIEW_TO_HOST.ResultsReady, payload: null, tip: 'object' },
      { type: VIEW_TO_HOST.ResultsReady, payload: [], tip: 'object' },
      { type: VIEW_TO_HOST.ResultsReady, payload: { extra: true }, tip: 'empty' },
    ];

    for (const c of cases) {
      const r = decode({ v: 1, type: c.type, payload: c.payload, ts: 1 });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe(PROTOCOL_ERROR_CODES.BAD_PAYLOAD);
        expect(r.error.message.toLowerCase()).toContain(c.tip.toLowerCase());
      }
    }
  });
});

describe('encode reject paths', () => {
  test('throws on unknown type', () => {
    expect(() => encode('chart.nope' as MessageType, {} as never)).toThrow(/unknown message type/);
  });

  test('throws on invalid payload', () => {
    expect(() => encode(HOST_TO_VIEW.HostError, { code: 1, message: 'x' } as never)).toThrow(
      /host\.error/,
    );
  });

  test('throws on non-finite opts.ts', () => {
    expect(() => encode(VIEW_TO_HOST.ResultsReady, {}, { ts: Number.NaN })).toThrow(/opts\.ts/);
  });

  test('throws on empty or non-string opts.id', () => {
    expect(() => encode(VIEW_TO_HOST.ResultsReady, {}, { id: '' })).toThrow(/opts\.id/);
    expect(() => encode(VIEW_TO_HOST.ResultsReady, {}, { id: 1 as never })).toThrow(/opts\.id/);
  });

  test('throws when empty payloads carry keys', () => {
    expect(() => encode(VIEW_TO_HOST.ChartRequestReload, { x: 1 } as never)).toThrow(/empty/);
    expect(() => encode(VIEW_TO_HOST.ResultsReady, { x: 1 } as never)).toThrow(/empty/);
  });
});
