// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pine symbol index: declarations, references, definition resolution,
 * scoped rename plans, and literal detection.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildSymbolIndex,
  definitionOf,
  isBuiltinName,
  isInLiteral,
  planRename,
  referencesOf,
  scopeAt,
  symbolAt,
} from '../src/editor/symbol-index.ts';

const SRC = `//@version=6
indicator("t")
import hoox/lib/1 as lib

type Point
    float price
    int bar

enum Side
    BUY
    SELL

avg(a, b) =>
    total = a + b
    total / 2

calc(src, len = 14) =>
    sma = ta.sma(src, len)
    p = Point.new()
    p.price := sma
    if sma > close
        sma
    else
        close

f(n) =>
    m = n * 2
    m + n

g(n) =>
    n + 1

x = avg(close, open)
y = calc(close, 20)
c = lib.helper(x)
plot(y)
`;

const at = (needle: string, from = 0): number => {
  const i = SRC.indexOf(needle, from);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
};

describe('buildSymbolIndex declarations', () => {
  const index = buildSymbolIndex(SRC);

  it('finds functions, parameters and locals with scopes', () => {
    const byName = (n: string) => index.byName.get(n) ?? [];
    expect(byName('avg')[0]).toMatchObject({ kind: 'function', line: 13, scope: null });
    expect(byName('calc')[0]).toMatchObject({ kind: 'function', line: 17 });
    expect(byName('len')[0]).toMatchObject({ kind: 'parameter', scope: 'calc', line: 17 });
    expect(byName('sma')[0]).toMatchObject({ kind: 'variable', scope: 'calc', line: 18 });
    expect(byName('total')[0]).toMatchObject({ kind: 'variable', scope: 'avg', line: 14 });
  });

  it('finds type / enum declarations and their members', () => {
    expect(index.byName.get('Point')?.[0]).toMatchObject({ kind: 'type', line: 5 });
    expect(index.byName.get('price')?.[0]).toMatchObject({ kind: 'field', scope: 'Point' });
    expect(index.byName.get('Side')?.[0]).toMatchObject({ kind: 'enum', line: 9 });
    expect(index.byName.get('BUY')?.[0]).toMatchObject({ kind: 'field', scope: 'Side' });
  });

  it('finds import aliases and script-level variables', () => {
    expect(index.byName.get('lib')?.[0]).toMatchObject({ kind: 'import', line: 3 });
    expect(index.byName.get('x')?.[0]).toMatchObject({ kind: 'variable', scope: null });
    expect(index.byName.get('y')?.[0]).toMatchObject({ kind: 'variable', scope: null });
  });

  it('finds tuple destructuring and loop bindings', () => {
    const src = `//@version=6
indicator("t")
[a, b] = [1, 2]
for i = 1 to 3
    i
for [k, v] in pairs
    k
`;
    const idx = buildSymbolIndex(src);
    for (const name of ['a', 'b', 'i', 'k', 'v']) {
      expect(idx.byName.get(name)?.length).toBeGreaterThan(0);
    }
  });

  it('does not treat `==` / `=>` / `:=` as declarations', () => {
    const src = `//@version=6
indicator("t")
a = close == open
f(x) => x
b = 1
b := 2
`;
    const idx = buildSymbolIndex(src);
    expect(idx.byName.has('close')).toBe(false);
    expect(idx.byName.has('open')).toBe(false);
    expect(idx.byName.get('f')?.[0]?.kind).toBe('function');
  });
});

describe('references', () => {
  const index = buildSymbolIndex(SRC);

  it('includes call sites, reads and declarations', () => {
    const refs = referencesOf(index, at('avg(close'));
    expect(refs.map((r) => `${r.line}:${r.kind}`)).toEqual(['13:decl', '33:call']);
  });

  it('keeps a parameter rename inside its own function', () => {
    const inF = referencesOf(index, at('m = n') + 4);
    expect(inF.map((r) => `${r.line}:${r.kind}`)).toEqual(['26:decl', '27:read', '28:read']);
    const inG = referencesOf(index, at('n + 1'));
    expect(inG.map((r) => `${r.line}:${r.kind}`)).toEqual(['30:decl', '31:read']);
  });

  it('follows a dotted member without mixing namespaces', () => {
    const refs = referencesOf(index, at('price :='));
    expect(refs.some((r) => r.kind === 'member')).toBe(true);
    // `price` is not treated as the `Point` type or a script-level name.
    expect(refs.every((r) => r.name === 'price')).toBe(true);
  });

  it('finds the import alias at its declaration and use', () => {
    const refs = referencesOf(index, at('lib.helper'));
    expect(refs.map((r) => `${r.line}:${r.kind}`)).toEqual(['3:decl', '35:read']);
  });
});

describe('definitionOf', () => {
  const index = buildSymbolIndex(SRC);

  it('resolves a call to its function', () => {
    const def = definitionOf(index, at('calc(close'));
    expect(def).toMatchObject({ name: 'calc', kind: 'function', line: 17 });
  });

  it('prefers the enclosing function parameter over a script-level name', () => {
    const def = definitionOf(index, at('m = n') + 4);
    expect(def).toMatchObject({ name: 'n', kind: 'parameter', scope: 'f' });
  });

  it('resolves a type reference', () => {
    expect(definitionOf(index, at('Point.new'))).toMatchObject({ name: 'Point', kind: 'type' });
  });

  it('returns null for builtins and unknown names', () => {
    expect(definitionOf(index, at('ta.sma'))).toBeNull();
    expect(definitionOf(index, at('plot(y)'))).toBeNull();
  });

  it('returns the declaration itself when the cursor is on it', () => {
    expect(definitionOf(index, at('avg('))).toMatchObject({ name: 'avg', line: 13 });
  });
});

describe('scopeAt / symbolAt', () => {
  const index = buildSymbolIndex(SRC);

  it('finds the innermost function body', () => {
    expect(scopeAt(index, at('sma = ta.sma'))?.name).toBe('calc');
    expect(scopeAt(index, at('x = avg'))).toBeNull();
  });

  it('returns the occurrence under an offset', () => {
    expect(symbolAt(index, at('avg(close'))).toMatchObject({ name: 'avg', kind: 'call' });
    expect(symbolAt(index, 0)).toBeNull();
  });
});

describe('planRename', () => {
  const index = buildSymbolIndex(SRC);

  it('plans every occurrence of a local', () => {
    const plan = planRename(index, at('m = n') + 4, 'value');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits.length).toBe(3);
    for (const edit of plan.edits) expect(SRC.slice(edit.from, edit.to)).toBe('n');
  });

  it('rejects builtins, namespaces, keywords and invalid identifiers', () => {
    const offset = at('avg(close');
    expect(planRename(index, offset, 'ta')).toMatchObject({ ok: false });
    expect(planRename(index, offset, 'plot')).toMatchObject({ ok: false });
    expect(planRename(index, offset, 'if')).toMatchObject({ ok: false });
    expect(planRename(index, offset, '1abc')).toMatchObject({ ok: false });
    expect(planRename(index, offset, 'my avg')).toMatchObject({ ok: false });
  });

  it('rejects a name already declared in the same scope', () => {
    expect(planRename(index, at('avg(close'), 'calc')).toMatchObject({ ok: false });
  });

  it('rejects type / enum member renames', () => {
    expect(planRename(index, at('BUY'), 'ASK')).toMatchObject({ ok: false });
  });

  it('rejects a symbol with no user declaration', () => {
    expect(planRename(index, at('plot(y)'), 'draw')).toMatchObject({ ok: false });
  });
});

describe('isBuiltinName / isInLiteral', () => {
  it('knows builtins and namespaces', () => {
    expect(isBuiltinName('ta.sma')).toBe(true);
    expect(isBuiltinName('ta')).toBe(true);
    expect(isBuiltinName('strategy')).toBe(true);
    expect(isBuiltinName('myHelper')).toBe(false);
  });

  it('detects strings, line comments and block comments', () => {
    const src = 'a = "plot(close)" // note\n/* block */ b = 1';
    expect(isInLiteral(src, src.indexOf('close'))).toBe(true);
    expect(isInLiteral(src, src.indexOf('note'))).toBe(true);
    expect(isInLiteral(src, src.indexOf('block'))).toBe(true);
    expect(isInLiteral(src, src.indexOf('b = 1'))).toBe(false);
  });
});
