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

  it('finds the innermost function / type body', () => {
    expect(scopeAt(index, at('sma = ta.sma'))?.name).toBe('calc');
    expect(scopeAt(index, at('price'))?.name).toBe('Point');
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

describe('named arguments', () => {
  it('does not treat a call named argument as a variable write', () => {
    const src = `//@version=6
qty = 2
strategy.entry("Long", strategy.long, qty = qty)
`;
    const index = buildSymbolIndex(src);
    const refs = referencesOf(index, src.indexOf('qty = 2'));
    expect(refs.map((r) => `${r.line}:${r.kind}`)).toEqual(['2:decl', '3:read']);

    const plan = planRename(index, src.indexOf('qty = 2'), 'size');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.edits.map((e) => src.slice(e.from, e.to))).toEqual(['qty', 'qty']);
  });

  it('does not index a multi-line named argument as a declaration', () => {
    const src = `//@version=6
plot(
    close,
    linewidth = 2
)
x = 1
`;
    const index = buildSymbolIndex(src);
    expect(index.byName.has('linewidth')).toBe(false);
  });
});

describe('rename shadowing', () => {
  it('rejects renaming a script-level function to a parameter name used in that function', () => {
    const src = `//@version=6
f() => 1
g(x) =>
    x + f()
y = f()
`;
    const index = buildSymbolIndex(src);
    expect(planRename(index, src.indexOf('f()'), 'x')).toMatchObject({ ok: false });
  });

  it('rejects renaming a parameter to a script-level name used in the function', () => {
    const src = `//@version=6
k = 5
f(n) =>
    n + k
`;
    const index = buildSymbolIndex(src);
    expect(planRename(index, src.indexOf('n)'), 'k')).toMatchObject({ ok: false });
  });

  it('keeps shadowed references out of a script-level symbol', () => {
    const src = `//@version=6
f() => 1
g(f) =>
    f + 1
`;
    const index = buildSymbolIndex(src);
    const refs = referencesOf(index, src.indexOf('f()'));
    expect(refs.map((r) => `${r.line}:${r.kind}`)).toEqual(['2:decl']);
  });

  it('allows a shadowing rename when the new name is unused in the affected scope', () => {
    const src = `//@version=6
a = 1
g(x) =>
    x + 1
`;
    const index = buildSymbolIndex(src);
    expect(planRename(index, src.indexOf('a = 1'), 'x')).toMatchObject({ ok: true });
  });

  it('allows a rename when the new name is only used as a member', () => {
    const src = `//@version=6
type Point
    float price
method foo(Point this) =>
    this.price
f(p) =>
    x = 1
    p.foo()
    x
`;
    const index = buildSymbolIndex(src);
    expect(planRename(index, src.indexOf('x = 1'), 'foo')).toMatchObject({ ok: true });
  });
});

describe('member resolution', () => {
  const src = `//@version=6
type Point
    float price
f() =>
    price = 10
    p = Point.new()
    p.price := price
`;
  const index = buildSymbolIndex(src);

  it('resolves a member to the field, not a same-named local', () => {
    expect(definitionOf(index, src.indexOf('price :='))).toMatchObject({
      kind: 'field',
      name: 'price',
      scope: 'Point',
    });
    expect(definitionOf(index, src.lastIndexOf('price'))).toMatchObject({
      kind: 'variable',
      name: 'price',
      scope: 'f',
    });
  });

  it('keeps the field and the local references apart', () => {
    expect(referencesOf(index, src.indexOf('price :=')).map((r) => `${r.line}:${r.kind}`)).toEqual([
      '3:decl',
      '7:member',
    ]);
    expect(referencesOf(index, src.lastIndexOf('price')).map((r) => `${r.line}:${r.kind}`)).toEqual(
      ['5:decl', '7:read'],
    );
  });

  it('resolves same-named fields through typed receivers', () => {
    const typed = `//@version=6
type A
    float price
type B
    float price
f(A a, B b) =>
    a.price := b.price
`;
    const typedIndex = buildSymbolIndex(typed);
    expect(definitionOf(typedIndex, typed.indexOf('a.price') + 2)).toMatchObject({ scope: 'A' });
    expect(definitionOf(typedIndex, typed.indexOf('b.price') + 2)).toMatchObject({ scope: 'B' });
  });

  it('does not guess between same-named fields without a receiver type', () => {
    const untyped = `//@version=6
type A
    float price
type B
    float price
f(a, b) =>
    a.price := b.price
`;
    const untypedIndex = buildSymbolIndex(untyped);
    expect(definitionOf(untypedIndex, untyped.indexOf('a.price') + 2)).toBeNull();
  });

  it('keeps untyped member receivers apart by declaration', () => {
    const src = `//@version=6
type A
    float price
type B
    float price
f(a) =>
    a.price
g(a) =>
    a.price
`;
    const index = buildSymbolIndex(src);
    const first = src.indexOf('a.price') + 2;
    const second = src.indexOf('a.price', src.indexOf('g(')) + 2;
    expect(referencesOf(index, first).map((r) => `${r.line}:${r.kind}`)).toEqual(['7:member']);
    expect(referencesOf(index, second).map((r) => `${r.line}:${r.kind}`)).toEqual(['9:member']);
  });

  it('does not resolve a builtin member to a same-named local', () => {
    const src = `//@version=6
f() =>
    sma = 1
    ta.sma(close, 14)
`;
    const index = buildSymbolIndex(src);
    const member = src.indexOf('sma(', src.indexOf('ta.'));
    expect(definitionOf(index, member)).toBeNull();
    expect(referencesOf(index, src.indexOf('sma = 1')).map((r) => `${r.line}:${r.kind}`)).toEqual([
      '3:decl',
    ]);
  });
});

describe('comments', () => {
  it('does not index declarations inside block comments', () => {
    const src = `//@version=6
x = close
/*
import hoox/lib/1 as lib
f() =>
    x = 1
*/
y = x + 1
plot(y)
`;
    const index = buildSymbolIndex(src);
    expect(index.byName.has('f')).toBe(false);
    expect(index.byName.has('lib')).toBe(false);
    expect(index.byName.get('y')?.[0]).toMatchObject({ kind: 'variable', scope: null });
    expect(planRename(index, src.indexOf('x = close'), 'f')).toMatchObject({ ok: true });
  });

  it('indexes type / enum members with trailing comments', () => {
    const src = `//@version=6
type Point
    float price // the price
enum Side
    BUY // buy
    SELL
p = Point.new()
p.price := 1
s = Side.BUY
`;
    const index = buildSymbolIndex(src);
    expect(index.byName.get('price')?.[0]).toMatchObject({ kind: 'field', scope: 'Point' });
    expect(index.byName.get('BUY')?.[0]).toMatchObject({ kind: 'field', scope: 'Side' });
    expect(definitionOf(index, src.indexOf('price :='))).toMatchObject({ scope: 'Point' });
    expect(definitionOf(index, src.lastIndexOf('BUY'))).toMatchObject({ scope: 'Side' });
  });

  it('points an import alias at the alias, not a trailing comment', () => {
    const src = `//@version=6
import hoox/lib/1 as lib // lib
plot(lib.helper)
`;
    const index = buildSymbolIndex(src);
    const refs = referencesOf(index, src.indexOf('lib.helper'));
    expect(refs.map((r) => `${r.line}:${r.kind}`)).toEqual(['2:decl', '3:read']);
    expect(refs[0]?.from).toBe(src.indexOf('as lib') + 'as '.length);
  });
});

describe('multi-line function headers', () => {
  it('keeps the body inside the function scope', () => {
    const src = `//@version=6
n = 1
f(
    n
) =>
    x = n
    x + n
`;
    const index = buildSymbolIndex(src);
    const body = src.lastIndexOf('x + n');
    expect(scopeAt(index, body)).toMatchObject({ name: 'f' });
    expect(definitionOf(index, body)).toMatchObject({ name: 'x', scope: 'f' });
    expect(referencesOf(index, body).map((r) => `${r.line}:${r.kind}`)).toEqual([
      '6:decl',
      '7:read',
    ]);
    expect(definitionOf(index, src.lastIndexOf('n'))).toMatchObject({ name: 'n', scope: 'f' });
    expect(referencesOf(index, src.lastIndexOf('n')).map((r) => `${r.line}:${r.kind}`)).toEqual([
      '4:decl',
      '6:read',
      '7:read',
    ]);
  });

  it('ignores comments inside a parameter list', () => {
    const src = `//@version=6
f(
    n // count
) =>
    n
`;
    const index = buildSymbolIndex(src);
    expect(index.byName.get('n')?.[0]).toMatchObject({ kind: 'parameter', scope: 'f' });
    expect(index.byName.has('count')).toBe(false);
  });
});

describe('EOF and duplicate declarations', () => {
  it('keeps the cursor at EOF inside the last function', () => {
    const src = `//@version=6
n = 1
f(n) =>
    n`;
    const index = buildSymbolIndex(src);
    expect(scopeAt(index, src.length)).toMatchObject({ name: 'f' });
    expect(definitionOf(index, src.length)).toMatchObject({ name: 'n', scope: 'f' });
    expect(referencesOf(index, src.length).map((r) => `${r.line}:${r.kind}`)).toEqual([
      '3:decl',
      '4:read',
    ]);
  });

  it('indexes a field with a default once', () => {
    const src = `//@version=6
type Point
    float price = 0.0
`;
    const index = buildSymbolIndex(src);
    expect(index.byName.get('price')).toHaveLength(1);
    expect(index.byName.get('price')?.[0]).toMatchObject({ kind: 'field', scope: 'Point' });
  });
});

describe('isBuiltinName', () => {
  it('knows builtins and namespaces', () => {
    expect(isBuiltinName('ta.sma')).toBe(true);
    expect(isBuiltinName('ta')).toBe(true);
    expect(isBuiltinName('strategy')).toBe(true);
    expect(isBuiltinName('myHelper')).toBe(false);
  });
});
