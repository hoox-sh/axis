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
  MAX_COLORS_COPY_TEXT,
  NAMED_COLOR_SWATCH,
  PINE_EDITOR_LANGUAGE_IDS,
  colorKind,
  colorsSetMessage,
  isColorsReady,
  isColorsRefresh,
  isPineEditorLanguage,
  parseColorsCopy,
  parseColorsReveal,
  pineSourceLabel,
  scanColors,
  type ColorHit,
} from './colors-messages';

describe('pine editor language and labels', () => {
  test('accepts PYNE pinescript and pine, rejects other ids', () => {
    expect([...PINE_EDITOR_LANGUAGE_IDS]).toEqual(['pinescript', 'pine']);
    expect(isPineEditorLanguage('pinescript')).toBe(true);
    expect(isPineEditorLanguage('PINESCRIPT')).toBe(true);
    expect(isPineEditorLanguage('pine')).toBe(true);
    expect(isPineEditorLanguage('Pine')).toBe(true);
    expect(isPineEditorLanguage('python')).toBe(false);
    expect(isPineEditorLanguage('pinescripts')).toBe(false);
    expect(isPineEditorLanguage('')).toBe(false);
    expect(isPineEditorLanguage(null)).toBe(false);
    expect(isPineEditorLanguage(1)).toBe(false);
  });

  test('pineSourceLabel keeps the file name', () => {
    expect(pineSourceLabel('/tmp/scripts/rsi.pyne')).toBe('rsi.pyne');
    expect(pineSourceLabel('C:\\src\\ma.pine')).toBe('ma.pine');
    expect(pineSourceLabel('bare.pine')).toBe('bare.pine');
    expect(pineSourceLabel('  /only/  ')).toBe('Pine script');
    expect(pineSourceLabel('/')).toBe('Pine script');
    expect(pineSourceLabel('\\')).toBe('Pine script');
    expect(pineSourceLabel('   ')).toBe('Pine script');
    expect(pineSourceLabel('')).toBe('Pine script');
  });
});

describe('colors messages', () => {
  test('colors.set copies hits and does not share the array', () => {
    const hits: ColorHit[] = [{ line: 2, column: 3, raw: '#fff', swatch: '#fff' }];
    const msg = colorsSetMessage(hits, 'a.pyne');
    expect(msg).toEqual({
      type: 'colors.set',
      colors: [{ line: 2, column: 3, raw: '#fff', swatch: '#fff' }],
      sourceLabel: 'a.pyne',
    });
    hits[0]!.raw = 'mutated';
    expect(msg.colors[0]!.raw).toBe('#fff');
    expect(colorsSetMessage([], 'No Pine editor')).toEqual({
      type: 'colors.set',
      colors: [],
      sourceLabel: 'No Pine editor',
    });
  });

  test('colors.ready, refresh, reveal, and copy parse without throwing', () => {
    expect(isColorsReady({ type: 'colors.ready' })).toBe(true);
    expect(isColorsReady({ type: 'colors.reveal', line: 1 })).toBe(false);
    expect(isColorsReady(null)).toBe(false);
    expect(isColorsReady([])).toBe(false);
    expect(isColorsReady('colors.ready')).toBe(false);
    expect(isColorsRefresh({ type: 'colors.refresh' })).toBe(true);
    expect(isColorsRefresh({ type: 'colors.ready' })).toBe(false);
    expect(isColorsRefresh(null)).toBe(false);
    expect(isColorsRefresh([])).toBe(false);
    expect(parseColorsReveal({ type: 'colors.reveal', line: 4 })).toEqual({
      type: 'colors.reveal',
      line: 4,
    });
    expect(parseColorsReveal({ type: 'colors.reveal', line: 4, extra: true })).toEqual({
      type: 'colors.reveal',
      line: 4,
    });
    expect(parseColorsReveal({ type: 'colors.reveal', line: 0 })).toBeNull();
    expect(parseColorsReveal({ type: 'colors.reveal', line: -2 })).toBeNull();
    expect(parseColorsReveal({ type: 'colors.reveal', line: 1.5 })).toBeNull();
    expect(parseColorsReveal({ type: 'colors.reveal', line: '2' })).toBeNull();
    expect(parseColorsReveal({ type: 'colors.reveal' })).toBeNull();
    expect(parseColorsReveal({ type: 'colors.set', line: 1 })).toBeNull();
    expect(parseColorsReveal(null)).toBeNull();
    expect(parseColorsReveal([])).toBeNull();
    expect(parseColorsReveal(undefined)).toBeNull();
    expect(parseColorsCopy({ type: 'colors.copy', text: '#fff' })).toEqual({
      type: 'colors.copy',
      text: '#fff',
    });
    expect(parseColorsCopy({ type: 'colors.copy', text: '' })).toBeNull();
    expect(parseColorsCopy({ type: 'colors.copy', text: 'x'.repeat(MAX_COLORS_COPY_TEXT + 1) })).toBeNull();
    expect(parseColorsCopy({ type: 'colors.copy', text: 1 })).toBeNull();
    expect(parseColorsCopy({ type: 'colors.reveal', line: 1 })).toBeNull();
    expect(parseColorsCopy(null)).toBeNull();
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('boom');
        },
      },
    );
    expect(isColorsReady(hostile)).toBe(false);
    expect(isColorsRefresh(hostile)).toBe(false);
    expect(parseColorsReveal(hostile)).toBeNull();
    expect(parseColorsCopy(hostile)).toBeNull();
  });

  test('colorKind classifies hex, named, and rgb/new', () => {
    expect(colorKind('#fff')).toBe('hex');
    expect(colorKind('  #aabbcc  ')).toBe('hex');
    expect(colorKind('color.red')).toBe('named');
    expect(colorKind('COLOR.LIME')).toBe('named');
    expect(colorKind('color.rgb(1, 2, 3)')).toBe('rgb-new');
    expect(colorKind('color.new(#fff, 10)')).toBe('rgb-new');
    expect(colorKind('COLOR.NEW(#0f0, 0)')).toBe('rgb-new');
    expect(colorKind(null)).toBe('named');
    expect(colorKind(1)).toBe('named');
    expect(colorKind('')).toBe('named');
  });
});

describe('scanColors', () => {
  test('returns no hits for empty, non-strings, and near-misses', () => {
    expect(scanColors('')).toEqual([]);
    expect(scanColors(undefined as never)).toEqual([]);
    expect(scanColors(null as never)).toEqual([]);
    expect(scanColors(1 as never)).toEqual([]);
    expect(scanColors('plot(close)\ncolor.grey\ncolor.reddish\n#ff\n#abcd\n#abcde')).toEqual([]);
    expect(scanColors('color . red')).toEqual([]);
    expect(scanColors('mycolor.red')).toEqual([]);
  });

  test('lists every Pine named builtin with a css swatch', () => {
    const names = Object.keys(NAMED_COLOR_SWATCH);
    expect(names).toHaveLength(17);
    const source = names.map((name) => `color.${name}`).join('\n');
    const hits = scanColors(source);
    expect(hits).toHaveLength(17);
    hits.forEach((hit, i) => {
      const name = names[i]!;
      expect(hit).toEqual({
        line: i + 1,
        column: 1,
        raw: `color.${name}`,
        swatch: NAMED_COLOR_SWATCH[name],
      });
    });
    expect(scanColors('COLOR.RED')).toEqual([
      { line: 1, column: 1, raw: 'COLOR.RED', swatch: '#FF0000' },
    ]);
  });

  test('finds #rgb #rrggbb #rrggbbaa and keeps the source text as the swatch', () => {
    const hits = scanColors('x = #AbC\ny = #aabbcc\nz = #aabbccdd');
    expect(hits).toEqual([
      { line: 1, column: 5, raw: '#AbC', swatch: '#AbC' },
      { line: 2, column: 5, raw: '#aabbcc', swatch: '#aabbcc' },
      { line: 3, column: 5, raw: '#aabbccdd', swatch: '#aabbccdd' },
    ]);
    expect(scanColors('#fffextra')).toEqual([]);
    expect(scanColors('#1234567')).toEqual([]);
    expect(scanColors('#123456789')).toEqual([]);
  });

  test('resolves color.rgb and color.new, including transparency', () => {
    const hits = scanColors(
      [
        'color.rgb(255, 128, 0)',
        'color.rgb(1.5, 2.5, 3.2, 10.2)',
        'color.rgb(-1, 0, 300)',
        'color.rgb(+10, 0, 0, 0)',
        'color.rgb(0, 0, 0, 100)',
        'color.rgb(0, 0, 0, -5)',
        'color.rgb(0, 0, 0, 150)',
        'color.new(#F00, 100)',
        'color.new(#00ff00, 50)',
        'color.new(#80FF0000, 0)',
        'color.new( color.red , 0 )',
        'color.new(COLOR.LIME, 25)',
        'COLOR.RGB( 0 , 0 , 255 )',
      ].join('\n'),
    );
    expect(hits.map((hit) => [hit.raw, hit.swatch])).toEqual([
      ['color.rgb(255, 128, 0)', 'rgb(255, 128, 0)'],
      ['color.rgb(1.5, 2.5, 3.2, 10.2)', 'rgba(2, 3, 3, 0.9)'],
      ['color.rgb(-1, 0, 300)', 'rgb(0, 0, 255)'],
      ['color.rgb(+10, 0, 0, 0)', 'rgb(10, 0, 0)'],
      ['color.rgb(0, 0, 0, 100)', 'rgba(0, 0, 0, 0)'],
      ['color.rgb(0, 0, 0, -5)', 'rgb(0, 0, 0)'],
      ['color.rgb(0, 0, 0, 150)', 'rgba(0, 0, 0, 0)'],
      ['color.new(#F00, 100)', 'rgba(255, 0, 0, 0)'],
      ['#F00', '#F00'],
      ['color.new(#00ff00, 50)', 'rgba(0, 255, 0, 0.5)'],
      ['#00ff00', '#00ff00'],
      ['color.new(#80FF0000, 0)', 'rgb(128, 255, 0)'],
      ['#80FF0000', '#80FF0000'],
      ['color.new( color.red , 0 )', 'rgb(255, 0, 0)'],
      ['color.red', '#FF0000'],
      ['color.new(COLOR.LIME, 25)', 'rgba(0, 255, 0, 0.75)'],
      ['COLOR.LIME', '#00FF00'],
      ['COLOR.RGB( 0 , 0 , 255 )', 'rgb(0, 0, 255)'],
    ]);
    expect(hits[0]).toMatchObject({ line: 1, column: 1 });
    expect(hits[14]).toMatchObject({ line: 11, column: 12 });
  });

  test('keeps the call when arguments are not a plain color, and lists nested literals', () => {
    const hits = scanColors('color.new(#fff, 10)\ncolor.rgb(1, 2)\ncolor.new(notacolor, 1)');
    expect(hits.map((hit) => ({ raw: hit.raw, swatch: hit.swatch, line: hit.line, column: hit.column }))).toEqual([
      { raw: 'color.new(#fff, 10)', swatch: 'rgba(255, 255, 255, 0.9)', line: 1, column: 1 },
      { raw: '#fff', swatch: '#fff', line: 1, column: 11 },
      { raw: 'color.rgb(1, 2)', swatch: 'color.rgb(1, 2)', line: 2, column: 1 },
      { raw: 'color.new(notacolor, 1)', swatch: 'color.new(notacolor, 1)', line: 3, column: 1 },
    ]);
    expect(scanColors('color.rgb((1), 2, 3)')).toEqual([
      {
        line: 1,
        column: 1,
        raw: 'color.rgb((1), 2, 3)',
        swatch: 'color.rgb((1), 2, 3)',
      },
    ]);
    expect(scanColors('color.rgb(1, 2, 3')).toEqual([]);
    expect(scanColors('color.new(#fff)')).toEqual([
      { line: 1, column: 1, raw: 'color.new(#fff)', swatch: 'color.new(#fff)' },
      { line: 1, column: 11, raw: '#fff', swatch: '#fff' },
    ]);
  });

  test('balances strings inside calls and still sees a later hex', () => {
    const hits = scanColors('color.rgb(")", 4, 5, 6) #abc');
    expect(hits).toEqual([
      {
        line: 1,
        column: 1,
        raw: 'color.rgb(")", 4, 5, 6)',
        swatch: 'color.rgb(")", 4, 5, 6)',
      },
      { line: 1, column: 25, raw: '#abc', swatch: '#abc' },
    ]);
    expect(scanColors('color.rgb("a\\\\b", 9, 8, 7)')[0]?.raw).toBe('color.rgb("a\\\\b", 9, 8, 7)');
    expect(scanColors("color.new('x', 1)")).toEqual([
      { line: 1, column: 1, raw: "color.new('x', 1)", swatch: "color.new('x', 1)" },
    ]);
  });

  test('skips comments but still lists colors hidden only by strings', () => {
    expect(scanColors('// #fff color.red\n#00f')).toEqual([
      { line: 2, column: 1, raw: '#00f', swatch: '#00f' },
    ]);
    expect(scanColors('/* color.red #fff')).toEqual([]);
    expect(scanColors('/* *x color.navy */\ncolor.olive')).toEqual([
      { line: 2, column: 1, raw: 'color.olive', swatch: '#808000' },
    ]);
    expect(scanColors('"//" #fff')).toEqual([{ line: 1, column: 6, raw: '#fff', swatch: '#fff' }]);
    expect(scanColors("'// color.blue'\ncolor.blue")).toEqual([
      { line: 1, column: 5, raw: 'color.blue', swatch: '#0000FF' },
      { line: 2, column: 1, raw: 'color.blue', swatch: '#0000FF' },
    ]);
    expect(scanColors('"a\\\\b"\n#0f0')).toEqual([
      { line: 2, column: 1, raw: '#0f0', swatch: '#0f0' },
    ]);
    expect(scanColors('"unclosed\n#00f')).toEqual([
      { line: 2, column: 1, raw: '#00f', swatch: '#00f' },
    ]);
    expect(scanColors('"unterminated #abc')).toEqual([
      { line: 1, column: 15, raw: '#abc', swatch: '#abc' },
    ]);
    expect(scanColors('color.red // color.blue')).toEqual([
      { line: 1, column: 1, raw: 'color.red', swatch: '#FF0000' },
    ]);
    expect(scanColors('/*\ncolor.olive\n*/\ncolor.white')).toEqual([
      { line: 4, column: 1, raw: 'color.white', swatch: '#FFFFFF' },
    ]);
  });

  test('places a multiline call on the opening line', () => {
    const hits = scanColors('a\n  color.rgb(\n1, 2, 3)');
    expect(hits).toEqual([
      { line: 2, column: 3, raw: 'color.rgb(\n1, 2, 3)', swatch: 'rgb(1, 2, 3)' },
    ]);
  });
});
