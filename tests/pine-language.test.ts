/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'bun:test';
import {
  tokenizePine,
  advancePineLineState,
  defaultPineHighlightState,
} from '../src/editor/pyne-language';

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
    expect(t.some((x) => x === 'variableName.standard:close')).toBe(true);
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
    const s = advancePineLineState('msg = "hello', defaultPineHighlightState());
    expect(s.stringQuote).toBe('"');
    const s2 = advancePineLineState('world"', s);
    expect(s2.stringQuote).toBe(null);
  });

  it('advancePineLineState clones userTypes', () => {
    const s1 = advancePineLineState('type Point', defaultPineHighlightState());
    const s2 = advancePineLineState('float x', s1);
    expect(s1.userTypes).toContain('Point');
    expect(s2.userTypes).toContain('Point');
    expect(s1.userTypes).not.toBe(s2.userTypes);
    s1.userTypes.push('Mutated');
    expect(s2.userTypes).not.toContain('Mutated');
  });

  it('tags series builtins apart from user variables', () => {
    const t = typesOf('len = bar_index + close + time\nfoo = len\n');
    expect(t).toContain('variableName.standard:bar_index');
    expect(t).toContain('variableName.standard:close');
    expect(t).toContain('variableName.standard:time');
    expect(t).toContain('variableName:len');
    expect(t).toContain('variableName:foo');
  });

  it('tags import aliases and library export members', () => {
    const src = `import cryptolinx/Motion/12 as m
easing = input.enum(m.Easing.linear, "easing")
plot(m.easing(close))
`;
    const t = typesOf(src);
    expect(t).toContain('variableName.special:m');
    expect(t).toContain('typeName:Easing');
    expect(t).toContain('propertyName.special:linear');
    expect(t).toContain('propertyName.special:easing');
    expect(t).toContain('variableName.standard:close');
    expect(t.some((x) => x === 'namespace:input')).toBe(true);
    expect(t).not.toContain('variableName:m');
  });

  it('tags default import alias when as is omitted', () => {
    const t = typesOf('import user/MathHelpers/1\nx = MathHelpers.add(1)\n');
    expect(t).toContain('variableName.special:MathHelpers');
    expect(t).toContain('propertyName.special:add');
  });

  it('tags export names as library symbols', () => {
    const t = typesOf('export enum Easing\nexport method foo()\n');
    expect(t).toContain('typeName:Easing');
    expect(t).toContain('variableName.special:foo');
  });

  it('tags built-in types and qualifiers as typeName', () => {
    const t = typesOf('series float x = close\nsimple int n = 1\nstring s = "a"\n');
    expect(t).toContain('typeName:series');
    expect(t).toContain('typeName:float');
    expect(t).toContain('typeName:simple');
    expect(t).toContain('typeName:int');
    expect(t).toContain('typeName:string');
  });

  it('does not steal series / simple as user identifiers', () => {
    const assign = typesOf('series = close\n');
    expect(assign).toContain('variableName:series');
    expect(assign).toContain('variableName.standard:close');
    expect(assign).not.toContain('typeName:series');

    const call = typesOf('plot(series)\n');
    expect(call).toContain('variableName:series');
    expect(call).not.toContain('typeName:series');

    const fn = typesOf('ma(series, length) =>\n');
    expect(fn).toContain('variableName:series');
    expect(fn).toContain('variableName:length');
    expect(fn).not.toContain('typeName:series');

    const typed = typesOf('ma(series float src, simple int length) =>\n');
    expect(typed).toContain('typeName:series');
    expect(typed).toContain('typeName:float');
    expect(typed).toContain('typeName:simple');
    expect(typed).toContain('typeName:int');
  });

  it('tags declared UDTs and later uses as typeName', () => {
    const src = `type Point
    float x
    int y
p = Point.new()
`;
    const t = typesOf(src);
    expect(t).toContain('definitionKeyword:type');
    expect(t).toContain('typeName:Point');
    expect(t).toContain('typeName:float');
    expect(t).toContain('typeName:int');
    expect(t.filter((x) => x === 'typeName:Point').length).toBeGreaterThanOrEqual(2);
    expect(t).toContain('propertyName:new');
    expect(t).not.toContain('variableName:Point');
  });

  it('does not treat the next line after type as the UDT name', () => {
    const t = typesOf('type Point\n    float x\n');
    expect(t).toContain('typeName:Point');
    expect(t.filter((x) => x === 'typeName:float').length).toBe(1);
    expect(t).not.toContain('variableName:float');
  });

  it('tags imported PascalCase members as types (UDT / enum)', () => {
    const t = typesOf('import user/Lib/1 as m\nx = m.Easing.linear\n');
    expect(t).toContain('typeName:Easing');
    expect(t).toContain('propertyName.special:linear');
  });

  it('does not tag imported PascalCase calls or ALLCAPS as types', () => {
    const t = typesOf('import user/Lib/1 as m\nplot(m.SuperTrend(close))\nv = m.VERSION\nr = m.RSI(close, 14)\n');
    expect(t).toContain('propertyName.special:SuperTrend');
    expect(t).not.toContain('typeName:SuperTrend');
    expect(t).toContain('propertyName.special:VERSION');
    expect(t).not.toContain('typeName:VERSION');
    expect(t).toContain('propertyName.special:RSI');
    expect(t).not.toContain('typeName:RSI');
  });

  it('keeps built-in namespace members as ordinary properties', () => {
    const t = typesOf('color.red + ta.sma(close, 14)\n');
    expect(t).toContain('namespace:color');
    expect(t).toContain('propertyName:red');
    expect(t).toContain('namespace:ta');
    expect(t).toContain('propertyName:sma');
    expect(t).not.toContain('propertyName.special:red');
  });
});
