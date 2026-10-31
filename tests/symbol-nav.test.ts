// Copyright (c) 2026 HOOX · AXIS · hoox-sh (jango_blockchained)
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CodeMirror navigation glue: cached index per document version and
 * occurrence highlighting. Commands that need a mounted view are covered by
 * the pure `symbol-index` tests.
 */

import { describe, expect, it } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { indexFor, occurrenceDecorations } from '../src/editor/symbol-nav.ts';

const DOC = `//@version=6
indicator("t")
f(n) =>
    n + n
plot(f(1))
`;

function stateAt(needle: string, extra?: { anchor: number; head: number }): EditorState {
  const anchor = DOC.indexOf(needle);
  expect(anchor).toBeGreaterThanOrEqual(0);
  return EditorState.create({
    doc: DOC,
    selection: extra ? { anchor: extra.anchor, head: extra.head } : { anchor },
  });
}

function ranges(state: EditorState): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  occurrenceDecorations(state).between(0, state.doc.length, (from, to) => {
    out.push([from, to]);
  });
  return out;
}

describe('indexFor', () => {
  it('caches one index per document version', () => {
    const state = EditorState.create({ doc: DOC });
    expect(indexFor(state.doc)).toBe(indexFor(state.doc));
  });

  it('rebuilds after a change', () => {
    const state = EditorState.create({ doc: DOC });
    const before = indexFor(state.doc);
    const next = state.update({ changes: { from: 0, insert: ' ' } }).state;
    expect(indexFor(next.doc)).not.toBe(before);
  });
});

describe('occurrenceDecorations', () => {
  it('marks a parameter declaration and its uses', () => {
    const hits = ranges(stateAt('n + n'));
    expect(hits.length).toBe(3);
    const doc = DOC;
    expect(hits.map(([from, to]) => doc.slice(from, to))).toEqual(['n', 'n', 'n']);
  });

  it('marks a function name at the declaration and the call', () => {
    const hits = ranges(stateAt('f(1)'));
    expect(hits.length).toBe(2);
  });

  it('marks builtin occurrences too (no rename target, but still a symbol)', () => {
    const hits = ranges(stateAt('plot('));
    expect(hits.length).toBe(1);
    expect(DOC.slice(hits[0]![0], hits[0]![1])).toBe('plot');
  });

  it('marks nothing for a non-empty selection', () => {
    const anchor = DOC.indexOf('n + n');
    expect(ranges(stateAt('n + n', { anchor, head: anchor + 1 }))).toEqual([]);
  });

  it('marks nothing inside a string literal', () => {
    const doc = '//@version=6\nindicator("t")\nx = "x x"\nplot(x)\n';
    const state = EditorState.create({ doc, selection: { anchor: doc.indexOf('x x') } });
    expect(occurrenceDecorations(state).size).toBe(0);
  });
});
