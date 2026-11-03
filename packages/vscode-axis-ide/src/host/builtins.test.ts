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
  BUILTIN_CATALOG_RELATIVE,
  BUILTIN_CATALOG_SCHEMA,
  builtinCatalogPath,
  filterBuiltinCatalog,
  getBuiltinById,
  loadBuiltinCatalog,
  loadBuiltinCatalogFromFile,
  parseBuiltinCatalogJson,
  type BuiltinCatalogEntry,
} from './builtins';

const PKG_ROOT = resolve(import.meta.dir, '../..');
const CATALOG_FILE = resolve(PKG_ROOT, BUILTIN_CATALOG_RELATIVE);

function sampleEntry(over: Partial<BuiltinCatalogEntry> = {}): BuiltinCatalogEntry {
  return {
    id: 'sma',
    title: 'AXIS SMA',
    shorttitle: 'SMA',
    description: 'Simple moving average of source',
    category: 'moving-average',
    categoryLabel: 'Moving averages',
    kind: 'indicator',
    overlay: true,
    covers: 'Simple moving average',
    tags: ['ma', 'sma'],
    code: '//@version=6\nindicator("AXIS SMA")\nplot(close)\n',
    ...over,
  };
}

describe('builtin catalog path', () => {
  test('builtinCatalogPath joins media/builtins/catalog.json', () => {
    expect(builtinCatalogPath('/ext')).toBe(resolve('/ext', BUILTIN_CATALOG_RELATIVE));
    expect(BUILTIN_CATALOG_RELATIVE.replace(/\\/g, '/')).toBe('media/builtins/catalog.json');
  });
});

describe('parseBuiltinCatalogJson', () => {
  test('accepts shipped VSIX catalog schema', () => {
    const text = readFileSync(CATALOG_FILE, 'utf8');
    const result = parseBuiltinCatalogJson(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.schema).toBe(BUILTIN_CATALOG_SCHEMA);
    expect(result.catalog.count).toBeGreaterThanOrEqual(20);
    expect(result.catalog.scripts.length).toBe(result.catalog.count);
    const sma = getBuiltinById(result.catalog.scripts, 'sma');
    expect(sma?.title).toContain('SMA');
    expect(sma?.code.includes('//@version=6')).toBe(true);
  });

  test('rejects wrong schema / empty / garbage without throw', () => {
    expect(parseBuiltinCatalogJson('').ok).toBe(false);
    expect(parseBuiltinCatalogJson('[]').ok).toBe(false);
    expect(parseBuiltinCatalogJson('{"schema":"nope","scripts":[]}').ok).toBe(false);
    expect(
      parseBuiltinCatalogJson(
        JSON.stringify({ schema: BUILTIN_CATALOG_SCHEMA, scripts: [] }),
      ).ok,
    ).toBe(false);
    expect(
      parseBuiltinCatalogJson(
        JSON.stringify({ schema: BUILTIN_CATALOG_SCHEMA, scripts: { not: 'array' } }),
      ).ok,
    ).toBe(false);
    expect(
      parseBuiltinCatalogJson(JSON.stringify({ schema: BUILTIN_CATALOG_SCHEMA })).ok,
    ).toBe(false);
    expect(
      parseBuiltinCatalogJson(
        JSON.stringify({
          schema: BUILTIN_CATALOG_SCHEMA,
          scripts: [{ id: 'x' }],
        }),
      ).ok,
    ).toBe(false);
    expect(parseBuiltinCatalogJson('{').ok).toBe(false);
  });

  test('skips duplicate ids and non-objects; maps strategy kind', () => {
    const result = parseBuiltinCatalogJson(
      JSON.stringify({
        schema: BUILTIN_CATALOG_SCHEMA,
        source: 'test',
        generatedAt: '2026-11-02',
        scripts: [
          sampleEntry({ id: 'sma' }),
          sampleEntry({ id: 'sma', title: 'dup' }),
          null,
          'bad',
          sampleEntry({
            id: 'strat-x',
            kind: 'strategy',
            title: 'Strat',
            tags: undefined as unknown as string[],
          }),
          { id: '  ', code: 'x' },
          { id: 'ok', code: 'plot(1)', kind: 'indicator', overlay: false },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.scripts.map((s) => s.id)).toEqual(['sma', 'strat-x', 'ok']);
    expect(result.catalog.scripts[1]?.kind).toBe('strategy');
    expect(result.catalog.source).toBe('test');
  });
});

describe('loadBuiltinCatalog', () => {
  test('loads from package media path on disk', () => {
    const result = loadBuiltinCatalogFromFile(CATALOG_FILE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.count).toBe(111);
  });

  test('loadBuiltinCatalog uses extensionPath + injectable read', () => {
    const text = readFileSync(CATALOG_FILE, 'utf8');
    const result = loadBuiltinCatalog('/fake-ext', (path) => {
      expect(path.replace(/\\/g, '/')).toBe('/fake-ext/media/builtins/catalog.json');
      return text;
    });
    expect(result.ok).toBe(true);
  });

  test('read failure returns ok:false', () => {
    const result = loadBuiltinCatalogFromFile('/no/such/catalog.json', () => {
      throw new Error('ENOENT');
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('ENOENT');
  });
});

describe('filterBuiltinCatalog / getBuiltinById', () => {
  const scripts = [
    sampleEntry({ id: 'sma', title: 'AXIS SMA', tags: ['ma', 'sma'] }),
    sampleEntry({
      id: 'rsi',
      title: 'AXIS RSI',
      shorttitle: 'RSI',
      category: 'oscillator',
      categoryLabel: 'Oscillators',
      description: 'Relative strength',
      covers: 'RSI',
      tags: ['rsi'],
      overlay: false,
      code: '// rsi\n',
    }),
  ];

  test('empty query returns copy of all', () => {
    const all = filterBuiltinCatalog(scripts, '  ');
    expect(all).toEqual(scripts);
    expect(all).not.toBe(scripts);
  });

  test('multi-token filter is AND over haystack', () => {
    expect(filterBuiltinCatalog(scripts, 'rsi osc').map((s) => s.id)).toEqual(['rsi']);
    expect(filterBuiltinCatalog(scripts, 'moving sma').map((s) => s.id)).toEqual(['sma']);
    expect(filterBuiltinCatalog(scripts, 'zzz')).toEqual([]);
  });

  test('getBuiltinById matches exact id', () => {
    expect(getBuiltinById(scripts, 'rsi')?.shorttitle).toBe('RSI');
    expect(getBuiltinById(scripts, '')).toBeUndefined();
  });
});
