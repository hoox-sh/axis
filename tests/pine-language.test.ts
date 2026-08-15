/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import { tokenizePine, advancePineLineState } from '../src/editor/pyne-language';

function typesOf(src: string): string[] {
  return tokenizePine(src)
    .filter((t) => t.type && t.text.trim())
    .map((t) => `${t.type}:${t.text}`);
}

describe('tokenizePine', () => {
  it('tags version pragma as meta', () => {
    expect(typesOf('//@version=6\n')).toContain('meta://@version=6');
  });

  it('keeps // comments', () => {
    expect(typesOf('plot(close) // hi\n').some((t) => t.startsWith('comment:'))).toBe(true);
  });

  it('continues block comments and strings across lines', () => {
    const block = tokenizePine('/* a\nb */\n');
    expect(block.filter((t) => t.type === 'comment').length).toBeGreaterThan(1);
    const str = tokenizePine('"hello\nworld"\n');
    expect(str.filter((t) => t.type === 'string').map((t) => t.text).join('')).toContain('hello');
    expect(str.filter((t) => t.type === 'string').map((t) => t.text).join('')).toContain('world');
  });

  it('highlights \n escapes inside strings', () => {
    const toks = tokenizePine('"A\\nB"\n');
    expect(toks.some((t) => t.type === 'atom' && t.text === '\\n')).toBe(true);
  });

  it('tags namespaces, properties, types, and calls', () => {
    const t = typesOf('ta.sma(close, 14)\n');
    expect(t.some((x) => x === 'namespace:ta')).toBe(true);
    expect(t.some((x) => x.startsWith('propertyName:sma'))).toBe(true);
    expect(t.some((x) => x === 'variableName:close')).toBe(true);
    expect(t.some((x) => x === 'number:14')).toBe(true);
  });

  it('tags label.new as namespace + property', () => {
    const t = typesOf('label.new(bar_index, high, "x")\n');
    expect(t.some((x) => x === 'namespace:label')).toBe(true);
    expect(t.some((x) => x.startsWith('propertyName:new'))).toBe(true);
  });

  it('tags hex colors and na/bool', () => {
    const t = typesOf('c = #939fff\nif na or true\n');
    expect(t.some((x) => x === 'atom:#939fff')).toBe(true);
    expect(t.some((x) => x === 'null:na')).toBe(true);
    expect(t.some((x) => x === 'bool:true')).toBe(true);
    expect(t.some((x) => x === 'controlKeyword:if')).toBe(true);
  });

  it('keeps triple-quoted strings open across lines', () => {
    const toks = tokenizePine('s = """hello\nworld"""\n');
    const joined = toks.filter((t) => t.type === 'string').map((t) => t.text).join('');
    expect(joined).toContain('hello');
    expect(joined).toContain('world');
    expect(toks.some((t) => t.type === 'string' && t.text.includes('"""'))).toBe(true);
  });

  it('advancePineLineState tracks an unclosed quote', () => {
    const s = advancePineLineState('msg = "hello', {
      inBlockComment: false,
      stringQuote: null,
      afterDot: false,
    });
    expect(s.stringQuote).toBe('"');
    const s2 = advancePineLineState('world"', s);
    expect(s2.stringQuote).toBe(null);
  });
});
