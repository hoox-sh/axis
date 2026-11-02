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
import { HOST_TO_VIEW, PROTOCOL_VERSION, VIEW_TO_HOST, encode } from '../protocol';
import {
  buildChartInitStub,
  CHART_INIT_CSS_VAR_KEYS,
  defaultChartCssVars,
  handleChartWebviewMessage,
} from './chart-messages';

describe('chart webview message handler', () => {
  const init = buildChartInitStub({
    theme: 'void',
    seriesKey: 'binance|spot|BTC/USDT|1m',
    panes: [{ id: 'price', kind: 'price' }],
    cssVars: { '--axis-bg': '#050505' },
  });

  test('buildChartInitStub fills placeholders including cssVars keys', () => {
    const stub = buildChartInitStub();
    expect(stub.theme).toBe('void');
    expect(stub.seriesKey).toBe('');
    expect(stub.panes).toEqual([{ id: 'price', kind: 'price' }]);
    const vars = stub.cssVars as Record<string, string>;
    for (const key of CHART_INIT_CSS_VAR_KEYS) {
      expect(vars[key]).toBe('');
    }
    expect(Object.keys(defaultChartCssVars())).toEqual([...CHART_INIT_CSS_VAR_KEYS]);
  });

  test('accepts webview.ready for chart and replies chart.init', () => {
    const ready = encode(VIEW_TO_HOST.WebviewReady, {
      view: 'chart',
      capabilities: ['chart-shell'],
    });
    const result = handleChartWebviewMessage(ready, init);
    expect(result.kind).toBe('init');
    if (result.kind === 'init') {
      expect(result.envelope.type).toBe(HOST_TO_VIEW.ChartInit);
      expect(result.envelope.v).toBe(PROTOCOL_VERSION);
      expect(result.envelope.payload.seriesKey).toBe('binance|spot|BTC/USDT|1m');
      expect(result.envelope.payload.theme).toBe('void');
      expect(result.envelope.payload.panes).toEqual([{ id: 'price', kind: 'price' }]);
      expect(result.envelope.payload.cssVars).toEqual({ '--axis-bg': '#050505' });
    }
  });

  test('rejects bad envelopes with BAD_ codes', () => {
    const bad = handleChartWebviewMessage({ v: 99, type: 'webview.ready' }, init);
    expect(bad.kind).toBe('reject');
    if (bad.kind === 'reject') {
      expect(bad.error.code).toBe('BAD_VERSION');
    }

    const unknown = handleChartWebviewMessage(
      { v: 1, type: 'nope', payload: {}, ts: 1 },
      init,
    );
    expect(unknown.kind).toBe('reject');
    if (unknown.kind === 'reject') {
      expect(unknown.error.code).toBe('UNKNOWN_TYPE');
    }

    const notObject = handleChartWebviewMessage(null, init);
    expect(notObject.kind).toBe('reject');
    if (notObject.kind === 'reject') {
      expect(notObject.error.code).toBe('BAD_ENVELOPE');
    }
  });

  test('rejects webview.ready for results view on chart editor', () => {
    const ready = encode(VIEW_TO_HOST.WebviewReady, {
      view: 'results',
      capabilities: [],
    });
    const result = handleChartWebviewMessage(ready, init);
    expect(result.kind).toBe('reject');
    if (result.kind === 'reject') {
      expect(result.error.code).toBe('BAD_PAYLOAD');
      expect(result.error.message).toContain('chart');
    }
  });

  test('rejects host→view types sent from the webview (wrong direction)', () => {
    const spoof = encode(HOST_TO_VIEW.ChartInit, init);
    const result = handleChartWebviewMessage(spoof, init);
    expect(result.kind).toBe('reject');
    if (result.kind === 'reject') {
      expect(result.error.code).toBe('BAD_TYPE');
      expect(result.error.message).toContain('host→view');
    }
  });

  test('ignores non-ready view→host types', () => {
    const viewport = encode(VIEW_TO_HOST.ChartViewport, { from: 1, to: 2 });
    const result = handleChartWebviewMessage(viewport, init);
    expect(result.kind).toBe('ignore');
  });

  test('catches encode failures when init stub is invalid', () => {
    const ready = encode(VIEW_TO_HOST.WebviewReady, {
      view: 'chart',
      capabilities: [],
    });
    const result = handleChartWebviewMessage(ready, {
      theme: 'void',
      seriesKey: 1 as unknown as string,
      cssVars: {},
      panes: [],
    });
    expect(result.kind).toBe('reject');
    if (result.kind === 'reject') {
      expect(result.error.code).toBe('BAD_ENVELOPE');
      expect(result.error.message).toContain('chart message handler failed');
    }
  });
});
