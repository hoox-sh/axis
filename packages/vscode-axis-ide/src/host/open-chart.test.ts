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
import { CHART_SCHEMA, parseChartDocument } from '../editors/chart-document';
import {
  OPEN_CHART_VIEW_COLUMN_BESIDE,
  defaultChartDocumentForPine,
  isPineFilePath,
  openChartEditorOptions,
  planSiblingChartOpen,
  serializeSiblingChartDocument,
  siblingAxisJsonPath,
} from './open-chart';

describe('openChart sibling helper', () => {
  test('openChartEditorOptions uses Beside and disables preview', () => {
    expect(OPEN_CHART_VIEW_COLUMN_BESIDE).toBe(-2);
    expect(openChartEditorOptions()).toEqual({
      viewColumn: -2,
      preview: false,
      preserveFocus: false,
    });
    expect(openChartEditorOptions(true).preserveFocus).toBe(true);
  });

  test('isPineFilePath accepts known suffixes', () => {
    expect(isPineFilePath('/w/rsi.pyne')).toBe(true);
    expect(isPineFilePath('/w/x.PINE')).toBe(true);
    expect(isPineFilePath('/w/x.pinev5')).toBe(true);
    expect(isPineFilePath('/w/x.axis.json')).toBe(false);
    expect(isPineFilePath('/w/readme.md')).toBe(false);
  });

  test('siblingAxisJsonPath maps stem beside Pine file', () => {
    expect(siblingAxisJsonPath('/proj/indicators/rsi.pyne')).toBe(
      '/proj/indicators/rsi.axis.json',
    );
    expect(siblingAxisJsonPath('C:\\a\\macd.pine')).toBe('C:\\a\\macd.axis.json');
    expect(siblingAxisJsonPath('/a/b.pinescript')).toBe('/a/b.axis.json');
    expect(siblingAxisJsonPath('/a/chart.axis.json')).toBeNull();
    expect(siblingAxisJsonPath('.pyne')).toBeNull();
  });

  test('defaultChartDocumentForPine is axis.chart.v1 with script link', () => {
    const doc = defaultChartDocumentForPine('rsi.pyne');
    expect(doc.schema).toBe(CHART_SCHEMA);
    expect(doc.scripts).toEqual([{ id: 'rsi', uri: './rsi.pyne', inputs: {} }]);
    const round = parseChartDocument(JSON.stringify(doc));
    expect(round.ok).toBe(true);
  });

  test('defaultChartDocumentForPine copies historyBars from setting', () => {
    const doc = defaultChartDocumentForPine('rsi.pyne', { historyBars: 220 });
    expect(doc.historyBars).toBe(220);
  });

  test('defaultChartDocumentForPine empty name returns base defaults', () => {
    const doc = defaultChartDocumentForPine('  ');
    expect(doc.schema).toBe(CHART_SCHEMA);
    expect(doc.scripts).toEqual([]);
  });

  test('serializeSiblingChartDocument writes UTF-8 axis.chart.v1 JSON', () => {
    const bytes = serializeSiblingChartDocument('macd.pyne', { historyBars: 90 });
    expect(bytes).toBeInstanceOf(Uint8Array);
    const text = new TextDecoder().decode(bytes);
    const parsed = parseChartDocument(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.doc.scripts).toEqual([{ id: 'macd', uri: './macd.pyne', inputs: {} }]);
      expect(parsed.doc.historyBars).toBe(90);
    }
  });

  test('planSiblingChartOpen writes bytes only when sibling missing', () => {
    const create = planSiblingChartOpen({
      pinePath: '/w/rsi.pyne',
      pineFileName: 'rsi.pyne',
      siblingExists: false,
      historyBarsSetting: 64,
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    expect(create.siblingPath).toBe('/w/rsi.axis.json');
    expect(create.writeBytes).toBeInstanceOf(Uint8Array);
    const bytes = create.writeBytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    if (!(bytes instanceof Uint8Array)) return;
    const parsed = parseChartDocument(new TextDecoder().decode(bytes));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc.historyBars).toBe(64);
    const openExisting = planSiblingChartOpen({
      pinePath: '/w/rsi.pyne',
      pineFileName: 'rsi.pyne',
      siblingExists: true,
      historyBarsSetting: 64,
    });
    expect(openExisting.ok).toBe(true);
    if (openExisting.ok) {
      expect(openExisting.writeBytes).toBeNull();
    }
  });

  test('planSiblingChartOpen rejects non-Pine paths', () => {
    const bad = planSiblingChartOpen({
      pinePath: '/w/readme.md',
      pineFileName: 'readme.md',
      siblingExists: false,
    });
    expect(bad.ok).toBe(false);
  });

  test('planSiblingChartOpen rejects empty-stem Pine (.pyne)', () => {
    const bad = planSiblingChartOpen({
      pinePath: '.pyne',
      pineFileName: '.pyne',
      siblingExists: false,
    });
    expect(bad.ok).toBe(false);
  });

  test('planSiblingChartOpen catches hostile path access', () => {
    const hostile = {
      toString() {
        throw new Error('boom');
      },
    };
    const bad = planSiblingChartOpen({
      pinePath: hostile as unknown as string,
      pineFileName: 'x.pyne',
      siblingExists: false,
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain('Open Chart failed');
      expect(bad.error).toContain('boom');
    }
  });
});
