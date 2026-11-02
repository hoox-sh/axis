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
  MAX_SYMBOL_TEXT,
  SYMBOL_CATEGORIES,
  SYMBOL_CATEGORY_LABELS,
  encodeSymbolsSet,
  filterSymbols,
  isSymbolCategory,
  listSymbols,
  parseSymbolsWebMessage,
  symbolCategoryLabel,
  type AxisSymbol,
} from './symbols-messages';

const EXPECTED_COUNTS: Record<(typeof SYMBOL_CATEGORIES)[number], number> = {
  arrows: 14,
  shapes: 12,
  box: 16,
  checks: 10,
  stars: 10,
};

function sample(): AxisSymbol {
  return { id: 'arr-u', category: 'arrows', char: '\u2191', name: 'Arrow up' };
}

describe('listSymbols', () => {
  test('returns a focused BMP catalog with stable ids', () => {
    const symbols = listSymbols();
    expect(symbols.length).toBe(62);
    expect(symbols[0]).toEqual({
      id: 'arr-u',
      category: 'arrows',
      char: '\u2191',
      name: 'Arrow up',
    });
    expect(symbols[symbols.length - 1]?.id).toBe('st-eight');
    expect(Object.keys(symbols[0]!).sort()).toEqual(['category', 'char', 'id', 'name']);

    const ids = new Set<string>();
    const chars = new Set<string>();
    const counts: Record<string, number> = {};
    for (const symbol of symbols) {
      expect(ids.has(symbol.id)).toBe(false);
      expect(chars.has(symbol.char)).toBe(false);
      ids.add(symbol.id);
      chars.add(symbol.char);
      counts[symbol.category] = (counts[symbol.category] ?? 0) + 1;
      expect(isSymbolCategory(symbol.category)).toBe(true);
      const points = [...symbol.char];
      expect(points.length).toBe(1);
      expect(points[0]!.codePointAt(0)!).toBeLessThanOrEqual(0xffff);
      expect(symbol.name.trim()).toBe(symbol.name);
    }
    expect(counts).toEqual(EXPECTED_COUNTS);
    for (const category of SYMBOL_CATEGORIES) {
      const n = counts[category] ?? 0;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(16);
      expect(SYMBOL_CATEGORY_LABELS[category].length).toBeGreaterThan(0);
    }

    symbols[0]!.name = 'hacked';
    symbols.pop();
    expect(listSymbols()[0]!.name).toBe('Arrow up');
    expect(listSymbols().length).toBe(62);
  });
});

describe('symbolCategoryLabel', () => {
  test('labels known chips and treats empty as All', () => {
    expect(symbolCategoryLabel('')).toBe('All');
    expect(symbolCategoryLabel('  ALL ')).toBe('All');
    expect(symbolCategoryLabel(null)).toBe('All');
    expect(symbolCategoryLabel(1)).toBe('All');
    expect(symbolCategoryLabel('finance')).toBe('');
    for (const category of SYMBOL_CATEGORIES) {
      expect(symbolCategoryLabel(category)).toBe(SYMBOL_CATEGORY_LABELS[category]);
      expect(symbolCategoryLabel(`  ${category.toUpperCase()} `)).toBe(SYMBOL_CATEGORY_LABELS[category]);
    }
    expect(isSymbolCategory('arrows')).toBe(true);
    expect(isSymbolCategory('Arrows')).toBe(false);
    expect(isSymbolCategory('')).toBe(false);
  });
});

describe('filterSymbols', () => {
  test('empty query returns the category or the full catalog', () => {
    expect(filterSymbols('', '').map((symbol) => symbol.id)).toEqual(listSymbols().map((s) => s.id));
    expect(filterSymbols('   ', 'all').length).toBe(62);
    expect(filterSymbols(undefined, null).length).toBe(62);
    expect(filterSymbols(new String('up'), false).length).toBe(62);
    expect(filterSymbols('', 'arrows').every((symbol) => symbol.category === 'arrows')).toBe(true);
    expect(filterSymbols('', 'arrows').length).toBe(14);
    expect(filterSymbols('', '  BOX ').map((symbol) => symbol.category)).toEqual(Array(16).fill('box'));
    expect(filterSymbols('', ' ALL ')).toEqual(listSymbols());
    expect(filterSymbols('', 'finance')).toEqual([]);
    expect(filterSymbols({ bad: true }, ['arrows'])).toEqual(listSymbols());
  });

  test('matches name, id, or char without throwing', () => {
    expect(filterSymbols('pointer left', 'arrows').map((symbol) => symbol.id)).toEqual(['ptr-l']);
    expect(filterSymbols('st-eight', '').map((symbol) => symbol.id)).toEqual(['st-eight']);
    expect(filterSymbols('\u2191', 'stars')).toEqual([]);
    expect(filterSymbols('\u2191', 'arrows').map((symbol) => symbol.id)).toEqual(['arr-u']);
    expect(filterSymbols('zzz', 'shapes')).toEqual([]);
    expect(filterSymbols('.', 'box')).toEqual([]);
    const starred = filterSymbols('star', 'stars').map((symbol) => symbol.id);
    expect(starred).toContain('st-black');
    expect(starred).not.toContain('st-ast');
    const copy = filterSymbols('', 'checks');
    copy[0]!.name = 'hacked';
    expect(listSymbols().find((symbol) => symbol.id === 'chk-ok')!.name).toBe('Check');
    expect(() => filterSymbols(new Proxy({}, { get() { throw new Error('q'); } }), 'arrows')).not.toThrow();
  });
});

describe('encodeSymbolsSet', () => {
  test('posts a sanitized snapshot and coerces category', () => {
    const full = encodeSymbolsSet(listSymbols(), '  up  ', 'ARROWS');
    expect(full.type).toBe('symbols.set');
    expect(full.query).toBe('up');
    expect(full.category).toBe('arrows');
    expect(full.symbols).toEqual(listSymbols());

    const all = encodeSymbolsSet(listSymbols(), '', 'all');
    expect(all.category).toBe('');
    expect(all.symbols).toEqual(listSymbols());

    expect(encodeSymbolsSet(listSymbols(), 1, null)).toEqual({
      type: 'symbols.set',
      symbols: listSymbols(),
      query: '',
      category: '',
    });
    expect(encodeSymbolsSet(listSymbols(), 'x', 'nope').category).toBe('');
    expect(encodeSymbolsSet({ not: 'array' }, '', 'stars').symbols).toEqual([]);
  });

  test('drops hostile rows and survives a throwing iterator', () => {
    const good = sample();
    const mixed = encodeSymbolsSet(
      [
        null,
        [],
        1,
        { id: 1, category: 'arrows', char: '\u2191', name: 'No' },
        { id: '   ', category: 'arrows', char: '\u2191', name: 'Blank' },
        { id: 'x', category: 1, char: '\u2191', name: 'Bad cat' },
        { id: 'x', category: 'finance', char: '\u2191', name: 'Unknown' },
        { id: 'x', category: 'arrows', char: 1, name: 'Bad char' },
        { id: 'x', category: 'arrows', char: '', name: 'Empty char' },
        { id: 'x', category: 'arrows', char: 'x'.repeat(MAX_SYMBOL_TEXT + 1), name: 'Long' },
        { id: 'x', category: 'arrows', char: '\u2191', name: 1 },
        { id: 'x', category: 'arrows', char: '\u2191', name: '   ' },
        { id: '  spaced  ', category: '  Arrows ', char: '\u2191', name: '  Arrow up  ', extra: 'nope' },
        new Proxy(
          { id: 'z', category: 'arrows', char: '\u2191', name: 'Z' },
          { get() { throw new Error('field'); } },
        ),
        good,
      ],
      '',
      '',
    );
    expect(mixed.symbols).toEqual([
      { id: 'spaced', category: 'arrows', char: '\u2191', name: 'Arrow up' },
      good,
    ]);

    class Boom extends Array {
      override [Symbol.iterator](): ArrayIterator<unknown> {
        throw new Error('iter');
      }
    }
    const blown = encodeSymbolsSet(new Boom(1), ' keep ', 'stars');
    expect(blown).toEqual({ type: 'symbols.set', symbols: [], query: 'keep', category: 'stars' });
  });
});

describe('parseSymbolsWebMessage', () => {
  test('accepts insert and copy text and rejects the rest', () => {
    expect(parseSymbolsWebMessage({ type: 'symbols.insert', text: '\u2191' })).toEqual({
      type: 'symbols.insert',
      text: '\u2191',
    });
    expect(parseSymbolsWebMessage({ type: 'symbols.copy', text: 'x'.repeat(MAX_SYMBOL_TEXT) })).toEqual({
      type: 'symbols.copy',
      text: 'x'.repeat(MAX_SYMBOL_TEXT),
    });
    expect(parseSymbolsWebMessage(null)).toBeNull();
    expect(parseSymbolsWebMessage('symbols.insert')).toBeNull();
    expect(parseSymbolsWebMessage(1)).toBeNull();
    expect(parseSymbolsWebMessage([])).toBeNull();
    expect(parseSymbolsWebMessage({ type: 'symbols.set', text: '\u2191' })).toBeNull();
    expect(parseSymbolsWebMessage({ type: 'symbols.insert', text: 1 })).toBeNull();
    expect(parseSymbolsWebMessage({ type: 'symbols.insert' })).toBeNull();
    expect(parseSymbolsWebMessage({ type: 'symbols.copy', text: '' })).toBeNull();
    expect(parseSymbolsWebMessage({ type: 'symbols.insert', text: 'x'.repeat(MAX_SYMBOL_TEXT + 1) })).toBeNull();
    expect(
      parseSymbolsWebMessage(
        new Proxy(
          { type: 'symbols.insert', text: '\u2191' },
          { get() { throw new Error('msg'); } },
        ),
      ),
    ).toBeNull();
  });
});
