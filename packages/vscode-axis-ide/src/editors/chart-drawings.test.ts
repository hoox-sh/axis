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
  defaultChartDocument,
  parseChartDocument,
  serializeChartDocument,
} from './chart-document';
import {
  DRAWING_TOOL_TRENDLINE,
  appendDrawingToDoc,
  isUserDrawingBatch,
  normalizeCommittedDrawing,
  normalizeDrawingPoint,
  normalizeUserDrawings,
} from './chart-drawings';
import { buildChartInitStub, handleChartWebviewMessage } from './chart-messages';
import { buildChartSession } from '../host/chart-session';
import { HOST_TO_VIEW, VIEW_TO_HOST, decode, encode } from '../protocol';
import {
  applyChartHostMessage,
  initialChartState,
  normalizeUserDrawings as webNormalizeUserDrawings,
} from '../../webview/chart/src/state';

const sampleTrendline = {
  id: 'tl-1',
  tool: DRAWING_TOOL_TRENDLINE,
  points: [
    { time: 1_700_000_000, price: 42000 },
    { time: 1_700_000_600, price: 43000 },
  ],
};

describe('chart drawings normalize', () => {
  test('normalizeDrawingPoint accepts time/price and t/p', () => {
    expect(normalizeDrawingPoint({ time: 1, price: 2 })).toEqual({ time: 1, price: 2 });
    expect(normalizeDrawingPoint({ t: 3, p: 4 })).toEqual({ time: 3, price: 4 });
    expect(normalizeDrawingPoint({ time: 'x', price: 1 })).toBeNull();
    expect(normalizeDrawingPoint(null)).toBeNull();
  });

  test('normalizeCommittedDrawing requires trendline + two points', () => {
    const ok = normalizeCommittedDrawing(sampleTrendline);
    expect(ok).toEqual(sampleTrendline);

    expect(normalizeCommittedDrawing({ ...sampleTrendline, tool: 'ray' })).toBeNull();
    expect(normalizeCommittedDrawing({ ...sampleTrendline, id: '' })).toBeNull();
    expect(normalizeCommittedDrawing({ ...sampleTrendline, points: [{ time: 1, price: 1 }] })).toBeNull();
    expect(normalizeCommittedDrawing([])).toBeNull();
    expect(normalizeCommittedDrawing(null)).toBeNull();
  });

  test('isUserDrawingBatch distinguishes script batches', () => {
    expect(isUserDrawingBatch([])).toBe(true);
    expect(isUserDrawingBatch([sampleTrendline])).toBe(true);
    expect(isUserDrawingBatch([{ id: 'd1' }])).toBe(false);
    expect(isUserDrawingBatch(null)).toBe(false);
  });

  test('normalizeUserDrawings keeps valid trendlines only', () => {
    const list = normalizeUserDrawings([
      sampleTrendline,
      { id: 'x', tool: 'trendline', points: [{ time: 1, price: 1 }] },
      { id: 'script', kind: 'line' },
    ]);
    expect(list).toEqual([sampleTrendline]);
  });

  test('hostile getters fall through catch paths without throw', () => {
    const hostilePoint: Record<string, unknown> = {};
    Object.defineProperty(hostilePoint, 'time', {
      enumerable: true,
      get() {
        throw new Error('hostile time');
      },
    });
    expect(normalizeDrawingPoint(hostilePoint)).toBeNull();

    const hostileCommit: Record<string, unknown> = { tool: 'trendline' };
    Object.defineProperty(hostileCommit, 'id', {
      enumerable: true,
      get() {
        throw new Error('hostile id');
      },
    });
    expect(normalizeCommittedDrawing(hostileCommit)).toBeNull();

    const hostileArr: unknown[] = [];
    Object.defineProperty(hostileArr, '0', {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error('hostile entry');
      },
    });
    hostileArr.length = 1;
    expect(normalizeUserDrawings(hostileArr)).toEqual([]);
  });
});

describe('drawing.commit → doc.drawings round-trip', () => {
  test('appendDrawingToDoc dirties via new drawings array and serializes', () => {
    const doc = defaultChartDocument();
    expect(doc.drawings).toEqual([]);

    const drawing = normalizeCommittedDrawing(sampleTrendline);
    expect(drawing).not.toBeNull();
    if (!drawing) return;

    const next = appendDrawingToDoc(doc, drawing);
    expect(next).not.toBe(doc);
    expect(next.drawings).toHaveLength(1);
    expect(next.drawings[0]).toEqual(sampleTrendline);

    const text = serializeChartDocument(next);
    const parsed = parseChartDocument(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.drawings).toEqual([sampleTrendline]);
  });

  test('appendDrawingToDoc replaces same id and keeps others', () => {
    const first = normalizeCommittedDrawing(sampleTrendline);
    const other = normalizeCommittedDrawing({
      id: 'tl-2',
      tool: DRAWING_TOOL_TRENDLINE,
      points: [
        { time: 2, price: 10 },
        { time: 3, price: 11 },
      ],
    });
    expect(first).not.toBeNull();
    expect(other).not.toBeNull();
    if (!first || !other) return;
    let doc = appendDrawingToDoc(defaultChartDocument(), first);
    doc = appendDrawingToDoc(doc, other);
    expect(doc.drawings).toHaveLength(2);

    const updated = normalizeCommittedDrawing({
      ...sampleTrendline,
      points: [
        { time: 10, price: 100 },
        { time: 20, price: 200 },
      ],
    });
    expect(updated).not.toBeNull();
    if (!updated) return;
    const next = appendDrawingToDoc(doc, updated);
    expect(next.drawings).toHaveLength(2);
    expect(next.drawings[0]).toEqual(other);
    expect(next.drawings[1]).toEqual(updated);

    // Non-object entries in drawings are preserved when appending.
    const messy = {
      ...defaultChartDocument(),
      drawings: [null, 'x', { id: 'keep-me', tool: 'trendline' }],
    };
    const afterMessy = appendDrawingToDoc(messy, first);
    expect(afterMessy.drawings).toContain(null);
    expect(afterMessy.drawings).toContain('x');
    expect(
      afterMessy.drawings.some(
        (d) =>
          d !== null &&
          typeof d === 'object' &&
          !Array.isArray(d) &&
          (d as { id?: string }).id === first.id,
      ),
    ).toBe(true);
  });

  test('handleChartWebviewMessage commit + setTool', () => {
    const session = {
      init: buildChartInitStub(),
      full: { bars: [], seq: 1, drawings: [] },
    };

    const setTool = handleChartWebviewMessage(
      encode(VIEW_TO_HOST.DrawingSetTool, { tool: 'trendline' }),
      session,
    );
    expect(setTool.kind).toBe('setTool');
    if (setTool.kind === 'setTool') expect(setTool.tool).toBe('trendline');

    const commit = handleChartWebviewMessage(
      encode(VIEW_TO_HOST.DrawingCommit, sampleTrendline),
      session,
    );
    expect(commit.kind).toBe('commit');
    if (commit.kind === 'commit') {
      expect(commit.drawing.id).toBe('tl-1');
      expect(commit.drawing.tool).toBe('trendline');
      expect(commit.drawing.points).toHaveLength(2);
    }

    const bad = handleChartWebviewMessage(
      encode(VIEW_TO_HOST.DrawingCommit, { id: 'x', tool: 'trendline', points: [] }),
      session,
    );
    expect(bad.kind).toBe('reject');
    if (bad.kind === 'reject') expect(bad.error.code).toBe('BAD_PAYLOAD');
  });

  test('session init/full include drawings; reload restores into webview state', () => {
    const drawing = normalizeCommittedDrawing(sampleTrendline);
    expect(drawing).not.toBeNull();
    if (!drawing) return;
    const doc = appendDrawingToDoc(defaultChartDocument(), drawing);
    doc.symbol = 'BTC/USDT';
    doc.exchange = 'binance';

    const session = buildChartSession({ doc, useMockBars: true, seq: 1 });
    expect(session.init.drawings).toEqual([sampleTrendline]);
    expect(session.full.drawings).toEqual([sampleTrendline]);

    const initEnv = encode(HOST_TO_VIEW.ChartInit, session.init);
    const initDecoded = decode(initEnv);
    expect(initDecoded.ok).toBe(true);
    if (!initDecoded.ok) return;

    let state = initialChartState();
    state = applyChartHostMessage(
      state,
      'chart.init',
      initDecoded.envelope.payload as Record<string, unknown>,
    ).state;
    expect(state.drawings).toEqual([sampleTrendline]);

    // Script drawings on chart.full must not wipe user drawings.
    state = applyChartHostMessage(state, 'chart.full', {
      bars: [],
      seq: 2,
      drawings: [{ id: 'script-1' }],
    }).state;
    expect(state.drawings).toEqual([sampleTrendline]);

    // User-shaped empty batch clears (handshake with no drawings).
    state = applyChartHostMessage(state, 'chart.full', {
      bars: [],
      seq: 3,
      drawings: [],
    }).state;
    expect(state.drawings).toEqual([]);

    // Webview normalize mirrors host.
    expect(webNormalizeUserDrawings([sampleTrendline])).toEqual([sampleTrendline]);
  });

  test('commit payload round-trips through serialize into document drawings', () => {
    const session = {
      init: buildChartInitStub({ drawings: [] }),
      full: { bars: [], seq: 1, drawings: [] },
    };
    const handle = handleChartWebviewMessage(
      encode(VIEW_TO_HOST.DrawingCommit, sampleTrendline),
      session,
    );
    expect(handle.kind).toBe('commit');
    if (handle.kind !== 'commit') return;

    let doc = defaultChartDocument();
    doc = appendDrawingToDoc(doc, handle.drawing);
    // Simulate dirty path: content-change would fire from AxisChartDocument.update(doc).
    expect(doc.drawings).toEqual([sampleTrendline]);

    const reloaded = parseChartDocument(serializeChartDocument(doc));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    const again = buildChartSession({ doc: reloaded.doc, useMockBars: false });
    expect(again.init.drawings).toEqual([sampleTrendline]);
    expect(again.full.drawings).toEqual([sampleTrendline]);
  });
});
