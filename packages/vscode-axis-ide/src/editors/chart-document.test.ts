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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CHART_SCHEMA,
  CHART_VIEW_TYPE,
  defaultChartDocument,
  normalizeChartDocument,
  parseChartDocument,
  serializeChartDocument,
} from './chart-document';

describe('chart document helpers', () => {
  test('viewType and schema constants', () => {
    expect(CHART_VIEW_TYPE).toBe('axis.chart');
    expect(CHART_SCHEMA).toBe('axis.chart.v1');
  });

  test('defaultChartDocument is axis.chart.v1 with price pane', () => {
    const doc = defaultChartDocument();
    expect(doc.schema).toBe(CHART_SCHEMA);
    expect(doc.panes).toEqual([{ id: 'price', kind: 'price' }]);
    expect(doc.drawings).toEqual([]);
    expect(doc.interval).toBe('1m');
  });

  test('empty / whitespace string parses to default doc', () => {
    expect(parseChartDocument('').ok).toBe(true);
    expect(parseChartDocument('   \n').ok).toBe(true);
    const a = parseChartDocument('');
    const b = parseChartDocument('{}');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.doc.schema).toBe(CHART_SCHEMA);
      expect(b.doc.schema).toBe(CHART_SCHEMA);
      expect(b.doc.panes[0]?.kind).toBe('price');
    }
  });

  test('rejects non-object JSON text and invalid JSON', () => {
    const arr = parseChartDocument('[1]');
    expect(arr.ok).toBe(false);
    if (!arr.ok) expect(arr.error).toContain('object');

    const bad = parseChartDocument('{');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('invalid JSON');

    const nul = parseChartDocument('null');
    expect(nul.ok).toBe(false);
  });

  test('rejects non-string non-object roots (no silent default)', () => {
    expect(parseChartDocument(undefined).ok).toBe(false);
    expect(parseChartDocument(null).ok).toBe(false);
    expect(parseChartDocument([1, 2]).ok).toBe(false);
    expect(parseChartDocument(42).ok).toBe(false);
    expect(parseChartDocument(true).ok).toBe(false);
    const arr = parseChartDocument([1, 2]);
    if (!arr.ok) expect(arr.error).toContain('string or plain object');
  });

  test('normalize fills defaults and keeps known fields', () => {
    const doc = normalizeChartDocument({
      schema: CHART_SCHEMA,
      symbol: 'ETH/USDT',
      panes: [{ id: 'price', kind: 'price' }, { id: 'bad' }],
      historyBars: 100,
    });
    expect(doc.symbol).toBe('ETH/USDT');
    expect(doc.historyBars).toBe(100);
    expect(doc.panes).toEqual([{ id: 'price', kind: 'price' }]);
    expect(doc.exchange).toBe('');
  });

  test('normalize coerces unknown schema and negative historyBars', () => {
    const doc = normalizeChartDocument({
      schema: 'axis.chart.v0',
      historyBars: -12,
    });
    expect(doc.schema).toBe(CHART_SCHEMA);
    expect(doc.historyBars).toBe(0);
  });

  test('serialize round-trips through parse', () => {
    const original = defaultChartDocument();
    original.symbol = 'BTC/USDT';
    original.exchange = 'binance';
    const text = serializeChartDocument(original);
    expect(text.endsWith('\n')).toBe(true);
    const again = parseChartDocument(text);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.doc.symbol).toBe('BTC/USDT');
      expect(again.doc.exchange).toBe('binance');
      expect(again.doc.schema).toBe(CHART_SCHEMA);
    }
  });

  test('sample fixture is valid axis.chart.v1', () => {
    const path = resolve(__dirname, '../../fixtures/sample.axis.json');
    const raw = readFileSync(path, 'utf8');
    const parsed = parseChartDocument(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.schema).toBe(CHART_SCHEMA);
      expect(parsed.doc.symbol).toBe('BTC/USDT');
    }
  });

  test('normalize tolerates empty schema and empty panes list', () => {
    const doc = normalizeChartDocument({
      schema: '',
      panes: [],
      scripts: 'nope',
      drawings: null,
      historyBars: Number.NaN,
    } as Record<string, unknown>);
    expect(doc.schema).toBe(CHART_SCHEMA);
    expect(doc.panes).toEqual([{ id: 'price', kind: 'price' }]);
    expect(doc.scripts).toEqual([]);
    expect(doc.drawings).toEqual([]);
    expect(doc.historyBars).toBe(1500);
  });

  test('parseChartDocument accepts plain objects and valid JSON strings', () => {
    expect(parseChartDocument('{"schema":"axis.chart.v1"}').ok).toBe(true);
    expect(parseChartDocument('false').ok).toBe(false);
    expect(parseChartDocument({ symbol: 'BTC/USDT' }).ok).toBe(true);
  });

  test('parseChartDocument catches hostile object getters', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'symbol', {
      enumerable: true,
      get() {
        throw new Error('hostile symbol');
      },
    });
    const result = parseChartDocument(hostile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('parse failed');
  });
});
