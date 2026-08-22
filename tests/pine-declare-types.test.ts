/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pine type1/type2 declaration insertion (post-run editor action).
 */

import { describe, expect, it } from 'bun:test';
import {
  addMissingTypeDeclarations,
  inferType1,
  inferType2,
  parseAssignLine,
  wouldAddTypeDeclarations,
} from '../src/editor/pine-declare-types';

describe('parseAssignLine', () => {
  it('parses bare assign', () => {
    const h = parseAssignLine('len = 14');
    expect(h?.name).toBe('len');
    expect(h?.rhs).toBe('14');
    expect(h?.type1).toBeNull();
    expect(h?.type2).toBeNull();
  });

  it('parses var / typed forms', () => {
    const v = parseAssignLine('var float sum = 0.0');
    expect(v?.mode).toBe('var');
    expect(v?.type2).toBe('float');
    expect(v?.name).toBe('sum');
    const s = parseAssignLine('  series float rsi = ta.rsi(close, 14)');
    expect(s?.type1).toBe('series');
    expect(s?.type2).toBe('float');
  });

  it('rejects := reassignment', () => {
    expect(parseAssignLine('x := 1')).toBeNull();
  });

  it('captures generic collection types', () => {
    const h = parseAssignLine('array<string> vals = array.from(1.0)');
    expect(h?.name).toBe('vals');
    expect(h?.type2).toBe('array');
    expect(h?.type2Generic).toBe('<string>');
    const nested = parseAssignLine('map<string,float> book = na');
    expect(nested?.type2).toBe('map');
    expect(nested?.type2Generic).toBe('<string,float>');
  });
});

describe('inferType1 / inferType2', () => {
  it('literals → const + type2', () => {
    expect(inferType2('14')).toBe('int');
    expect(inferType2('1.5')).toBe('float');
    expect(inferType2('"hi"')).toBe('string');
    expect(inferType2('true')).toBe('bool');
    expect(inferType2('color.red')).toBe('color');
    expect(inferType1('14', 'int')).toBe('const');
    expect(inferType1('color.red', 'color')).toBe('const');
  });

  it('ta / OHLCV → series float', () => {
    expect(inferType2('ta.rsi(close, 14)')).toBe('float');
    expect(inferType1('ta.rsi(close, 14)', 'float')).toBe('series');
    expect(inferType2('ta.crossover(a, b)')).toBe('bool');
  });

  it('input.* → simple + typed', () => {
    expect(inferType2('input.int(14, "Len")')).toBe('int');
    expect(inferType1('input.int(14, "Len")', 'int')).toBe('simple');
  });
});

describe('addMissingTypeDeclarations', () => {
  it('annotates a typical untyped indicator', () => {
    const src = `//@version=6
indicator("RSI")
len = 14
src = close
rsi = ta.rsi(src, len)
up = ta.crossover(rsi, 50)
plot(rsi)
`;
    const { source, changed, edits } = addMissingTypeDeclarations(src);
    expect(changed).toBeGreaterThanOrEqual(3);
    expect(source).toContain('const int len = 14');
    expect(source).toContain('series float src = close');
    expect(source).toContain('series float rsi = ta.rsi(src, len)');
    expect(source).toMatch(/series bool up = ta\.crossover/);
    expect(edits.every((e) => e.line >= 1)).toBe(true);
  });

  it('keeps fully typed lines (type1 + type2)', () => {
    const src = `series float x = close\nconst int y = 1\n`;
    const { changed, source } = addMissingTypeDeclarations(src);
    expect(changed).toBe(0);
    expect(source).toBe(src);
  });

  it('adds missing type1 when only type2 is present', () => {
    const src = `int y = 1\n`;
    const { source, changed } = addMissingTypeDeclarations(src);
    expect(changed).toBe(1);
    expect(source).toContain('const int y = 1');
  });

  it('uses last-run series names as series float hints', () => {
    const src = `foo = bar + 1\n`;
    const { source, changed } = addMissingTypeDeclarations(src, {
      seriesNames: ['foo'],
    });
    expect(changed).toBe(1);
    expect(source).toContain('series float foo = bar + 1');
  });

  it('preserves var / varip and indent', () => {
    const src = `    var sum = 0.0\n`;
    const { source } = addMissingTypeDeclarations(src);
    expect(source).toMatch(/^\s{4}var (?:const |simple |series )?float sum = 0\.0/m);
  });

  it('skips comments and function defs', () => {
    const src = `// x = 1
f(a) =>
    a + 1
y = 2
`;
    const { source, changed } = addMissingTypeDeclarations(src);
    expect(source).toContain('// x = 1');
    expect(source).toContain('f(a) =>');
    expect(changed).toBe(1);
    expect(source).toContain('const int y = 2');
  });

  it('wouldAddTypeDeclarations mirrors changed', () => {
    expect(wouldAddTypeDeclarations('x = 1\n')).toBe(true);
    expect(wouldAddTypeDeclarations('const int x = 1\n')).toBe(false);
  });

  it('keeps generic args when adding a type1 qualifier', () => {
    const src = 'array<string> vals = str.split("1|2", "|")\n';
    const { source } = addMissingTypeDeclarations(src);
    expect(source).toContain('array<string> vals');
    expect(source).not.toMatch(/\barray vals\b/);
  });
});
